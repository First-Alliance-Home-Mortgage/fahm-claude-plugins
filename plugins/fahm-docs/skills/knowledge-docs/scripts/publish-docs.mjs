#!/usr/bin/env node
/**
 * Prepares documentation for an unauthenticated audience.
 *
 * Three things happen, in order, and the first can stop the other two:
 *   1. Redact - refuse outright on a secret, strip internal hosts from the copy.
 *   2. Export - write redacted copies to a public directory.
 *   3. Propose - report where a public route and footer link would go.
 *
 * It never edits auth middleware, routing or navigation. Making a route
 * reachable without a session is the one change where a wrong automated edit
 * exposes a whole application, so the proposal is printed for a human to apply.
 *
 * Usage:
 *   node publish-docs.mjs <path|--all> [--root <dir>] [--source <dir>]
 *                         [--out <dir>] [--dry-run] [--propose-only]
 *
 * Exit codes:
 *   0  exported cleanly
 *   1  usage error
 *   2  secrets found - nothing was written
 */

import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';

import {
  DOC_EXTS, walk, toPosix, readText, fail, parseArgs, print,
  parseFrontmatter, loadIgnoreFile, detectWebFramework,
} from './_shared.mjs';

const SCRIPT = 'publish-docs';

/**
 * High-signal secret patterns only. A hit stops the run rather than warning,
 * because a warning that can be scrolled past is not a control once the
 * destination is readable without a login. False positives are the safe
 * direction to fail in.
 */
const SECRET_PATTERNS = [
  { name: 'private key block', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: 'JSON web token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'connection string with credentials',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|ftp):\/\/[^\s:@/]+:[^\s@/]+@/,
  },
];

/** Obvious stand-ins. Without this filter the generic rule flags every example. */
const PLACEHOLDER = /^(?:x{3,}|\.{3,}|\*{3,}|-+|_+|)$|your|example|placeholder|changeme|dummy|sample|redacted|todo|insert|<|\{\{|\$\{|process\.env|os\.environ/i;

/** A credential-shaped assignment with a value that does not look like a stand-in. */
function findGenericSecret(line) {
  const match = line.match(
    /(api[_-]?key|secret|password|passwd|pwd|token|access[_-]?key|private[_-]?key|client[_-]?secret|auth)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-/+=.]{16,})["']?/i
  );
  if (!match) return null;
  if (PLACEHOLDER.test(match[2])) return null;
  // Require some character variety; a run of one class is usually a hash example.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(match[2])).length;
  return classes >= 2 ? `credential-shaped assignment to ${match[1]}` : null;
}

/**
 * Internal locations that must not survive into a public copy. These are
 * redacted, not refused - unlike a secret, an internal URL is a leak of shape
 * rather than of access.
 */
const REDACTIONS = [
  {
    name: 'tunnel URL',
    re: /https?:\/\/[a-z0-9-]+\.(?:ngrok(?:-free)?\.(?:io|app|dev)|loca\.lt|trycloudflare\.com|serveo\.net)[^\s)"'<>]*/gi,
  },
  {
    name: 'localhost URL',
    re: /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s)"'<>]*/gi,
  },
  {
    name: 'private network URL',
    re: /https?:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?[^\s)"'<>]*/gi,
  },
  {
    name: 'internal hostname',
    re: /https?:\/\/[a-z0-9.-]+\.(?:internal|local|localdomain|corp|lan|intranet|test)(?::\d+)?[^\s)"'<>]*/gi,
  },
  {
    name: 'admin console URL',
    re: /https?:\/\/[^\s)"'<>]*\/(?:admin|wp-admin|_admin|console)(?:\/[^\s)"'<>]*)?/gi,
  },
  {
    // 10.x is deliberately absent: it collides with version strings like 10.0.26200.
    name: 'private IP address',
    re: /\b(?:192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g,
  },
];

function scanSecrets(relPath, source) {
  const hits = [];
  source.split(/\r?\n/).forEach((line, i) => {
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line)) hits.push({ file: relPath, line: i + 1, reason: name });
    }
    const generic = findGenericSecret(line);
    if (generic) hits.push({ file: relPath, line: i + 1, reason: generic });
  });
  return hits;
}

