#!/usr/bin/env node
/**
 * Verifies that every relative link and anchor in a markdown file resolves.
 *
 * Offline and deterministic: external URLs are skipped rather than fetched, so
 * this is safe in CI and gives the same answer every run.
 *
 * Usage:
 *   node check-doc-links.mjs <file-or-dir> [--root <dir>] [--anchors-only] [--quiet]
 *
 * Prints a JSON result to stdout and exits 1 when anything is broken:
 *   { "checked": 42, "files": 6, "broken": [{ file, line, link, reason }] }
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DOC_EXTS, walk, fail, parseArgs, print, checkMarkdownFile,
} from './_shared.mjs';

const SCRIPT = 'check-doc-links';

const args = parseArgs(process.argv.slice(2), {
  script: SCRIPT,
  flags: { root: process.cwd() },
  booleans: ['anchorsOnly', 'quiet'],
});

const target = args._[0];
if (!target) fail(SCRIPT, 'missing target - expected a markdown file or a directory');
if (!existsSync(target)) fail(SCRIPT, `no such file or directory: ${target}`);

const root = resolve(args.root);
const files = statSync(target).isDirectory()
  ? walk(resolve(target), { exts: DOC_EXTS })
  : [resolve(target)];

let checked = 0;
const broken = [];
for (const file of files) {
  const result = checkMarkdownFile(file, root, { anchorsOnly: args.anchorsOnly });
  checked += result.checked;
  broken.push(...result.broken);
}

print({ checked, files: files.length, broken }, args.quiet);
process.exit(broken.length > 0 ? 1 : 0);
