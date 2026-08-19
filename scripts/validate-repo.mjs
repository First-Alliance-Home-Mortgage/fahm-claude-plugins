#!/usr/bin/env node
/**
 * validate-repo.mjs — structural, portability and secret checks for this marketplace.
 *
 * Zero dependencies, no network, no CLI required. Runs locally before a commit
 * and in CI. Exits non-zero on any error; warnings do not fail the build.
 *
 *   node scripts/validate-repo.mjs
 *   node scripts/validate-repo.mjs --quiet
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

// ── Rules from CONTRIBUTING.md ───────────────────────────────────────────────

const PORTABLE_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const DESCRIPTION_CEILING = 700;

/** Grandfathered at the migration that created this repo. See CONTRIBUTING.md rule 2. */
const DESCRIPTION_EXEMPT = new Set(['docs-answers', 'project-turnover']);

/** Marketplace names Claude Code reserves. Re-checked on every load, so a rename can break later. */
const RESERVED_MARKETPLACE_NAMES = new Set([
  'claude-code-marketplace', 'claude-code-plugins', 'claude-plugins-official',
  'claude-plugins-community', 'claude-community', 'anthropic-marketplace',
  'anthropic-plugins', 'agent-skills', 'anthropic-agent-skills',
  'knowledge-work-plugins', 'life-sciences', 'claude-for-legal',
  'claude-for-financial-services', 'financial-services-plugins',
  'first-party-plugins', 'healthcare',
]);

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const FORBIDDEN_PATHS = [
  [/\$HOME\/\.claude/, '$HOME/.claude — use ${CLAUDE_SKILL_DIR}'],
  [/\$env:USERPROFILE/, '$env:USERPROFILE — use ${CLAUDE_SKILL_DIR}'],
  [/<skill>\//, '<skill>/ placeholder — use ${CLAUDE_SKILL_DIR}'],
  [/["'`][A-Za-z]:[\\/]/, 'a drive-letter absolute path'],
];

const SECRET_PATTERNS = [
  [/client_secret\s*[:=]\s*["'][^"'<{$]/i, 'a literal client_secret value'],
  [/\bpassword\s*[:=]\s*["'][^"'<{$]/i, 'a literal password value'],
  [/Bearer\s+ey[A-Za-z0-9_-]{10,}/, 'a JWT'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b[A-Z]{2}\d{8}\b/, 'an Encompass instance-id shape (use <instanceId>)'],
];

/** The only GUID allowed to appear literally. */
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(rel(path), `does not parse as JSON — ${e.message}`);
    return null;
  }
}

/** Minimal YAML frontmatter reader: top-level keys only, which is all the rules need. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const keys = [];
  const values = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/);
    if (!km) continue; // nested/continuation line
    keys.push(km[1]);
    values[km[1]] = km[2].trim();
  }
  return { keys, values, raw: m[1] };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ── 1. Marketplace manifest ──────────────────────────────────────────────────

const marketplacePath = join(ROOT, '.claude-plugin', 'marketplace.json');
if (!existsSync(marketplacePath)) {
  err('.claude-plugin/marketplace.json', 'missing — the marketplace manifest must be at repo root');
}

const marketplace = existsSync(marketplacePath) ? readJson(marketplacePath) : null;
const pluginDirs = [];

if (marketplace) {
  const f = '.claude-plugin/marketplace.json';
  for (const k of ['name', 'owner', 'plugins']) {
    if (!marketplace[k]) err(f, `missing required key "${k}"`);
  }
  if (marketplace.name) {
    if (!KEBAB.test(marketplace.name)) err(f, `name "${marketplace.name}" is not kebab-case`);
    if (RESERVED_MARKETPLACE_NAMES.has(marketplace.name)) {
      err(f, `name "${marketplace.name}" is reserved by Claude Code`);
    }
  }
  if (marketplace.owner && !marketplace.owner.name) err(f, 'owner.name is required');

  for (const p of marketplace.plugins ?? []) {
    if (!p.name) { err(f, 'a plugin entry has no name'); continue; }
    if (!KEBAB.test(p.name)) err(f, `plugin "${p.name}" is not kebab-case`);
    if (!p.source) { err(f, `plugin "${p.name}" has no source`); continue; }
    if (typeof p.source !== 'string') continue; // remote sources are not resolved here

    if (!p.source.startsWith('./')) {
      err(f, `plugin "${p.name}" source "${p.source}" must start with "./"`);
      continue;
    }
    const dir = join(ROOT, p.source);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      err(f, `plugin "${p.name}" source "${p.source}" does not resolve to a directory`);
      continue;
    }
    const manifest = join(dir, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifest)) {
      err(f, `plugin "${p.name}" has no .claude-plugin/plugin.json`);
      continue;
    }
    pluginDirs.push({ name: p.name, dir });
  }
}

// Catch a plugin on disk that nobody listed.
const pluginsRoot = join(ROOT, 'plugins');
if (existsSync(pluginsRoot)) {
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!pluginDirs.some((p) => p.dir === join(pluginsRoot, entry.name))) {
      err('.claude-plugin/marketplace.json', `plugins/${entry.name}/ exists on disk but is not listed`);
    }
  }
}

// ── 2. Plugin manifests and the .claude-plugin/ layout rule ──────────────────

const MISPLACED = ['skills', 'commands', 'agents', 'hooks'];

for (const { name, dir } of pluginDirs) {
  const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
  const manifest = readJson(manifestPath);
  const f = rel(manifestPath);

  if (manifest) {
    if (!manifest.name) err(f, 'missing "name"');
    else if (!KEBAB.test(manifest.name)) err(f, `name "${manifest.name}" is not kebab-case`);
    else if (manifest.name !== name) err(f, `name "${manifest.name}" does not match marketplace entry "${name}"`);

    if (!manifest.version) err(f, 'missing "version" — it is the update gate');
    else if (!SEMVER.test(manifest.version)) err(f, `version "${manifest.version}" is not semver`);

    if (!manifest.description) warn(f, 'has no description');
  }

  // The #1 documented plugin mistake: components inside .claude-plugin/.
  for (const d of MISPLACED) {
    if (existsSync(join(dir, '.claude-plugin', d))) {
      err(rel(dir), `${d}/ is inside .claude-plugin/ — it must sit at the plugin root`);
    }
  }
}

// ── 3. Skills ────────────────────────────────────────────────────────────────

const skillFiles = [];
for (const { dir } of pluginDirs) {
  const skillsDir = join(dir, 'skills');
  if (!existsSync(skillsDir)) continue;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMd)) {
      err(rel(join(skillsDir, entry.name)), 'has no SKILL.md');
      continue;
    }
    skillFiles.push({ dirName: entry.name, path: skillMd });
  }
}

if (skillFiles.length === 0) err('plugins/', 'no skills found');

for (const { dirName, path } of skillFiles) {
  const f = rel(path);
  const text = readFileSync(path, 'utf8');
  const fm = frontmatter(text);

  if (!fm) { err(f, 'has no YAML frontmatter'); continue; }

  for (const k of fm.keys) {
    if (!PORTABLE_KEYS.has(k)) {
      err(f, `frontmatter key "${k}" is outside the portable six-key subset (CONTRIBUTING rule 1)`);
    }
  }
  if (fm.keys.includes('version')) {
    err(f, '"version" is not a SKILL.md field — it belongs in plugin.json');
  }

  if (!fm.values.name) err(f, 'frontmatter has no "name"');
  else if (fm.values.name !== dirName) err(f, `name "${fm.values.name}" does not match directory "${dirName}"`);

  const desc = fm.values.description ?? '';
  if (!desc) {
    err(f, 'frontmatter has no "description" — the skill will not fire reliably');
  } else if (desc.length > DESCRIPTION_CEILING && !DESCRIPTION_EXEMPT.has(dirName)) {
    err(f, `description is ${desc.length} chars, over the ${DESCRIPTION_CEILING} ceiling (CONTRIBUTING rule 2)`);
  } else if (desc.length > DESCRIPTION_CEILING) {
    warn(f, `description is ${desc.length} chars — grandfathered, scheduled for a trim`);
  }

  // Forbidden path forms.
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [re, label] of FORBIDDEN_PATHS) {
      if (re.test(line)) err(f, `line ${i + 1} uses ${label}`);
    }
  });

  // Relative links must resolve. Skip anchors, absolute URLs and mailto.
  const base = dirname(path);
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    if (target.includes('${') || target.includes('<')) continue; // templated
    if (!existsSync(resolve(base, target))) {
      err(f, `relative link "${target}" does not resolve`);
    }
  }
}

// ── 4. Secret scan over every tracked text file ──────────────────────────────

const TEXT_EXT = /\.(md|mjs|js|json|yml|yaml|txt)$/i;
const SELF = resolve(fileURLToPath(import.meta.url));

for (const file of walk(ROOT)) {
  if (!TEXT_EXT.test(file)) continue;
  if (resolve(file) === SELF) continue; // this file names the patterns it hunts

  const f = rel(file);
  const text = readFileSync(file, 'utf8');

  text.split(/\r?\n/).forEach((line, i) => {
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(line)) err(f, `line ${i + 1} may contain ${label}`);
    }
    for (const g of line.match(GUID) ?? []) {
      if (g.toLowerCase() !== ZERO_GUID) {
        err(f, `line ${i + 1} contains a GUID that is not the all-zeros placeholder`);
      }
    }
  });
}

// ── Report ───────────────────────────────────────────────────────────────────

if (!quiet) {
  console.log(`\nfahm-claude-plugins — validate`);
  console.log(`  plugins: ${pluginDirs.length}   skills: ${skillFiles.length}`);
}

for (const w of warnings) console.log(`  warn   ${w}`);
for (const e of errors) console.error(`  ERROR  ${e}`);

if (errors.length) {
  console.error(`\n${errors.length} error${errors.length === 1 ? '' : 's'}.\n`);
  process.exit(1);
}
if (!quiet) console.log(`\n  OK — ${warnings.length} warning${warnings.length === 1 ? '' : 's'}, 0 errors.\n`);
