#!/usr/bin/env node
/**
 * Scans a project for everything a handover has to say, and verifies a finished
 * turnover pack against what it found.
 *
 * Two modes, one entry point, because the second is only meaningful against the
 * first: verification asks "did the document mention what the scan discovered?"
 *
 * The scan is read-only and never executes a project command. It does not run
 * the tests, the deploy or the backup - a handover scan has to be safe to point
 * at a system nobody understands yet.
 *
 * Usage:
 *   node scan-project.mjs [--root <dir>] [--section <key,key>]
 *                         [--max-files <n>] [--max-file-bytes <n>] [--quiet]
 *   node scan-project.mjs --verify <doc-path> [--root <dir>]
 *
 * Exit codes:
 *   0  scan completed / document verified clean
 *   1  usage error
 *   2  verify found a secret in the document - nothing else matters until it is gone
 *   3  verify found coverage gaps
 */

import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  fail, parseArgs, print, toPosix, readText, checkMarkdownFile, extractHeadings, stripCode,
} from './_shared.mjs';

import {
  SECRET_PATTERNS, findGenericSecret, buildContext, scanCode,
  detectStack, detectEntryPoints, detectTasks, detectEnv, detectServices,
  detectDatastores, detectDeploy, detectSchedules, detectSecretSurface,
  detectGates, detectDocs, detectOwnership, buildHealth, buildUnknowns,
} from './_detect.mjs';

const SCRIPT = 'scan-project';

const args = parseArgs(process.argv.slice(2), {
  script: SCRIPT,
  flags: { root: process.cwd(), section: null, maxFiles: '20000', maxFileBytes: '512000', verify: null },
  booleans: ['quiet', 'help'],
});

if (args.help) {
  console.log(readText(new URL(import.meta.url).pathname)?.split('*/')[0] ?? '');
  process.exit(0);
}

const root = resolve(args.root);
if (!existsSync(root)) fail(SCRIPT, `root does not exist: ${root}`);

const maxFiles = Number(args.maxFiles) || 20000;
const maxFileBytes = Number(args.maxFileBytes) || 512000;

/* ------------------------------------------------------------------ */
/* Scan
/* ------------------------------------------------------------------ */

