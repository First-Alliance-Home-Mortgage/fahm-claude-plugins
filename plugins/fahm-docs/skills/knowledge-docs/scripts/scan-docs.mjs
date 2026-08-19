#!/usr/bin/env node
/**
 * Inventories a project's documentation before anything is written.
 *
 * Answers four questions the model would otherwise guess at: where docs live,
 * what they already cover, what has no doc at all, and which docs are now older
 * than the code they describe.
 *
 * Read-only, offline, zero dependencies.
 *
 * Usage:
 *   node scan-docs.mjs [--root <dir>] [--stale-only] [--quiet]
 *
 * Prints a JSON report to stdout. Exit code is 0 even when gaps or stale docs
 * are found - those are findings, not failures.
 */

import { existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, relative, dirname, extname } from 'node:path';

import {
  DOC_EXTS, IGNORE_DIRS, walk, toPosix, readText, parseArgs, print,
  extractHeadings, parseFrontmatter, checkMarkdownFile, detectWebFramework,
} from './_shared.mjs';

const SCRIPT = 'scan-docs';

const LANGUAGES = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.go': 'Go',
  '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby', '.php': 'PHP',
  '.cs': 'C#', '.swift': 'Swift', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++',
  '.hpp': 'C++', '.m': 'Objective-C', '.mm': 'Objective-C', '.vue': 'Vue',
  '.svelte': 'Svelte', '.sh': 'Shell', '.sql': 'SQL', '.ex': 'Elixir', '.dart': 'Dart',
};

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'go.mod',
  'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile',
  'composer.json', 'mix.exs', 'pubspec.yaml', 'Package.swift',
];

/** Docs-site configs. Presence changes what frontmatter a new doc must carry. */
const GENERATORS = [
  { file: 'mkdocs.yml', name: 'mkdocs' },
  { file: 'mkdocs.yaml', name: 'mkdocs' },
  { file: 'docusaurus.config.js', name: 'docusaurus' },
  { file: 'docusaurus.config.ts', name: 'docusaurus' },
  { file: 'docusaurus.config.mjs', name: 'docusaurus' },
  { file: 'mint.json', name: 'mintlify' },
  { file: 'book.toml', name: 'mdbook' },
  { file: 'antora.yml', name: 'antora' },
  { file: 'conf.py', name: 'sphinx' },
  { file: '.vitepress/config.js', name: 'vitepress' },
  { file: '.vitepress/config.ts', name: 'vitepress' },
  { file: '.vitepress/config.mts', name: 'vitepress' },
];

/**
 * Last-commit timestamps for every path touched in recent history, from one git
 * call. Per-path `git log` would be correct too but costs a process per file.
 */
function gitTimestamps(root) {
  const result = spawnSync(
    'git',
    ['log', '--pretty=format:%cI', '--name-only', '-n', '800'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0 || !result.stdout) return null;

  const map = new Map();
  let current = null;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      current = line.trim();
    } else if (current && !map.has(line)) {
      // git log is newest-first, so the first sighting is the latest change.
      map.set(line, current);
    }
  }
  return map.size > 0 ? map : null;
}

function makeTimestampReader(root) {
  const git = gitTimestamps(root);
  const method = git ? 'git' : 'mtime';
  return {
    method,
    read(absPath) {
      const rel = toPosix(relative(root, absPath));
      if (git && git.has(rel)) return { at: git.get(rel), via: 'git' };
      try {
        return { at: statSync(absPath).mtime.toISOString(), via: 'mtime' };
      } catch {
        return { at: null, via: 'missing' };
      }
    },
  };
}

function detectStack(root) {
  const files = walk(root, {});
  const counts = new Map();
  for (const file of files) {
    const lang = LANGUAGES[extname(file).toLowerCase()];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const languages = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, fileCount]) => ({ name, fileCount }));

  const manifests = MANIFESTS.filter((m) => existsSync(join(root, m)));

  const webFramework = detectWebFramework(root);

  const srcRoots = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name))
    .map((e) => e.name)
    .filter((name) => {
      const inner = walk(join(root, name), {});
      return inner.some((f) => LANGUAGES[extname(f).toLowerCase()]);
    });

  return { languages, manifests, srcRoots, webFramework };
}

function detectGenerator(root, homeDir) {
  for (const { file, name } of GENERATORS) {
    if (existsSync(join(root, file))) return name;
    if (homeDir !== '.' && existsSync(join(root, homeDir, file))) return name;
  }
  return null;
}

/** The doc's home is its first path segment, or "." for a doc at the repo root. */
function homeOf(relPath) {
  const parts = relPath.split('/');
  return parts.length === 1 ? '.' : parts[0];
}

const args = parseArgs(process.argv.slice(2), {
  script: SCRIPT,
  flags: { root: process.cwd() },
  booleans: ['staleOnly', 'quiet'],
});

const root = resolve(args.root);
const stamps = makeTimestampReader(root);
const stack = detectStack(root);

const docFiles = walk(root, { exts: DOC_EXTS });
const docs = [];
const brokenLinks = [];

for (const file of docFiles) {
  const relPath = toPosix(relative(root, file));
  const source = readText(file);
  if (source === null) continue;

  const { data, hasFrontmatter } = parseFrontmatter(source);
  const check = checkMarkdownFile(file, root);
  brokenLinks.push(...check.broken);

  docs.push({
    path: relPath,
    home: homeOf(relPath),
    bytes: Buffer.byteLength(source, 'utf8'),
    hasFrontmatter,
    frontmatterKeys: Object.keys(data),
    headings: extractHeadings(source).map((h) => `${'#'.repeat(h.level)} ${h.text}`),
    linkedSources: check.linkedSources,
    lastModified: stamps.read(file).at,
  });
}

const docHomes = [...new Set(docs.map((d) => d.home))].map((home) => {
  const inHome = docs.filter((d) => d.home === home);
  const withFm = inHome.filter((d) => d.hasFrontmatter).length;
  return {
    path: home,
    docCount: inHome.length,
    generator: detectGenerator(root, home),
    frontmatterUse: withFm === 0 ? 'none' : withFm === inHome.length ? 'all' : 'some',
    frontmatterKeys: [...new Set(inHome.flatMap((d) => d.frontmatterKeys))],
  };
}).sort((a, b) => b.docCount - a.docCount);

// A module counts as documented if any doc links to a file inside it. Shallow on
// purpose: a short honest gap list gets read, a speculative one gets ignored.
const documented = new Set(docs.flatMap((d) => d.linkedSources.map((s) => s.split('/')[0])));
const gaps = stack.srcRoots
  .filter((name) => !documented.has(name))
  .map((module) => ({ module, reason: 'no doc links to any file in this directory' }));

const stale = [];
for (const doc of docs) {
  if (!doc.lastModified || doc.linkedSources.length === 0) continue;
  const newer = doc.linkedSources
    .map((src) => ({ src, at: stamps.read(join(root, src)).at }))
    .filter((s) => s.at && s.at > doc.lastModified);
  if (newer.length > 0) {
    stale.push({
      doc: doc.path,
      docModified: doc.lastModified,
      newerSources: newer.sort((a, b) => (a.at < b.at ? 1 : -1)),
      method: stamps.method,
    });
  }
}

const report = {
  root: toPosix(root),
  timestampMethod: stamps.method,
  stack,
  docHomes,
  docs: docs.map(({ home, frontmatterKeys, ...rest }) => rest),
  gaps,
  stale,
  brokenLinks,
};

print(args.staleOnly ? { root: report.root, timestampMethod: stamps.method, stale } : report, args.quiet);
