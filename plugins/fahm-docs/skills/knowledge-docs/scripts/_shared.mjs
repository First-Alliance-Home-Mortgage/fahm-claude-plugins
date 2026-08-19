/**
 * Shared helpers for the knowledge-docs skill scripts.
 *
 * Zero dependencies, no network, read-only. Imported by scan-docs.mjs,
 * check-doc-links.mjs and publish-docs.mjs. Copy the whole scripts/ directory
 * if you want to run any of them from CI.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, sep, dirname, resolve, relative } from 'node:path';

/** Directories never worth walking. Shared so every script reports on the same tree. */
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'target', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'coverage', '.turbo', '.cache', 'Pods',
  'DerivedData', '.expo', '.gradle', 'bin', 'obj',
]);

export const DOC_EXTS = ['.md', '.mdx'];

export function fail(script, message) {
  console.error(`${script}: ${message}`);
  process.exit(1);
}

/** Normalises a native path to forward slashes so output is stable across platforms. */
export function toPosix(p) {
  return p.split(sep).join('/');
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Collects files under `dir`. Skips IGNORE_DIRS and dot-directories: a doc
 * living in `.github/` is rare enough not to justify walking every tool cache.
 */
export function walk(dir, { exts = null, ignore = IGNORE_DIRS, out = [] } = {}) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignore.has(entry.name)) continue;
      walk(full, { exts, ignore, out });
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (!exts || exts.some((ext) => lower.endsWith(ext))) out.push(full);
    }
  }
  return out;
}

/**
 * Walks a markdown source line by line, tracking fenced code blocks.
 *
 * `inFence` is true for the fence delimiters themselves as well as their
 * contents, so callers never parse a fence line as markdown.
 */
export function* eachLine(source) {
  const lines = source.split(/\r?\n/);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (match) {
      const marker = match[1][0];
      if (fence === null) {
        fence = marker;
        yield { line, no: i + 1, inFence: true };
        continue;
      }
      if (marker === fence) {
        fence = null;
        yield { line, no: i + 1, inFence: true };
        continue;
      }
    }
    yield { line, no: i + 1, inFence: fence !== null };
  }
}

/**
 * Blanks out fenced blocks and inline code spans, preserving line numbering.
 *
 * This is what stops a path mentioned inside a snippet from being treated as a
 * link that ought to resolve.
 */
export function stripCode(source) {
  const out = [];
  for (const { line, inFence } of eachLine(source)) {
    out.push(inFence ? '' : line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length)));
  }
  return out.join('\n');
}

/**
 * GitHub-compatible heading slug. `## 1. Files` becomes `1-files`.
 *
 * Whitespace is replaced one character at a time rather than by run, because
 * that is what github-slugger does: dropping the `&` from `Nesting & Children`
 * leaves two spaces behind, and the real anchor is `nesting--children`.
 * Collapsing them here would reject links that work perfectly well on GitHub.
 */
export function slugify(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\-_ \t]+/gu, '')
    .replace(/[ \t]/g, '-');
}

/**
 * Every heading in a document, with the anchor it answers to.
 *
 * Handles ATX headings, explicit `{#custom-id}` ids, and GitHub's `-1`, `-2`
 * disambiguation for repeated headings.
 */
export function extractHeadings(source) {
  const headings = [];
  const seen = new Map();
  for (const { line, no, inFence } of eachLine(source)) {
    if (inFence) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    let text = match[2];
    let slug;
    const explicit = text.match(/\{#([^}]+)\}\s*$/);
    if (explicit) {
      slug = explicit[1];
      text = text.slice(0, explicit.index).trim();
    } else {
      slug = slugify(text);
    }
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    headings.push({
      level: match[1].length,
      text,
      line: no,
      slug: count === 0 ? slug : `${slug}-${count}`,
    });
  }
  return headings;
}

/** Anchors declared with raw HTML rather than a heading. */
export function extractHtmlAnchors(source) {
  const anchors = [];
  const pattern = /<a\s[^>]*(?:name|id)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) anchors.push(match[1]);
  return anchors;
}

const INLINE_LINK = /(!?)\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const REF_USE = /\[[^\]\n]*\]\[([^\]\n]*)\]/g;
const REF_DEF = /^\s{0,3}\[([^\]\n]+)\]:\s*(<[^>\n]*>|\S+)/;