function runScan() {
  const ctx = buildContext(root, { maxFiles, maxFileBytes });
  const code = scanCode(ctx);

  const stack = detectStack(ctx, code);
  const entryPoints = detectEntryPoints(ctx, code);
  const tasks = detectTasks(ctx);
  const env = detectEnv(ctx, code);
  const services = detectServices(ctx, code, env);
  const datastores = detectDatastores(ctx, code, env);
  const deploy = detectDeploy(ctx);
  const schedules = detectSchedules(ctx, code);
  const secretSurface = detectSecretSurface(ctx, code);
  const gates = detectGates(ctx, tasks, deploy);
  const docs = detectDocs(ctx, code, checkMarkdownFile);
  const ownership = detectOwnership(ctx);

  // Backup task and migrations belong to the datastore section, and only the
  // task list knows what a backup command is called here.
  const backupTask = tasks.find((t) => t.classification === 'backup') ?? null;
  for (const d of datastores) d.backupTask = backupTask ? { name: backupTask.name, command: backupTask.command } : null;

  const partial = {
    stack, entryPoints, tasks, env, services, datastores,
    deploy, schedules, secretSurface, gates, docs, ownership,
  };
  const health = buildHealth(partial, code);
  const unknowns = buildUnknowns(partial);

  return {
    root: toPosix(root),
    generatedAt: new Date().toISOString(),
    timestampMethod: ctx.gitAvailable ? 'git' : 'mtime',
    ...partial,
    health,
    unknowns,
    limits: {
      ...ctx.limits,
      note: ctx.limits.truncated
        ? `Walk stopped at ${ctx.limits.maxFiles} files. This report is PARTIAL - say so in the document.`
        : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Verify
/* ------------------------------------------------------------------ */

/**
 * The facts a turnover document is not allowed to silently omit.
 *
 * Each carries a distinctive token to look for. A miss is a gap to justify, not
 * an automatic failure: an author may consciously leave something out, but not
 * accidentally.
 */
function highSignalFacts(report) {
  const facts = [];
  const add = (key, token, why) => {
    if (token && String(token).length > 2) facts.push({ key, token: String(token), why });
  };

  for (const p of report.deploy.paths) {
    add(`deploy:${p.id}`, p.target ?? p.file, 'a deployment path the incoming owner has to know about');
    for (const h of p.hosts ?? []) add(`deploy-host:${h}`, h, 'a host the system is deployed to');
  }
  for (const s of report.schedules) {
    add(`schedule:${s.id}`, s.taskName ?? s.file, 'a job that runs on a schedule');
  }
  for (const f of report.secretSurface.filesOnDisk) {
    add(`credential:${f.path}`, f.path, 'a credential that has to be transferred or rotated');
  }
  for (const c of report.secretSurface.ciSecretNames) {
    add(`ci-secret:${c.name}`, c.name, 'a CI secret the incoming owner must be granted');
  }
  for (const s of report.services.filter((x) => x.kind !== 'unknown')) {
    // A document names the vendor, not the scanner's label for it: "Microsoft
    // Entra SAML SSO" should satisfy the "SAML identity provider" fact. Match
    // on the label's distinctive first word rather than the whole phrase.
    const token = /[ /]/.test(s.name) ? (s.name.match(/[A-Za-z][A-Za-z0-9.]{2,}/)?.[0] ?? s.name) : s.name;
    add(`service:${s.name}`, token, 'an external service the system depends on');
  }
  for (const d of report.datastores) add(`datastore:${d.engine}`, d.engine, 'where the data lives');
  for (const f of report.health.findings.filter((x) => x.severity === 'critical' || x.severity === 'high')) {
    // Only file-shaped evidence makes a checkable token. A finding whose
    // evidence is a phrase ("Randy - 99% of commits") would demand that exact
    // sentence appear verbatim, which is a test of transcription, not coverage.
    add(`risk:${f.id}`, f.factToken ?? f.evidence?.[0]?.file ?? null, `a ${f.severity} risk: ${f.title}`);
  }

  // Several detectors legitimately point at the same file. Asking twice about
  // one token inflates the gap count and tells the author nothing new.
  const seen = new Set();
  return facts.filter((f) => {
    const key = f.token.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const REQUIRED_SECTIONS = [
  { key: 'purpose', re: /what this is|overview|purpose|about/i },
  { key: 'system', re: /system|architecture|stack|repository map/i },
  { key: 'services', re: /service|dependenc|integrat|vendor|account/i },
  { key: 'data', re: /\bdata\b|database|backup|restore/i },
  { key: 'config', re: /environment|configuration|env var/i },
  { key: 'deployment', re: /deploy|release|ship/i },
  { key: 'operations', re: /operation|runbook|start|stop|restart|logs|health/i },
  { key: 'credentials', re: /credential|access|secret|key|permission/i },
  { key: 'testing', re: /test|quality|gate|ci\b/i },
  { key: 'risk', re: /risk|health|issue|debt/i },
  { key: 'open-items', re: /open item|in.flight|wip|known bug|backlog/i },
  { key: 'unknowns', re: /unknown|unanswered|open question/i },
  { key: 'onboarding', re: /onboard|30|first (week|month|day)|ramp/i },
  { key: 'contacts', re: /contact|escalation|who to (call|ask)|owner/i },
  { key: 'provenance', re: /how this .* produced|methodolog|verified|sources? read/i },
];

/**
 * An unfilled template, which is the commonest real failure of a
 * template-driven document.
 *
 * The bare markers must not be followed by `/`: a turnover pack legitimately
 * reports on "TODO/FIXME markers in the codebase", and flagging that sentence
 * trains the author to ignore this check. Code spans are stripped before this
 * runs, so `guide-<filename>` in prose about a naming scheme is not a hit.
 */
const PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}|<[A-Z_]{3,}>|\bTBD\b|\b(?:TODO|FIXME|XXX)\b(?!\s*[/&])|\[fill in\]|\bLorem ipsum\b/i;

function runVerify(docPath) {
  const abs = resolve(root, docPath);
  if (!existsSync(abs)) fail(SCRIPT, `document does not exist: ${toPosix(abs)}`);

  const source = readText(abs);
  if (source === null) fail(SCRIPT, `could not read ${toPosix(abs)}`);

  const report = runScan();
  const lines = source.split(/\r?\n/);
  const headings = extractHeadings(source);
  const headingText = headings.map((h) => h.text).join('\n');
  const haystack = source.toLowerCase();

  // 1. Secrets. This one is a hard stop, and it runs first for that reason.
  const secrets = [];
  lines.forEach((line, i) => {
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line)) { secrets.push({ line: i + 1, reason: name }); return; }
    }
    const generic = findGenericSecret(line);
    if (generic) secrets.push({ line: i + 1, reason: generic });
  });

  const requiredSections = REQUIRED_SECTIONS.map((s) => ({
    key: s.key,
    present: s.re.test(headingText),
  }));

  const factCoverage = highSignalFacts(report).map((f) => ({
    ...f,
    mentioned: haystack.includes(f.token.toLowerCase()),
  }));

  const { broken } = checkMarkdownFile(abs, root);

  const placeholdersLeft = [];
  stripCode(source).split(/\r?\n/).forEach((line, i) => {
    const m = line.match(PLACEHOLDER_RE);
    if (m) placeholdersLeft.push({ line: i + 1, text: m[0], context: lines[i].trim().slice(0, 120) });
  });

  // An unknown counts as addressed if the document either answers it or lists it
  // openly. Both are acceptable; silence is not. Matched on the question's
  // distinctive subject rather than its ordinary words - a document full of the
  // word "credential" must not read as having answered every credential question.
  const unresolvedQuestions = report.unknowns
    .filter((u) => {
      if (!u.subject) return false;
      return !haystack.includes(u.subject.toLowerCase());
    })
    .map((u) => ({ id: u.id, question: u.question, subject: u.subject }));

  const missingSections = requiredSections.filter((s) => !s.present);
  const uncovered = factCoverage.filter((f) => !f.mentioned);

  let verdict = 'complete';
  if (secrets.length) verdict = 'unsafe';
  else if (missingSections.length || uncovered.length || placeholdersLeft.length || broken.length) verdict = 'incomplete';

  const result = {
    doc: toPosix(abs),
    scannedAt: report.generatedAt,
    verdict,
    secrets,
    requiredSections,
    missingSections: missingSections.map((s) => s.key),
    factCoverage,
    uncoveredFacts: uncovered,
    deadPaths: broken,
    placeholdersLeft,
    unresolvedQuestions,
    summary: {
      sectionsMissing: missingSections.length,
      factsUncovered: uncovered.length,
      deadLinks: broken.length,
      placeholders: placeholdersLeft.length,
      openQuestionsNotAddressed: unresolvedQuestions.length,
    },
  };

  print(result, args.quiet);
  if (secrets.length) {
    console.error(`${SCRIPT}: ${secrets.length} possible secret(s) in ${toPosix(abs)}. Remove them before anything else.`);
    process.exit(2);
  }
  if (verdict === 'incomplete') process.exit(3);
  process.exit(0);
}

/* ------------------------------------------------------------------ */

if (args.verify) {
  runVerify(args.verify);
} else {
  const report = runScan();
  if (args.section) {
    const keys = String(args.section).split(',').map((k) => k.trim()).filter(Boolean);
    const subset = { root: report.root, generatedAt: report.generatedAt };
    for (const k of keys) {
      if (!(k in report)) fail(SCRIPT, `unknown section "${k}". Available: ${Object.keys(report).join(', ')}`);
      subset[k] = report[k];
    }
    print(subset, args.quiet);
  } else {
    print(report, args.quiet);
  }
  process.exit(0);
}