/**
 * Removes internal locations from the published copy. A markdown link keeps its
 * text and loses its href, so the sentence still reads; a bare URL is replaced
 * outright.
 */
function redact(relPath, source) {
  const applied = [];
  let out = source;

  for (const { name, re } of REDACTIONS) {
    const linked = new RegExp(`\\[([^\\]\\n]*)\\]\\(\\s*(?:${re.source})\\s*\\)`, 'gi');
    out = out.replace(linked, (match, text) => {
      applied.push({ file: relPath, kind: name, was: match.trim(), now: text });
      return text;
    });

    re.lastIndex = 0;
    out = out.replace(re, (match) => {
      const replacement = name === 'private IP address' ? '[internal address removed]' : '[internal link removed]';
      applied.push({ file: relPath, kind: name, was: match, now: replacement });
      return replacement;
    });
  }

  return { content: out, applied };
}

/** Where a public docs route and its entry link would go, per framework. */
function routePlan(root, framework) {
  const has = (p) => existsSync(join(root, p));
  const appDir = has('src/app') ? 'src/app' : has('app') ? 'app' : null;
  const pagesDir = has('src/pages') ? 'src/pages' : has('pages') ? 'pages' : null;

  switch (framework) {
    case 'next':
      if (appDir) {
        return {
          routes: [`${appDir}/help/page.tsx`, `${appDir}/help/[slug]/page.tsx`],
          note: 'Next.js app router',
        };
      }
      return {
        routes: pagesDir ? [`${pagesDir}/help/index.tsx`, `${pagesDir}/help/[slug].tsx`] : [],
        note: 'Next.js pages router',
      };
    case 'remix':
      return { routes: ['app/routes/help._index.tsx', 'app/routes/help.$slug.tsx'], note: 'Remix flat routes' };
    case 'sveltekit':
      return { routes: ['src/routes/help/+page.svelte', 'src/routes/help/[slug]/+page.svelte'], note: 'SvelteKit' };
    case 'nuxt':
      return { routes: ['pages/help/index.vue', 'pages/help/[slug].vue'], note: 'Nuxt' };
    case 'astro':
      return { routes: ['src/pages/help/index.astro', 'src/pages/help/[slug].astro'], note: 'Astro' };
    case 'django':
      return { routes: ['urls.py'], note: 'Django URLconf' };
    case 'rails':
      return { routes: ['config/routes.rb'], note: 'Rails routes' };
    case 'laravel':
      return { routes: ['routes/web.php'], note: 'Laravel routes' };
    default:
      return { routes: [], note: null };
  }
}

/** Conventional single-file auth chokepoints, by framework. */
const AUTH_FILES = [
  'middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js',
  'app/middleware.ts', 'src/hooks.server.ts', 'src/middleware.py',
  'config/initializers/devise.rb', 'app/Http/Kernel.php', 'app/Http/Middleware/Authenticate.php',
];

/** Paths that probably enforce auth, used when no conventional file exists. */
const AUTH_HINT = /(^|\/)(middleware|auth|session|guard|authorize|permission|protected)/i;

const CODE_EXTS = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.astro', '.py', '.rb', '.php'];