/**
 * Every link in a document: inline, reference definitions, and reference uses.
 *
 * Runs against code-stripped source so snippets are ignored. Images are
 * returned too, because a broken image path is broken documentation.
 */
export function extractLinks(source) {
  const stripped = stripCode(source);
  const links = [];
  const definitions = new Map();
  const uses = [];

  for (const { line, no, inFence } of eachLine(stripped)) {
    if (inFence) continue;

    const def = line.match(REF_DEF);
    if (def) {
      const url = def[2].replace(/^<|>$/g, '');
      definitions.set(def[1].toLowerCase(), url);
      links.push({ url, line: no, kind: 'reference-definition' });
      continue;
    }

    INLINE_LINK.lastIndex = 0;
    let match;
    while ((match = INLINE_LINK.exec(line)) !== null) {
      links.push({
        url: match[2].replace(/^<|>$/g, ''),
        line: no,
        kind: match[1] === '!' ? 'image' : 'inline',
      });
    }

    REF_USE.lastIndex = 0;
    while ((match = REF_USE.exec(line)) !== null) {
      if (match[1].trim()) uses.push({ label: match[1].toLowerCase(), line: no });
    }
  }

  return { links, definitions, uses };
}

/** True for anything that leaves the filesystem. These are never fetched. */
export function isExternal(url) {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/**
 * Minimal YAML frontmatter reader: flat scalars and inline lists only, which is
 * all any doc frontmatter in practice needs.
 */
export function parseFrontmatter(source) {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { data: {}, body: source, hasFrontmatter: false };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_.\-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim().replace(/^["']|["']$/g, '');
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\[.*\]$/.test(value)) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    data[kv[1]] = value;
  }
  return { data, body: text.slice(match[0].length), hasFrontmatter: true };
}

/**
 * Converts one gitignore-style pattern to a regex against a posix relative path.
 *
 * Scanned character by character rather than through chained replaces, so glob
 * expansion and regex escaping cannot interfere with each other.
 */
function patternToRegex(pattern) {
  const anchored = pattern.startsWith('/');
  let body = anchored ? pattern.slice(1) : pattern;
  if (body.endsWith('/')) body = body.slice(0, -1);

  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '*') {
      if (body[i + 1] === '*') {
        i += 1;
        if (body[i + 1] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }

  const prefix = anchored ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${out}(?:/.*)?$`);
}

/**
 * Reads a skip list (`.docsignore`) and returns a matcher.
 *
 * A missing file means nothing is skipped. Callers decide whether that is
 * acceptable; for publishing, an empty skip list is never sufficient on its own.
 */
export function loadIgnoreFile(root, name = '.docsignore') {
  const path = join(root, name);
  if (!existsSync(path)) return { patterns: [], matches: () => false, path: null };
  const patterns = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const regexes = patterns.map(patternToRegex);
  return {
    patterns,
    path: toPosix(path),
    matches: (relPath) => regexes.some((re) => re.test(toPosix(relPath))),
  };
}

/** Anchors a markdown file answers to: heading slugs plus explicit HTML anchors. */
export function anchorsOf(source) {
  return new Set([
    ...extractHeadings(source).map((h) => h.slug),
    ...extractHtmlAnchors(source),
  ]);
}

/**
 * Splits a link into a filesystem path and an anchor, dropping any query string.
 * Percent-encoding is decoded so `my%20doc.md` finds `my doc.md`.
 */
export function splitLink(url) {
  const hash = url.indexOf('#');
  const anchor = hash === -1 ? null : url.slice(hash + 1);
  let path = hash === -1 ? url : url.slice(0, hash);
  path = path.split('?')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* leave the raw path; a malformed escape is reported as missing */
  }
  return { path, anchor };
}

/**
 * Resolves a relative link the way a reader would: as written first, then
 * against the repo root. Root-absolute links only ever resolve against the root.
 */
export function resolveLinkPath(path, fileDir, root) {
  const candidates = path.startsWith('/')
    ? [join(root, path.slice(1))]
    : [resolve(fileDir, path), resolve(root, path)];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Checks every relative link and anchor in one markdown file.
 *
 * Shared by check-doc-links (as the whole job) and scan-docs (as the baseline),
 * so both report identical breakage for the same input.
 */
export function checkMarkdownFile(file, root, { anchorsOnly = false } = {}) {
  const source = readText(file);
  if (source === null) return { checked: 0, broken: [], linkedSources: [] };

  const fileDir = dirname(file);
  const { links, definitions, uses } = extractLinks(source);
  const broken = [];
  const linkedSources = new Set();
  const anchorCache = new Map([[file, anchorsOf(source)]]);
  let checked = 0;

  const anchorsFor = (target) => {
    if (!anchorCache.has(target)) {
      const text = readText(target);
      anchorCache.set(target, text === null ? new Set() : anchorsOf(text));
    }
    return anchorCache.get(target);
  };

  const report = (line, link, reason) =>
    broken.push({ file: toPosix(relative(root, file)) || toPosix(file), line, link, reason });

  for (const { url, line, kind } of links) {
    // Template placeholders are authored deliberately and resolve at render time.
    if (isExternal(url) || url.startsWith('{{')) continue;
    checked += 1;

    const { path, anchor } = splitLink(url);

    if (path === '') {
      if (anchor && !anchorsFor(file).has(anchor)) {
        report(line, url, `no heading in this file matches #${anchor}`);
      }
      continue;
    }

    if (anchorsOnly) continue;

    const target = resolveLinkPath(path, fileDir, root);
    if (!target) {
      report(line, url, `${kind === 'image' ? 'image' : 'path'} does not exist`);
      continue;
    }

    const isDoc = DOC_EXTS.some((e) => target.toLowerCase().endsWith(e));
    if (!isDoc && !isDir(target)) linkedSources.add(toPosix(relative(root, target)));

    if (anchor && isDoc && !anchorsFor(target).has(anchor)) {
      report(line, url, `${toPosix(relative(root, target))} has no heading matching #${anchor}`);
    }
  }

  for (const { label, line } of uses) {
    if (!definitions.has(label)) {
      checked += 1;
      report(line, `[${label}]`, 'reference-style link has no matching definition');
    }
  }

  return { checked, broken, linkedSources: [...linkedSources] };
}