function findAuthCandidates(root) {
  const searchRoots = ['src', 'app', 'lib', 'config']
    .map((d) => join(root, d))
    .filter((d) => existsSync(d));

  const found = [];
  for (const dir of searchRoots) {
    for (const file of walk(dir, { exts: CODE_EXTS })) {
      const rel = toPosix(relative(root, file));
      // Skip the app's own auth *pages* - they are protected by the thing we want, not it.
      if (/\/(api|app)\/.*\/(login|signin|signup|register)\//i.test(rel)) continue;
      if (AUTH_HINT.test(rel)) found.push(rel);
    }
  }
  return [...new Set(found)].sort().slice(0, 8);
}

/**
 * Site chrome a "Help" link would belong in.
 *
 * Deliberately strict. An over-long list of maybe-nav files is worse than an
 * empty one: it buries the real footer and trains the reader to skim past the
 * proposal entirely.
 */
const NAV_NAME = /^(site)?(footer|navbar|nav|header|topbar|menu|sidebar|mainnav|topnav|sidenav)$/i;
const NAV_EXCLUDE = /(builder|preview|guard|dialog|modal|block|editor|skeleton|test|spec|stories|admin|item|button)/i;

function findNavComponents(root) {
  const searchRoots = [
    'src/components', 'components', 'src/layouts', 'layouts',
    'src/app', 'app', 'resources/views',
  ].map((d) => join(root, d)).filter((d) => existsSync(d));

  const found = [];
  for (const dir of searchRoots) {
    for (const file of walk(dir, { exts: CODE_EXTS })) {
      const rel = toPosix(relative(root, file));
      const base = (file.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '');
      if (NAV_EXCLUDE.test(rel)) continue;
      if (NAV_NAME.test(base)) found.push(rel);
    }
  }
  return [...new Set(found)].sort().slice(0, 6);
}

function buildProposal(root, framework, outRel) {
  const plan = routePlan(root, framework);
  const proposal = [];

  const servesWeb = plan.routes.length > 0;

  if (!servesWeb) {
    // Nothing to expose without a web app. Say so plainly rather than proposing
    // auth changes to a project that serves no routes.
    proposal.push({
      action: 'locate',
      path: '(no web routes)',
      what: framework
        ? `${framework} serves no web routes here - the redacted export is the deliverable`
        : 'no web framework detected - the redacted export is the deliverable',
      security: false,
    });
  } else {
    for (const route of plan.routes) {
      proposal.push({
        action: existsSync(join(root, route)) ? 'modify' : 'create',
        path: route,
        what: 'serve the published docs to visitors without a session',
        security: false,
      });
    }

    // The security entry is emitted whether or not a chokepoint was found. An
    // absent auth line must never read as "no auth change is needed here".
    const authFiles = AUTH_FILES.filter((c) => existsSync(join(root, c)));
    if (authFiles.length > 0) {
      for (const path of authFiles) {
        proposal.push({
          action: 'modify',
          path,
          what: "exempt '/help' and '/help/*' from the authentication check",
          security: true,
          consequence: 'This is the line that makes /help/* readable by anyone on the internet.',
        });
      }
    } else {
      const candidates = findAuthCandidates(root);
      proposal.push({
        action: 'locate',
        path: candidates[0] ?? '(not found)',
        what: 'find where authentication is enforced and exempt /help there',
        security: true,
        consequence:
          'No conventional auth middleware was found, so this script cannot tell you which line to change. ' +
          'Do not assume the route is already public: confirm how the app protects pages before exposing /help.',
        candidates,
      });
    }

    const navs = findNavComponents(root);
    if (navs.length > 0) {
      for (const nav of navs) {
        proposal.push({
          action: 'modify',
          path: nav,
          what: 'add a "Help Center" entry pointing at /help',
          security: false,
        });
      }
    } else {
      proposal.push({
        action: 'locate',
        path: '(not found)',
        what: 'no footer or primary nav component was recognised - add the "Help Center" link by hand',
        security: false,
      });
    }
  }

  const gitignore = readText(join(root, '.gitignore')) ?? '';
  if (!gitignore.split(/\r?\n/).some((l) => l.trim().replace(/\/$/, '') === outRel.replace(/\/$/, ''))) {
    proposal.push({
      action: 'modify',
      path: '.gitignore',
      what: `add ${outRel} - it is regenerated from the source docs and will drift if committed`,
      security: false,
    });
  }

  return { framework, routeNote: plan.note, proposal };
}

const MARK = { create: '+', modify: '~', locate: '?' };

function renderProposal(framework, routeNote, proposal) {
  if (proposal.length === 0) return 'PROPOSED: nothing to wire (no web framework detected).';

  const ordinary = proposal.filter((p) => !p.security);
  const security = proposal.filter((p) => p.security);
  const lines = ['PROPOSED (not applied):'];
  const width = Math.max(...ordinary.map((p) => p.path.length), 1);

  for (const p of ordinary) {
    lines.push(`  ${MARK[p.action]} ${p.path.padEnd(width)}  ${p.what}`);
  }

  for (const p of security) {
    lines.push('', 'SECURITY-RELEVANT - review this on its own, and apply it yourself:');
    lines.push(`  ${MARK[p.action]} ${p.path}  ${p.what}`);
    lines.push(`    ${p.consequence}`);
    if (p.candidates?.length) lines.push(`    Worth checking: ${p.candidates.join(', ')}`);
  }

  if (routeNote) lines.push('', `Route layout assumed: ${routeNote}.`);
  lines.push('Nothing above has been written. Apply what you agree with by hand.');
  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2), {
  script: SCRIPT,
  flags: { root: process.cwd(), out: null, source: null },
  booleans: ['all', 'dryRun', 'proposeOnly', 'quiet'],
});