export function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

const WEB_FRAMEWORK_DEPS = [
  ['next', 'next'],
  ['@remix-run/react', 'remix'],
  ['@sveltejs/kit', 'sveltekit'],
  ['nuxt', 'nuxt'],
  ['astro', 'astro'],
  ['@nestjs/core', 'nest'],
  ['express', 'express'],
  ['expo', 'expo'],
  ['react-native', 'react-native'],
];

/**
 * Best-effort framework identification, shared so the scanner and the publisher
 * never disagree about what kind of project they are looking at.
 */
export function detectWebFramework(root) {
  const pkgRaw = readText(join(root, 'package.json'));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const hit = WEB_FRAMEWORK_DEPS.find(([dep]) => deps[dep]);
      if (hit) return hit[1];
    } catch {
      /* an unparseable package.json is not this script's problem to report */
    }
  }
  if (existsSync(join(root, 'manage.py'))) return 'django';
  if (existsSync(join(root, 'config', 'routes.rb'))) return 'rails';
  if (existsSync(join(root, 'artisan'))) return 'laravel';
  return null;
}

/** Parses `--flag value` style args against a spec of known flags. */
export function parseArgs(argv, { script, flags = {}, booleans = [] }) {
  const args = { _: [], ...flags };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const camel = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (booleans.includes(camel)) {
      args[camel] = true;
    } else if (camel in flags) {
      args[camel] = argv[i + 1];
      i += 1;
    } else {
      fail(script, `unknown flag ${arg}`);
    }
  }
  return args;
}

export function print(value, quiet) {
  if (!quiet) console.log(JSON.stringify(value, null, 2));
}