const root = resolve(args.root);
const sourceDir = resolve(root, args.source ?? (existsSync(join(root, 'docs')) ? 'docs' : '.'));
const outRel = toPosix(args.out ?? 'docs/public');
const outDir = resolve(root, outRel);

let candidates;
if (args.all) {
  candidates = walk(sourceDir, { exts: DOC_EXTS });
} else if (args.proposeOnly && args._.length === 0) {
  // The wiring proposal describes the project, not a document, so it needs no target.
  candidates = [];
} else {
  const target = args._[0];
  if (!target) fail(SCRIPT, 'missing target - pass a markdown file or --all');
  const abs = resolve(target);
  if (!existsSync(abs)) fail(SCRIPT, `no such file: ${target}`);
  candidates = statSync(abs).isDirectory() ? walk(abs, { exts: DOC_EXTS }) : [abs];
}

// Never republish the export itself; that is how a redacted copy gets redacted twice.
candidates = candidates.filter((f) => !resolve(f).startsWith(outDir));

const ignore = loadIgnoreFile(root);
const skipped = [];
const publishable = [];

for (const file of candidates) {
  const relPath = toPosix(relative(root, file));
  if (ignore.matches(relPath)) {
    skipped.push({ file: relPath, reason: `matched ${ignore.path}` });
    continue;
  }
  const source = readText(file);
  if (source === null) {
    skipped.push({ file: relPath, reason: 'unreadable' });
    continue;
  }
  const { data } = parseFrontmatter(source);
  if (data.public === false) {
    skipped.push({ file: relPath, reason: 'frontmatter public: false' });
    continue;
  }
  publishable.push({ file, relPath, source });
}

const secrets = publishable.flatMap(({ relPath, source }) => scanSecrets(relPath, source));

if (secrets.length > 0) {
  print(
    {
      published: false,
      reason: 'secrets detected - nothing was written',
      secrets,
      skipped,
      hint: 'Remove the value from the doc, or add the doc to .docsignore, then run again.',
    },
    args.quiet
  );
  process.exit(2);
}

const { framework, routeNote, proposal } = buildProposal(root, detectWebFramework(root), outRel);

const exported = [];
const redactions = [];

if (!args.proposeOnly) {
  for (const { relPath, source } of publishable) {
    const { content, applied } = redact(relPath, source);
    redactions.push(...applied);

    const destRel = toPosix(join(outRel, relative(sourceDir, resolve(root, relPath))));
    const dest = resolve(root, destRel);
    if (!args.dryRun) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content, 'utf8');
    }
    exported.push({ from: relPath, to: destRel, redactions: applied.length });
  }
}

print(
  {
    published: !args.dryRun && !args.proposeOnly,
    dryRun: Boolean(args.dryRun),
    out: outRel,
    framework,
    exported,
    skipped,
    redactions,
    secrets,
    proposal,
    proposalText: renderProposal(framework, routeNote, proposal),
  },
  args.quiet
);
