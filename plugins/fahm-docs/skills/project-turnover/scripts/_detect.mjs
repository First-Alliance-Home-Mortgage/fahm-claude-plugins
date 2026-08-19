/**
 * Turnover-specific detectors.
 *
 * Zero dependencies, no network, read-only. Nothing here writes a file, opens a
 * socket, or executes a project command: the whole point of a handover scan is
 * that it is safe to run against a system nobody understands yet.
 *
 * The design constraint that shapes this file: the tree is walked exactly once
 * and every text file is read at most once, because `grep -rn` over a real
 * project times out. Detectors consume a prepared index rather than searching.
 *
 * The other constraint: this output is printed into a transcript. It must be
 * safe by construction, not by later redaction. Credential files are recorded
 * by name and never opened; `.env` values are never read; declared values are
 * reduced to a shape.
 */

import { readFileSync, statSync, readdirSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { join, extname, basename, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import { IGNORE_DIRS, toPosix, readText, loadIgnoreFile } from './_shared.mjs';

/* ------------------------------------------------------------------ */
/* Secret detection - copied from knowledge-docs/scripts/publish-docs.mjs
/* ------------------------------------------------------------------ */

/**
 * High-signal secret patterns only. A hit stops the run rather than warning,
 * because a warning that can be scrolled past is not a control once the
 * destination is readable without a login. False positives are the safe
 * direction to fail in.
 */
export const SECRET_PATTERNS = [
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
export const PLACEHOLDER = /^(?:x{3,}|\.{3,}|\*{3,}|-+|_+|)$|your|example|placeholder|changeme|dummy|sample|redacted|todo|insert|<|\{\{|\$\{|process\.env|os\.environ/i;

/** A credential-shaped assignment with a value that does not look like a stand-in. */
export function findGenericSecret(line) {
  const match = line.match(
    /(api[_-]?key|secret|password|passwd|pwd|token|access[_-]?key|private[_-]?key|client[_-]?secret|auth)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-/+=.]{16,})["']?/i
  );
  if (!match) return null;
  if (PLACEHOLDER.test(match[2])) return null;
  // Require some character variety; a run of one class is usually a hash example.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(match[2])).length;
  return classes >= 2 ? `credential-shaped assignment to ${match[1]}` : null;
}

/* ------------------------------------------------------------------ */
/* Tables
/* ------------------------------------------------------------------ */

const LANGUAGES = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.go': 'Go', '.rb': 'Ruby',
  '.java': 'Java', '.kt': 'Kotlin', '.scala': 'Scala', '.clj': 'Clojure', '.rs': 'Rust',
  '.php': 'PHP', '.cs': 'C#', '.swift': 'Swift', '.c': 'C', '.h': 'C', '.cpp': 'C++',
  '.sh': 'Shell', '.ps1': 'PowerShell', '.sql': 'SQL', '.tf': 'Terraform', '.hcl': 'HCL',
  '.ex': 'Elixir', '.exs': 'Elixir', '.dart': 'Dart', '.vue': 'Vue', '.svelte': 'Svelte',
};

/** Text we are willing to open. Anything else is inventoried by name only. */
const TEXT_EXTS = new Set([
  ...Object.keys(LANGUAGES),
  '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env', '.md', '.mdx',
  '.txt', '.xml', '.html', '.css', '.scss', '.cmd', '.bat', '.example', '.sample',
  '.template', '.dist', '.lock', '.gradle', '.properties', '.service', '.timer', '',
]);

/** lockfile -> [package manager, ecosystem]. Two in one ecosystem is a finding. */
const LOCKFILES = {
  'pnpm-lock.yaml': ['pnpm', 'node'], 'package-lock.json': ['npm', 'node'],
  'yarn.lock': ['yarn', 'node'], 'bun.lockb': ['bun', 'node'], 'bun.lock': ['bun', 'node'],
  'npm-shrinkwrap.json': ['npm', 'node'],
  'poetry.lock': ['poetry', 'python'], 'uv.lock': ['uv', 'python'],
  'Pipfile.lock': ['pipenv', 'python'], 'pdm.lock': ['pdm', 'python'],
  'go.sum': ['go modules', 'go'], 'Gemfile.lock': ['bundler', 'ruby'],
  'Cargo.lock': ['cargo', 'rust'], 'composer.lock': ['composer', 'php'],
  'gradle.lockfile': ['gradle', 'jvm'], 'packages.lock.json': ['nuget', 'dotnet'],
};

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile',
  'go.mod', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Cargo.toml',
  'composer.json', 'mix.exs', 'pubspec.yaml', 'Package.swift',
];

/**
 * Dependency name -> external service. Deliberately small. Guessing what a
 * vendor does is worse than emitting `kind: "unknown"` and asking, because a
 * confident wrong sentence in a handover doc is believed.
 */
const VENDOR_DEPS = [
  [/^mongoose$|^mongodb$/, 'MongoDB', 'database'],
  [/^pg$|^postgres$|^psycopg2?|^asyncpg$/, 'PostgreSQL', 'database'],
  [/^mysql2?$|^pymysql$/, 'MySQL', 'database'],
  [/^redis$|^ioredis$/, 'Redis', 'cache'],
  [/^@prisma\/client$|^prisma$/, 'Prisma ORM', 'database'],
  [/^openai$|^@azure\/openai$|^anthropic$|^@anthropic-ai\//, 'LLM API', 'ai'],
  [/^nodemailer$|^@sendgrid\/|^postmark$|^resend$/, 'Email / SMTP', 'email'],
  [/^googleapis$|^@google-cloud\//, 'Google APIs', 'cloud'],
  [/^@node-saml\/|^passport-saml$|^python3?-saml$/, 'SAML identity provider', 'identity'],
  [/^@azure\/|^azure-/, 'Azure services', 'cloud'],
  [/^aws-sdk$|^@aws-sdk\/|^boto3$/, 'AWS services', 'cloud'],
  [/^stripe$/, 'Stripe', 'payments'],
  [/^twilio$/, 'Twilio', 'messaging'],
  [/^@sentry\//, 'Sentry', 'observability'],
  [/^bullmq$|^bull$|^celery$|^sidekiq$/, 'Background job queue', 'queue'],
  [/^next-auth$|^@auth\//, 'Auth provider', 'identity'],
];

/** Secret-manager SDKs. Their ABSENCE is the finding: no vault means the
 *  secrets live in someone's password manager, or someone's head. */
const SECRET_MANAGERS = [
  [/@azure\/keyvault-secrets|SecretClient/, 'Azure Key Vault'],
  [/SecretsManagerClient|secretsmanager|SSMClient|ssm\.get_parameter/, 'AWS Secrets Manager / SSM'],
  [/@google-cloud\/secret-manager|SecretManagerServiceClient/, 'Google Secret Manager'],
  [/\bhvac\b|VAULT_ADDR|vault\s+kv\s+get/, 'HashiCorp Vault'],
  [/\bdoppler\s+run\b|DOPPLER_TOKEN/, 'Doppler'],
  [/\bop\s+run\b|\bop\s+read\b/, '1Password CLI'],
  [/\bsops\b|\bage\s+-d\b/, 'sops / age'],
];

/** Commands whose presence in a markdown fence makes it an operational runbook. */
const OPS_COMMANDS = [
  'ssh ', 'scp ', 'plink', 'pscp', 'rsync ', 'systemctl', 'pm2 ', 'nginx',
  'docker run', 'docker compose', 'kubectl', 'az ', 'aws ', 'gcloud', 'pg_dump',
  'certbot', 'ufw ', 'supervisorctl',
];

const RUNBOOK_NAME = /deploy|release|runbook|install|provision|operations?|ops|setup|infra/i;

const CI_FILES = [
  ['.github/workflows/', 'GitHub Actions'], ['.gitlab-ci.yml', 'GitLab CI'],
  ['azure-pipelines.yml', 'Azure Pipelines'], ['Jenkinsfile', 'Jenkins'],
  ['.circleci/config.yml', 'CircleCI'], ['bitbucket-pipelines.yml', 'Bitbucket Pipelines'],
  ['.drone.yml', 'Drone'], ['buildspec.yml', 'AWS CodeBuild'],
];

const PAAS_FILES = {
  'Procfile': 'Heroku / Procfile', 'fly.toml': 'Fly.io', 'vercel.json': 'Vercel',
  'netlify.toml': 'Netlify', 'render.yaml': 'Render', 'app.yaml': 'Google App Engine',
  'railway.json': 'Railway', 'serverless.yml': 'Serverless Framework',
  'samconfig.toml': 'AWS SAM', 'apprunner.yaml': 'AWS App Runner', 'captain-definition': 'CapRover',
};

/** Files that are credentials by name. Contents are NEVER read. */
const SECRET_FILE_RE = /(\.(pem|ppk|key|p12|pfx|jks|keystore|openssh|kdbx|asc|gpg)$)|(^id_(rsa|dsa|ecdsa|ed25519)$)|(^\.env($|\..+))|(^credentials\.json$)|(service[-_]?account.*\.json$)|(^kubeconfig$)|(^\.htpasswd$)/i;

/**
 * Files that hold credentials only sometimes. `.npmrc` is usually a registry
 * setting and occasionally an auth token, and reporting the common case as a
 * committed credential is a false critical - the one severity that must never
 * cry wolf. These are opened, tested for an auth-shaped line, and the contents
 * discarded either way.
 */
const AMBIGUOUS_SECRET_FILE_RE = /^\.(npmrc|pypirc|netrc)$/i;
const AMBIGUOUS_AUTH_RE = /_auth(Token)?\s*=|password\s*=|:_authToken=|\bmachine\s+\S+\s+login\b/i;

/** `.env.example` and friends: placeholders by definition, so safe to parse. */
const ENV_TEMPLATE_RE = /^\.?env[.-](example|sample|template|dist|defaults)$|^\.env\.(example|sample|template|dist|defaults)$|^env\.example$/i;

const ENV_REF_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /os\.environ(?:\.get)?\[?\(?\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
  /os\.Getenv\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
  /ENV(?:\.fetch)?\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
  /System\.getenv\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
  /Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
];

const SCHEDULE_LIBS = [
  [/require\(['"]node-cron['"]\)|from ['"]node-cron['"]|cron\.schedule\(/, 'node-cron'],
  [/new CronJob\(|require\(['"]cron['"]\)/, 'cron'],
  [/node-schedule|scheduleJob\(/, 'node-schedule'],
  [/repeat:\s*\{|repeatOpts|\.add\([^)]*repeat/, 'BullMQ repeatable job'],
  [/BackgroundScheduler|BlockingScheduler|add_job\(/, 'APScheduler'],
  [/beat_schedule|crontab\(/, 'Celery beat'],
  [/schedule\.every\(/, 'schedule (python)'],
  [/sidekiq[-_]cron|Sidekiq::Cron/, 'sidekiq-cron'],
  [/@Scheduled\(|CronTrigger|Quartz/, 'Quartz / Spring @Scheduled'],
];

/**
 * Hosts that are never an operational dependency: documentation, XML schemas,
 * package registries, funding links, font CDNs. Without this the services
 * section fills with `eslint.org` and `paypal.me` and the real integrations get
 * lost in it - and the interview question built from that list is unanswerable.
 */
const HOST_DENYLIST = /(^|\.)(w3|schemas?\.xmlsoap|schemas\.microsoft|schema|nextjs|reactjs|vuejs|nodejs|npmjs|registry\.npmjs|yarnpkg|pypi|rubygems|packagist|maven|golang|rust-lang|eslint|prettier|vitest|jestjs|typescriptlang|tailwindcss|mozilla|developer\.mozilla|stackoverflow|opencollective|patreon|paypal|tidelift|feross|github\.io|gist\.github|help\.github|docs\.github|gstatic|fonts\.googleapis|googletagmanager|google-analytics|creativecommons|spdx|semver|json-schema|opensource)\.[a-z.]+$|\.(example|test|invalid|localhost|local)\.[a-z]+$|^(localhost|example|test|invalid|local)\./i;

/** A path that only exists on one person's machine. */
const PERSONAL_PATH_RE = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+|\/home\/[^/\s"']+|\/Users\/[^/\s"']+/;

const TODO_RE = /\b(TODO|FIXME|HACK|XXX|BUG)\b[:( ]/;

/* ------------------------------------------------------------------ */
/* Context: one walk, one read per file
/* ------------------------------------------------------------------ */

/**
 * Dot-directories worth walking. The shared `walk` skips every dot-entry, which
 * is right for docs and wrong here: `.github/workflows` is usually the single
 * most important directory in a handover.
 */
const DOT_DIRS_ALLOWED = new Set([
  '.github', '.gitlab', '.circleci', '.azuredevops', '.ebextensions', '.platform',
  '.husky', '.config', '.devcontainer', '.aws',
]);

function walkProject(root, maxFiles) {
  const files = [];
  let truncated = false;

  const visit = (dir) => {
    if (truncated) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && !DOT_DIRS_ALLOWED.has(entry.name)) continue;
        visit(full);
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          /* a file that vanished mid-walk is not worth failing over */
        }
        const rel = toPosix(relative(root, full));
        files.push({
          abs: full,
          rel,
          name: entry.name,
          lower: entry.name.toLowerCase(),
          ext: extname(entry.name).toLowerCase(),
          dir: toPosix(relative(root, dir)),
          size,
        });
      }
    }
  };

  visit(root);
  return { files, truncated };
}

/** Reads at most `maxBytes`, so one vendored megabyte cannot stall the scan. */
function readCapped(abs, maxBytes) {
  try {
    const size = statSync(abs).size;
    if (size <= maxBytes) return readFileSync(abs, 'utf8');
    const fd = openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const n = readSync(fd, buf, 0, maxBytes, 0);
      return buf.subarray(0, n).toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function gitOk(root) {
  const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  return res.status === 0 && String(res.stdout).trim() === 'true';
}

function git(root, args) {
  const res = spawnSync('git', args, {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  return res.status === 0 ? String(res.stdout) : null;
}

/**
 * Builds the index every detector reads from.
 *
 * `text` is populated only for text-shaped files under the byte cap, and only
 * once. Credential-shaped files are indexed but their `text` is left null even
 * when small: nothing in this skill has a reason to hold a private key in
 * memory, and the safest way to guarantee it never reaches the output is to
 * never load it.
 */
export function buildContext(root, { maxFiles = 20000, maxFileBytes = 512000 } = {}) {
  const started = Date.now();
  const { files, truncated } = walkProject(root, maxFiles);

  const gitAvailable = gitOk(root);
  let trackedSet = null;
  if (gitAvailable) {
    const out = git(root, ['ls-files', '-z']);
    if (out !== null) trackedSet = new Set(out.split('\0').filter(Boolean));
  }
  const gitignore = loadIgnoreFile(root, '.gitignore');

  let read = 0;
  for (const f of files) {
    f.isSecretFile = SECRET_FILE_RE.test(f.name) && !ENV_TEMPLATE_RE.test(f.name);
    if (AMBIGUOUS_SECRET_FILE_RE.test(f.name)) {
      const probe = readCapped(f.abs, 16384);
      f.isSecretFile = typeof probe === 'string' && AMBIGUOUS_AUTH_RE.test(probe);
    }
    f.isTestFile = /(^|\/)(__tests__|__mocks__|tests?|spec|fixtures?|testdata)\//.test(f.rel)
      || /\.(test|spec)\.[jt]sx?$|_test\.go$|^test_.*\.py$|.*_spec\.rb$/.test(f.name);
    f.tracked = trackedSet ? trackedSet.has(f.rel) : null;
    f.gitignored = gitignore.matches(f.rel);
    if (f.isSecretFile) continue;
    if (!TEXT_EXTS.has(f.ext) && !MANIFESTS.includes(f.name) && !/^[A-Za-z]/.test(f.ext || 'x')) continue;
    if (!TEXT_EXTS.has(f.ext)) continue;
    if (f.size > maxFileBytes * 4) continue;
    f.text = readCapped(f.abs, maxFileBytes);
    if (f.text !== null) read += 1;
  }

  const byName = new Map();
  for (const f of files) {
    if (!byName.has(f.name)) byName.set(f.name, []);
    byName.get(f.name).push(f);
  }

  return {
    root,
    files,
    byName,
    gitAvailable,
    trackedKnown: trackedSet !== null,
    gitignore,
    limits: {
      filesWalked: files.length,
      filesRead: read,
      truncated,
      maxFiles,
      maxFileBytes,
      durationMs: Date.now() - started,
      gitAvailable,
    },
    /** Files at the repo root only - `package.json` here is not `web/package.json`. */
    atRoot: (name) => files.find((f) => f.rel === name) ?? null,
    find: (name) => byName.get(name) ?? [],
    textFiles: () => files.filter((f) => typeof f.text === 'string'),
  };
}

const linesOf = (text) => text.split(/\r?\n/);

const ev = (f, line) => ({ file: f.rel, line });

/* ------------------------------------------------------------------ */
/* Single-pass code scan
/* ------------------------------------------------------------------ */

const CODE_EXT = new Set(Object.keys(LANGUAGES).concat(['.json', '.yml', '.yaml', '.toml', '.cmd', '.bat']));

/**
 * One pass over every code file, collecting everything several detectors need.
 *
 * Split into separate passes this would re-read the tree six times; on a real
 * project that is the difference between a scan and a timeout.
 */
export function scanCode(ctx) {
  const envRefs = new Map();          // NAME -> evidence[]
  const secretManagers = new Map();   // vendor -> evidence[]
  const scheduleHits = [];
  const docConsumers = [];
  const todos = new Map();            // file -> count
  const leaks = [];
  const mainFns = [];
  const imports = new Set();
  const hostnames = new Map();        // host -> evidence[]
  const referencedPaths = new Map();  // path -> evidence[]

  for (const f of ctx.files) {
    if (typeof f.text !== 'string') continue;
    const isCode = CODE_EXT.has(f.ext);
    const isDoc = f.ext === '.md' || f.ext === '.mdx';
    const lines = linesOf(f.text);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const no = i + 1;
      if (line.length > 2000) continue;

      if (isCode) {
        for (const re of ENV_REF_PATTERNS) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(line)) !== null) {
            if (!envRefs.has(m[1])) envRefs.set(m[1], []);
            const list = envRefs.get(m[1]);
            if (list.length < 5) list.push(ev(f, no));
          }
        }

        for (const [re, vendor] of SECRET_MANAGERS) {
          if (re.test(line)) {
            if (!secretManagers.has(vendor)) secretManagers.set(vendor, []);
            const list = secretManagers.get(vendor);
            if (list.length < 3) list.push(ev(f, no));
          }
        }

        for (const [re, lib] of SCHEDULE_LIBS) {
          if (re.test(line)) scheduleHits.push({ lib, file: f.rel, line: no, snippet: line.trim().slice(0, 160) });
        }

        // A source file that reads a documentation directory at runtime: adding
        // a file there changes application behaviour, not just the repo.
        const docDir = line.match(/['"`]([\w./-]*(?:docs?|documentation|guides?|kb|help)[\w./-]*)['"`]/i);
        if (docDir && /readdir|readFileSync|join\(|glob|opendir|listdir|walk|Dir\[/.test(line)) {
          docConsumers.push({ file: f.rel, line: no, dir: docDir[1], snippet: line.trim().slice(0, 160) });
        }

        if (/^\s*func main\(/.test(line)) mainFns.push({ file: f.rel, line: no, kind: 'go' });
        if (/public static void main\s*\(/.test(line)) mainFns.push({ file: f.rel, line: no, kind: 'java' });
        if (/@SpringBootApplication/.test(line)) mainFns.push({ file: f.rel, line: no, kind: 'spring' });
        if (/^if __name__ == ['"]__main__['"]/.test(line)) mainFns.push({ file: f.rel, line: no, kind: 'python' });

        const imp = line.match(/(?:from|require\(|import)\s*['"]([@\w][\w@/.-]*)['"]/);
        if (imp) imports.add(imp[1]);

        // A repo-relative path named in code that may or may not exist on disk.
        const pathLit = line.match(/['"`]((?:\.\/|\.\.\/)?(?:app|src|lib|docs|scripts|config|public|data)\/[\w./-]{2,60})['"`]/);
        if (pathLit && !/\*/.test(pathLit[1])) {
          const p = pathLit[1].replace(/^\.\//, '');
          if (!referencedPaths.has(p)) referencedPaths.set(p, []);
          const list = referencedPaths.get(p);
          if (list.length < 3) list.push(ev(f, no));
        }
      }

      if (isCode && TODO_RE.test(line)) todos.set(f.rel, (todos.get(f.rel) ?? 0) + 1);

      // Hostnames from code and config only. A host in prose is a citation;
      // a host in a config value is something the system talks to.
      if (!isDoc && !f.isTestFile) {
        const host = line.match(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?::\d+)?/i);
        if (host && !/^127\.|^0\./.test(host[1]) && !HOST_DENYLIST.test(host[1])) {
          if (!hostnames.has(host[1])) hostnames.set(host[1], []);
          const list = hostnames.get(host[1]);
          if (list.length < 3) list.push(ev(f, no));
        }
      }

      // Leak check reports a reason, never a value. Test files are excluded:
      // a redaction test contains fake credentials on purpose, and flagging
      // them trains the reader to ignore this list.
      if (!isDoc && !f.isTestFile && f.tracked !== false) {
        for (const { name, re } of SECRET_PATTERNS) {
          if (re.test(line)) { leaks.push({ file: f.rel, line: no, reason: name }); break; }
        }
        const generic = findGenericSecret(line);
        if (generic && !ENV_TEMPLATE_RE.test(f.name)) leaks.push({ file: f.rel, line: no, reason: generic });
      }
    }
  }

  return { envRefs, secretManagers, scheduleHits, docConsumers, todos, leaks, mainFns, imports, hostnames, referencedPaths };
}

/* ------------------------------------------------------------------ */
/* Manifest helpers
/* ------------------------------------------------------------------ */

function rootPkg(ctx) {
  const f = ctx.atRoot('package.json');
  if (!f || typeof f.text !== 'string') return null;
  try {
    return JSON.parse(f.text);
  } catch {
    return null;
  }
}

function allDeps(ctx) {
  const deps = new Map();
  const pkg = rootPkg(ctx);
  if (pkg) {
    for (const [k, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      deps.set(k, String(v));
    }
  }
  for (const name of ['requirements.txt', 'pyproject.toml', 'go.mod', 'Gemfile', 'Cargo.toml', 'composer.json']) {
    const f = ctx.atRoot(name);
    if (!f || typeof f.text !== 'string') continue;
    for (const line of linesOf(f.text)) {
      const m = line.match(/^\s*(?:require\s+)?["']?([a-zA-Z0-9_.@/-]{2,})["']?\s*(?:[=><~^]+|\s)\s*["']?v?([0-9][\w.+-]*)?/);
      if (m && !/^#/.test(line.trim())) deps.set(m[1], m[2] ?? '');
    }
  }
  return deps;
}

/* ------------------------------------------------------------------ */
/* Detectors
/* ------------------------------------------------------------------ */

export function detectStack(ctx, code) {
  const langCount = new Map();
  for (const f of ctx.files) {
    const lang = LANGUAGES[f.ext];
    if (lang) langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
  }
  const languages = [...langCount.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files);

  const manifests = MANIFESTS.filter((m) => ctx.atRoot(m)).map((m) => m);

  const lockfiles = [];
  for (const [name, [manager, ecosystem]] of Object.entries(LOCKFILES)) {
    if (ctx.atRoot(name)) lockfiles.push({ file: name, manager, ecosystem });
  }
  const byEco = new Map();
  for (const l of lockfiles) {
    if (!byEco.has(l.ecosystem)) byEco.set(l.ecosystem, []);
    byEco.get(l.ecosystem).push(l);
  }
  const conflicts = [...byEco.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([ecosystem, list]) => ({
      ecosystem,
      lockfiles: list.map((l) => l.file),
      note: `Two ${ecosystem} lockfiles. Whichever the CI uses, a newcomer running the other resolves a different dependency tree.`,
    }));

  const pkg = rootPkg(ctx);
  let packageManager = lockfiles[0]?.manager ?? null;
  if (pkg?.packageManager) packageManager = String(pkg.packageManager);
  // No lockfile still means a dependency mechanism, and a handover has to name
  // the one command that installs this project.
  if (!packageManager) {
    const fallback = [
      ['go.mod', 'go modules'], ['requirements.txt', 'pip'], ['Pipfile', 'pipenv'],
      ['pyproject.toml', 'pip / pyproject'], ['Gemfile', 'bundler'],
      ['pom.xml', 'maven'], ['build.gradle', 'gradle'], ['Cargo.toml', 'cargo'],
      ['composer.json', 'composer'], ['package.json', 'npm (no lockfile committed)'],
    ].find(([n]) => ctx.atRoot(n));
    if (fallback) packageManager = fallback[1];
  }

  const deps = allDeps(ctx);
  const frameworks = [];
  const fw = [
    ['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['nuxt', 'Nuxt'],
    ['@sveltejs/kit', 'SvelteKit'], ['astro', 'Astro'], ['@nestjs/core', 'NestJS'],
    ['express', 'Express'], ['fastify', 'Fastify'], ['django', 'Django'],
    ['flask', 'Flask'], ['fastapi', 'FastAPI'], ['rails', 'Rails'],
    ['spring-boot', 'Spring Boot'], ['laravel/framework', 'Laravel'],
    ['tailwindcss', 'Tailwind CSS'], ['mongoose', 'Mongoose'], ['prisma', 'Prisma'],
  ];
  for (const [dep, label] of fw) if (deps.has(dep)) frameworks.push(label);
  if (ctx.atRoot('manage.py') && !frameworks.includes('Django')) frameworks.push('Django');

  const runtimes = [];
  if (pkg?.engines) runtimes.push({ what: 'node engines', value: JSON.stringify(pkg.engines), source: 'package.json' });
  for (const n of ['.nvmrc', '.node-version', '.python-version', 'runtime.txt', '.ruby-version', '.tool-versions']) {
    const f = ctx.atRoot(n);
    if (f?.text) runtimes.push({ what: n, value: f.text.trim().split(/\r?\n/)[0], source: n });
  }
  const goMod = ctx.atRoot('go.mod');
  if (goMod?.text) {
    const m = goMod.text.match(/^go\s+([\d.]+)/m);
    if (m) runtimes.push({ what: 'go directive', value: m[1], source: 'go.mod' });
  }
  // Often the only place a runtime version is pinned is the pipeline that
  // builds it - and that is the version production actually runs.
  for (const f of ctx.files) {
    if (!f.rel.startsWith('.github/workflows/') || typeof f.text !== 'string') continue;
    for (const [, key, value] of f.text.matchAll(/^\s*(node-version|python-version|go-version|java-version|ruby-version|version):\s*['"]?([\d.x]+)['"]?/gm)) {
      if (!runtimes.some((r) => r.what === key && r.value === value)) {
        runtimes.push({ what: key, value, source: f.rel });
      }
    }
  }

  // Monorepo
  let monorepo = { isMonorepo: false, tool: null, deployables: [] };
  const wsFiles = [
    ['pnpm-workspace.yaml', 'pnpm workspaces'], ['lerna.json', 'Lerna'],
    ['nx.json', 'Nx'], ['turbo.json', 'Turborepo'], ['go.work', 'Go workspaces'],
    ['rush.json', 'Rush'],
  ];
  let tool = wsFiles.find(([n]) => ctx.atRoot(n))?.[1] ?? null;
  if (!tool && pkg?.workspaces) tool = 'npm/yarn workspaces';
  if (tool) {
    const nested = ctx.files.filter((f) => f.name === 'package.json' && f.rel !== 'package.json');
    monorepo = {
      isMonorepo: true,
      tool,
      deployables: nested.map((f) => f.dir).filter((d) => d && !d.includes('node_modules')).slice(0, 50),
    };
  }

  // Project shape. `library` is what collapses the deployment and operations
  // sections: a package nobody runs has a release process, not a runbook.
  const SERVER_DEPS = /^(flask|django|fastapi|uvicorn|gunicorn|rails|sinatra|express|fastify|@nestjs\/core|next|gin-gonic\/gin|labstack\/echo|spring-boot)/;
  const hasStart = Boolean(pkg?.scripts?.start || pkg?.scripts?.dev || ctx.atRoot('Procfile'));
  const hasContainer = ctx.files.some((f) => /^Dockerfile/i.test(f.name));
  const hasServerDep = [...deps.keys()].some((d) => SERVER_DEPS.test(d));
  const hasServerEntry = ctx.files.some((f) => ['manage.py', 'wsgi.py', 'asgi.py', 'config.ru'].includes(f.name));
  const publishes = Boolean(pkg && (pkg.files || pkg.exports || pkg.publishConfig) && !pkg.private)
    || ctx.files.some((f) => f.ext === '.gemspec')
    || Boolean(ctx.atRoot('pyproject.toml')?.text?.includes('build-backend'))
    // A Go module with no `func main` anywhere is imported, not run.
    || Boolean(ctx.atRoot('go.mod') && !code.mainFns.some((m) => m.kind === 'go'));
  let projectShape = 'unknown';
  if (monorepo.isMonorepo) projectShape = 'monorepo';
  else if (hasStart || hasContainer || hasServerDep || hasServerEntry) projectShape = 'service';
  else if (publishes) projectShape = 'library';
  else if (pkg?.bin) projectShape = 'cli';

  return {
    languages, manifests, packageManager, lockfiles, conflicts,
    frameworks, runtimes, monorepo, projectShape,
    dependencyCount: deps.size,
  };
}

export function detectEntryPoints(ctx, code) {
  const out = [];
  const pkg = rootPkg(ctx);
  const push = (path, kind, evidence, confidence = 'high') =>
    out.push({ path, kind, evidence, confidence });

  if (pkg) {
    if (pkg.main) push(pkg.main, 'module main', [{ file: 'package.json', field: 'main' }]);
    if (pkg.bin) {
      const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin;
      for (const [name, p] of Object.entries(bins)) push(p, `cli: ${name}`, [{ file: 'package.json', field: 'bin' }]);
    }
    for (const key of ['start', 'dev', 'serve']) {
      if (pkg.scripts?.[key]) push(pkg.scripts[key], `script: ${key}`, [{ file: 'package.json', field: `scripts.${key}` }]);
    }
  }
  // Framework conventions only count when the framework is actually installed.
  // `app/` means the App Router in a Next project and nothing at all in a
  // Flask one, and guessing wrong puts a fabricated entry point in the doc.
  const deps = allDeps(ctx);
  if (deps.has('next')) {
    for (const [dir, kind] of [['app', 'Next.js App Router'], ['pages', 'Next.js Pages Router'], ['src/app', 'Next.js App Router']]) {
      if (ctx.files.some((f) => f.rel.startsWith(`${dir}/`))) push(`${dir}/`, kind, [{ file: `${dir}/` }], 'medium');
    }
  }
  if (deps.has('@sveltejs/kit') || deps.has('remix') || deps.has('@remix-run/react')) {
    if (ctx.files.some((f) => f.rel.startsWith('src/routes/'))) push('src/routes/', 'file-based routes', [{ file: 'src/routes/' }], 'medium');
  }
  for (const n of ['manage.py', 'wsgi.py', 'asgi.py', 'main.py', 'app.py', 'config.ru', 'Rakefile', 'main.go']) {
    if (ctx.atRoot(n)) push(n, 'conventional entry point', [{ file: n }]);
  }
  // A `__main__` guard in a maintenance script is not an entry point to the
  // system. Left unfiltered, a directory of one-off probes buries the real one.
  const tooling = /^(scripts?|tools?|bin|docs?|examples?|samples?|benchmarks?|tests?)\//;
  const appMains = code.mainFns.filter((m) => !tooling.test(m.file));
  for (const m of appMains.slice(0, 20)) push(m.file, `${m.kind} main`, [{ file: m.file, line: m.line }]);

  const toolMains = code.mainFns.filter((m) => tooling.test(m.file));
  if (toolMains.length) {
    push(`${toolMains[0].file.split('/').slice(0, 2).join('/')}/`,
      `${toolMains.length} runnable scripts (tooling, not application entry points)`,
      toolMains.slice(0, 3).map((m) => ({ file: m.file, line: m.line })), 'medium');
  }

  return out;
}

const TASK_CLASS = [
  [/\btest|vitest|jest|pytest|mocha|rspec|go test|phpunit/i, 'test'],
  [/\blint|eslint|ruff|flake8|rubocop|golangci/i, 'lint'],
  [/typecheck|tsc\b|mypy/i, 'typecheck'],
  [/\bbuild|compile|webpack|vite build|next build/i, 'build'],
  [/\bstart\b|\bdev\b|\bserve\b|runserver/i, 'start'],
  [/deploy|publish|release|ship/i, 'deploy'],
  [/migrat|alembic|prisma migrate|rake db:/i, 'migrate'],
  [/backup|dump|pg_dump|mongodump/i, 'backup'],
  [/smoke|e2e|scenario/i, 'smoke'],
  [/codegen|generate|prisma generate/i, 'codegen'],
];

export function detectTasks(ctx) {
  const out = [];
  const classify = (name, command) => {
    for (const [re, kind] of TASK_CLASS) if (re.test(name) || re.test(command)) return kind;
    return 'unknown';
  };

  const pkg = rootPkg(ctx);
  if (pkg?.scripts) {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      out.push({
        name, command: String(command), source: 'package.json',
        classification: classify(name, String(command)),
        lifecycleHook: /^(pre|post)/.test(name),
      });
    }
  }

  const makefile = ctx.atRoot('Makefile') ?? ctx.atRoot('makefile');
  if (makefile?.text) {
    linesOf(makefile.text).forEach((line, i) => {
      const m = line.match(/^([A-Za-z0-9_.-]+):(?!=)/);
      if (m && m[1] !== '.PHONY') {
        out.push({ name: m[1], command: '(make target)', source: `Makefile:${i + 1}`, classification: classify(m[1], ''), lifecycleHook: false });
      }
    });
  }

  for (const n of ['Taskfile.yml', 'Taskfile.yaml', 'justfile', 'Justfile']) {
    const f = ctx.atRoot(n);
    if (!f?.text) continue;
    linesOf(f.text).forEach((line, i) => {
      const m = n.toLowerCase().startsWith('just')
        ? line.match(/^([a-z][\w-]*)(?:\s+[\w-]+)*:\s*$/i)
        : line.match(/^\s{2}([a-z][\w:-]*):\s*$/i);
      if (m) out.push({ name: m[1], command: `(${n} recipe)`, source: `${n}:${i + 1}`, classification: classify(m[1], ''), lifecycleHook: false });
    });
  }

  const pyproject = ctx.atRoot('pyproject.toml');
  if (pyproject?.text) {
    const section = pyproject.text.match(/\[(?:project|tool\.poetry)\.scripts\]([\s\S]*?)(?:\n\[|$)/);
    if (section) {
      for (const line of linesOf(section[1])) {
        const m = line.match(/^\s*([\w-]+)\s*=\s*["']([^"']+)["']/);
        if (m) out.push({ name: m[1], command: m[2], source: 'pyproject.toml', classification: classify(m[1], m[2]), lifecycleHook: false });
      }
    }
  }

  return out;
}

const shapeOf = (value) => {
  if (!value) return 'empty';
  if (/^https?:\/\//i.test(value) || /:\/\//.test(value)) return 'url';
  if (/^(true|false|1|0|yes|no)$/i.test(value)) return 'flag';
  if (/^\d+$/.test(value)) return 'number';
  return 'string';
};

export function detectEnv(ctx, code) {
  const declared = [];
  const templates = ctx.files.filter((f) => ENV_TEMPLATE_RE.test(f.name));
  const groups = [];

  for (const f of templates) {
    if (typeof f.text !== 'string') continue;
    const allLines = linesOf(f.text);
    let group = null;
    allLines.forEach((line, i) => {
      const comment = line.match(/^\s*#\s*(.{3,80})\s*$/);
      if (comment && !/^\s*#\s*[A-Z_]+=/.test(line)) {
        // A heading, not prose. Well-commented templates carry paragraphs of
        // explanation between variables; treating every comment line as a
        // group name turns the section into a transcript of the file.
        const text = comment[1].replace(/[-=#*]{3,}/g, '').trim();
        const looksLikeHeading = text.length <= 44
          && !/[.!?,;]$/.test(text)
          && !/https?:|=|\bsee\b|\bgenerate\b/i.test(text)
          && text.split(/\s+/).length <= 6;
        // A heading labels a block: a variable must follow it before the next blank run.
        const followedByVar = allLines.slice(i + 1, i + 4)
          .some((l) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l));
        if (looksLikeHeading && followedByVar) group = text;
        return;
      }
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) return;
      const raw = m[2].trim().replace(/^["']|["']$/g, '');
      declared.push({
        name: m[1],
        group,
        shape: shapeOf(raw),
        looksSecret: /secret|token|password|key|credential|_pwd|salt|private/i.test(m[1]),
        source: `${f.rel}:${i + 1}`,
      });
      if (group && !groups.includes(group)) groups.push(group);
    });
  }

  const declaredNames = new Set(declared.map((d) => d.name));
  const referenced = [...code.envRefs.entries()].map(([name, evidence]) => ({
    name, uses: evidence.length, evidence,
  })).sort((a, b) => b.uses - a.uses);
  const referencedNames = new Set(referenced.map((r) => r.name));

  // Vars the running system needs that no template documents. This is the
  // commonest single cause of a handover that fails on day one.
  //
  // `inAppCode` separates the two very different cases behind one symptom: a
  // variable the deployed application reads is a broken deployment waiting to
  // happen, while one read only by a maintenance script is a lesser gap. Left
  // undistinguished, a repo full of one-off scripts buries the first in the second.
  const TOOLING_DIR = /^(scripts?|tools?|bin|docs?|examples?|samples?|benchmarks?|infra|deploy)\//;
  const usedNotDeclared = referenced
    .filter((r) => !declaredNames.has(r.name))
    .filter((r) => !/^(NODE_ENV|CI|PATH|HOME|PORT|PWD|TZ|USER|USERNAME|USERPROFILE|USERDOMAIN|TEMP|TMP|SHELL|LANG|npm_.*|VERCEL_.*|GITHUB_.*|RUNNER_.*)$/.test(r.name))
    .map((r) => ({
      ...r,
      inAppCode: r.evidence.some((e) => !TOOLING_DIR.test(e.file)),
    }));

  const declaredNotUsed = declared.filter((d) => !referencedNames.has(d.name));

  return {
    templates: templates.map((f) => f.rel),
    liveFilesPresent: ctx.files
      .filter((f) => /^\.env($|\.)/.test(f.name) && !ENV_TEMPLATE_RE.test(f.name))
      .map((f) => ({ file: f.rel, note: 'inventoried by name only; never opened' })),
    groups,
    declared,
    referenced: referenced.slice(0, 200),
    usedNotDeclared,
    declaredNotUsed,
  };
}

export function detectServices(ctx, code, env) {
  const out = new Map();
  const add = (name, kind, evidence) => {
    if (!out.has(name)) out.set(name, { name, kind, evidence: [], envVars: [], hosts: [], confidence: 'high' });
    const s = out.get(name);
    for (const e of evidence) if (s.evidence.length < 5) s.evidence.push(e);
  };

  const deps = allDeps(ctx);
  for (const dep of deps.keys()) {
    for (const [re, name, kind] of VENDOR_DEPS) {
      if (re.test(dep)) add(name, kind, [{ dependency: dep }]);
    }
  }

  for (const [host, evidence] of code.hostnames) {
    const known = [...out.values()].find((s) => s.hosts.includes(host));
    if (known) continue;
    const name = host;
    if (!out.has(name)) {
      out.set(name, {
        name, kind: 'unknown', evidence: evidence.slice(0, 3), envVars: [], hosts: [host],
        confidence: 'low',
        note: 'Hostname found in code or config. What it is, and who owns the account, is not knowable from the repo.',
      });
    }
  }

  // Attach env vars whose name mentions a service we already know about.
  for (const s of out.values()) {
    const token = s.name.split(/[ .]/)[0].toUpperCase();
    s.envVars = env.declared.filter((d) => d.name.includes(token)).map((d) => d.name).slice(0, 12);
  }

  return [...out.values()];
}

export function detectDatastores(ctx, code, env) {
  const found = new Map();
  const add = (engine, evidence) => {
    if (!found.has(engine)) found.set(engine, { engine, evidence: [], connectionEnvVars: [], migrationsDir: null, backupTask: null });
    const d = found.get(engine);
    for (const e of evidence) if (d.evidence.length < 6) d.evidence.push(e);
  };

  const deps = allDeps(ctx);
  const driverMap = [
    [/^mongoose$|^mongodb$|^pymongo$/, 'MongoDB'],
    [/^pg$|^postgres$|^psycopg2?$|^asyncpg$/, 'PostgreSQL'],
    [/^mysql2?$|^pymysql$|^mariadb$/, 'MySQL / MariaDB'],
    [/^redis$|^ioredis$/, 'Redis'],
    [/^sqlite3$|^better-sqlite3$/, 'SQLite'],
    [/^@elastic\/elasticsearch$|^elasticsearch$/, 'Elasticsearch'],
  ];
  for (const dep of deps.keys()) {
    for (const [re, engine] of driverMap) if (re.test(dep)) add(engine, [{ dependency: dep }]);
  }

  const schemeMap = [
    [/^mongodb(\+srv)?:/, 'MongoDB'], [/^postgres(ql)?:/, 'PostgreSQL'],
    [/^mysql:/, 'MySQL / MariaDB'], [/^redis:/, 'Redis'],
  ];
  for (const d of env.declared) {
    if (d.shape !== 'url') continue;
    const f = ctx.files.find((x) => d.source.startsWith(`${x.rel}:`));
    const lineNo = Number(d.source.split(':').pop());
    const raw = f?.text ? linesOf(f.text)[lineNo - 1] ?? '' : '';
    const value = (raw.split('=')[1] ?? '').trim().replace(/^["']|["']$/g, '');
    for (const [re, engine] of schemeMap) {
      if (re.test(value)) {
        add(engine, [{ file: d.source, note: `declared via ${d.name}` }]);
        found.get(engine).connectionEnvVars.push(d.name);
      }
    }
  }

  for (const d of found.values()) {
    const mig = ctx.files.find((f) => /(^|\/)(migrations|alembic|db\/migrate)\//.test(f.rel));
    if (mig) d.migrationsDir = mig.rel.split('/').slice(0, -1).join('/');
  }

  const engines = [...found.values()];
  // Two engines from different evidence classes usually means one is a leftover.
  const fromDeps = new Set(engines.filter((e) => e.evidence.some((x) => x.dependency)).map((e) => e.engine));
  const fromEnv = new Set(engines.filter((e) => e.evidence.some((x) => x.note)).map((e) => e.engine));
  const conflict = [...fromEnv].filter((e) => !fromDeps.has(e));
  for (const e of engines) {
    e.conflict = conflict.includes(e.engine);
    if (e.conflict) {
      e.conflictNote = `Configured in an env template but no ${e.engine} driver is installed. Either the template is stale or a dependency is missing.`;
    }
  }
  return engines;
}

export function detectDeploy(ctx) {
  const paths = [];
  const push = (p) => paths.push(p);

  // CI
  for (const f of ctx.files) {
    const isWorkflow = f.rel.startsWith('.github/workflows/') && /\.ya?ml$/.test(f.name);
    const namedCi = CI_FILES.find(([p]) => !p.endsWith('/') && f.rel === p);
    if (!isWorkflow && !namedCi) continue;
    const provider = isWorkflow ? 'GitHub Actions' : namedCi[1];
    const text = typeof f.text === 'string' ? f.text : '';
    const secrets = [...text.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
    const runs = [...text.matchAll(/^\s*(?:-\s*)?run:\s*\|?\s*(.*)$/gm)].map((m) => m[1]).filter(Boolean);
    const trigger = (text.match(/^on:([\s\S]*?)^\w/m)?.[1] ?? text.match(/^on:.*$/m)?.[0] ?? '').trim().slice(0, 240);
    const target = text.match(/app-name:\s*['"]?([\w-]+)/)?.[1]
      ?? text.match(/cluster[-_]?name:\s*['"]?([\w-]+)/)?.[1]
      ?? text.match(/\bservice:\s*['"]?([\w-]+)/)?.[1] ?? null;
    push({
      id: f.rel, kind: 'ci', provider, file: f.rel, target,
      trigger, uses: uses.slice(0, 20), runSteps: runs.slice(0, 40),
      credentials: [...new Set(secrets)],
      tracked: f.tracked, confidence: 'high',
      evidence: [{ file: f.rel }],
    });
  }

  // Containers, orchestrators, PM2, PaaS, IaC
  for (const f of ctx.files) {
    if (/^Dockerfile/i.test(f.name)) {
      push({ id: f.rel, kind: 'container', provider: 'Docker', file: f.rel, tracked: f.tracked, confidence: 'high', evidence: [{ file: f.rel }] });
    }
    if (/^docker-compose.*\.ya?ml$|^compose\.ya?ml$/i.test(f.name)) {
      push({ id: f.rel, kind: 'container', provider: 'Docker Compose', file: f.rel, tracked: f.tracked, confidence: 'high', evidence: [{ file: f.rel }] });
    }
    if (/^ecosystem\.config\.(js|cjs|mjs|json)$/.test(f.name)) {
      const t = typeof f.text === 'string' ? f.text : '';
      push({
        id: f.rel, kind: 'pm2', provider: 'PM2', file: f.rel,
        target: t.match(/name:\s*['"]([^'"]+)/)?.[1] ?? null,
        port: t.match(/PORT:\s*['"]?(\d+)/)?.[1] ?? null,
        script: t.match(/script:\s*['"]([^'"]+)/)?.[1] ?? null,
        tracked: f.tracked, confidence: 'high', evidence: [{ file: f.rel }],
      });
    }
    if (PAAS_FILES[f.name] && f.dir === '') {
      push({ id: f.rel, kind: 'paas', provider: PAAS_FILES[f.name], file: f.rel, tracked: f.tracked, confidence: 'high', evidence: [{ file: f.rel }] });
    }
    if (f.ext === '.tf' || /^Chart\.yaml$/.test(f.name) || /^kustomization\.ya?ml$/.test(f.name)) {
      const provider = f.ext === '.tf' ? 'Terraform' : (f.name.startsWith('Chart') ? 'Helm' : 'Kustomize');
      if (!paths.some((p) => p.provider === provider)) {
        push({ id: f.rel, kind: f.ext === '.tf' ? 'iac' : 'orchestrator', provider, file: f.rel, tracked: f.tracked, confidence: 'high', evidence: [{ file: f.rel }] });
      }
    }
    if (typeof f.text === 'string' && /\.ya?ml$/.test(f.name) && /^kind:\s*(Deployment|CronJob|StatefulSet)/m.test(f.text)) {
      push({ id: f.rel, kind: 'orchestrator', provider: 'Kubernetes', file: f.rel, tracked: f.tracked, confidence: 'high', evidence: [{ file: f.rel }] });
    }
  }

  // Manual runbooks. The detector that catches a deploy procedure living only
  // in prose - and, often, only on one machine.
  for (const f of ctx.files) {
    if (f.ext !== '.md' || typeof f.text !== 'string') continue;
    // A turnover pack quotes deploy commands by definition. Without this it
    // detects itself as a deployment path and reports itself as a risk.
    if (/^turnover-documentations\//.test(f.rel)) continue;
    const named = RUNBOOK_NAME.test(basename(f.name, '.md'));
    const hits = OPS_COMMANDS.filter((c) => f.text.includes(c));
    if (!named && hits.length < 3) continue;
    if (named && hits.length === 0) continue;
    const hosts = [...new Set([...f.text.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g)].map((m) => m[1]))]
      .filter((h) => !/^(0|127|255)\./.test(h));
    push({
      id: f.rel, kind: 'manual-runbook', provider: 'manual procedure', file: f.rel,
      target: hosts[0] ?? null, hosts, commands: hits,
      tracked: f.tracked, gitignored: f.gitignored,
      confidence: named && hits.length >= 3 ? 'high' : 'medium',
      evidence: [{ file: f.rel }],
    });
  }

  // Divergence: do the paths point at different places?
  const targets = [];
  for (const p of paths) {
    if (p.kind === 'container' || p.kind === 'iac') continue;
    const tokens = [p.target, p.port, ...(p.hosts ?? [])].filter(Boolean).map(String);
    if (tokens.length) targets.push({ id: p.id, provider: p.provider, tokens });
  }
  const divergence = [];
  if (targets.length > 1) {
    const distinct = new Set(targets.map((t) => t.tokens.join('|')));
    if (distinct.size > 1) {
      divergence.push({
        severity: 'high',
        entries: targets,
        question: 'Which of these deployment paths is live? The repository does not say, and the scanner will not guess.',
      });
    }
  }

  return { paths, divergence };
}

/**
 * Resolves `$TaskName` back to the literal it was assigned, so the finding
 * names the task an administrator would actually search for rather than the
 * variable that happened to hold it.
 */
function psValue(text, raw) {
  if (!raw) return null;
  if (!raw.startsWith('$')) return raw;
  const name = raw.replace(/^\$/, '').replace(/[^\w]/g, '');
  const m = text.match(new RegExp(`\\$${name}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`, 'i'));
  return m ? (m[1] ?? m[2]) : raw;
}

export function detectSchedules(ctx, code) {
  const out = [];
  const boundEvidence = (text) => {
    const reasons = [];
    const personal = text.match(PERSONAL_PATH_RE);
    if (personal) reasons.push(`absolute personal path ${personal[0]}`);
    if (/-LogonType\s+Interactive/i.test(text)) reasons.push('runs only while a specific user is logged on (-LogonType Interactive)');
    if (/\$env:USERNAME|\$env:USERPROFILE|%USERPROFILE%|%USERNAME%/i.test(text)) reasons.push('resolves paths from the current user profile');
    return reasons;
  };

  // GitHub Actions / GitLab / k8s CronJob / crontab / systemd timers
  for (const f of ctx.files) {
    if (typeof f.text !== 'string') continue;
    const lines = linesOf(f.text);

    if (/\.ya?ml$/.test(f.name)) {
      lines.forEach((line, i) => {
        const cron = line.match(/^\s*-?\s*cron:\s*['"]?([\d*/,\- ]{5,})['"]?/);
        if (cron) {
          out.push({
            id: `${f.rel}:${i + 1}`, kind: f.rel.includes('.github/') ? 'github-actions' : 'yaml-cron',
            spec: cron[1].trim(), command: null, file: f.rel, line: i + 1,
            boundToHost: false, runsAs: 'CI runner', evidence: [ev(f, i + 1)],
          });
        }
        const k8s = line.match(/^\s*schedule:\s*['"]([^'"]+)['"]/);
        if (k8s && /kind:\s*CronJob/m.test(f.text)) {
          out.push({
            id: `${f.rel}:${i + 1}`, kind: 'kubernetes-cronjob', spec: k8s[1],
            command: null, file: f.rel, line: i + 1, boundToHost: false,
            runsAs: 'cluster', evidence: [ev(f, i + 1)],
          });
        }
      });
    }

    if (/^crontab$|\.cron$|^crontab\./.test(f.lower) || f.rel.includes('cron.d/')) {
      lines.forEach((line, i) => {
        const m = line.match(/^\s*([\d*/,\-]+\s+[\d*/,\-]+\s+[\d*/,\-]+\s+[\d*/,\-]+\s+[\d*/,\-]+)\s+(.+)$/);
        if (m) {
          out.push({
            id: `${f.rel}:${i + 1}`, kind: 'crontab', spec: m[1], command: m[2].trim(),
            file: f.rel, line: i + 1, boundToHost: boundEvidence(m[2]).length > 0,
            boundReasons: boundEvidence(m[2]), runsAs: null, evidence: [ev(f, i + 1)],
          });
        }
      });
    }

    if (f.ext === '.timer') {
      const spec = f.text.match(/OnCalendar=(.+)/)?.[1]?.trim() ?? null;
      out.push({
        id: f.rel, kind: 'systemd-timer', spec, command: null, file: f.rel, line: 1,
        boundToHost: true, boundReasons: ['installed on one host; not defined by the repo'],
        runsAs: null, evidence: [{ file: f.rel }],
      });
    }

    // Windows Task Scheduler. Present because a scheduled job registered from a
    // laptop is invisible to every other detector and dies with the laptop.
    if (/\.(ps1|cmd|bat)$/.test(f.lower) && /Register-ScheduledTask|schtasks\s+\/create/i.test(f.text)) {
      const arg = (flag) => {
        const m = f.text.match(new RegExp(`${flag}\\s+(?:"([^"]+)"|'([^']+)'|(\\$?[\\w:\\\\/.\\-]+))`, 'i'));
        return m ? (m[1] ?? m[2] ?? m[3]) : null;
      };
      const taskName = psValue(f.text, arg('-TaskName') ?? arg('/tn'));
      const execute = psValue(f.text, arg('-Execute') ?? arg('/tr'));
      const trigger = f.text.match(/New-ScheduledTaskTrigger\s+(.+)/i)?.[1]?.trim().replace(/\s*`$/, '')
        ?? f.text.match(/\/sc\s+(\w+.*)/i)?.[1]?.trim() ?? null;
      const runsAs = psValue(f.text, arg('-UserId'));
      const reasons = boundEvidence(f.text);
      out.push({
        id: `${f.rel}:${taskName ?? 'task'}`, kind: 'windows-task-scheduler',
        spec: trigger, taskName, command: execute, file: f.rel,
        line: linesOf(f.text).findIndex((l) => /Register-ScheduledTask|schtasks/i.test(l)) + 1,
        boundToHost: reasons.length > 0, boundReasons: reasons, runsAs,
        evidence: [{ file: f.rel }],
      });
    }
  }

  for (const hit of code.scheduleHits) {
    out.push({
      id: `${hit.file}:${hit.line}`, kind: 'in-process', spec: null, library: hit.lib,
      command: hit.snippet, file: hit.file, line: hit.line,
      boundToHost: false, runsAs: 'the application process',
      note: 'Runs only while the application is running; a restart or a second instance changes its behaviour.',
      evidence: [{ file: hit.file, line: hit.line }],
    });
  }

  return out;
}

export function detectSecretSurface(ctx, code) {
  const filesOnDisk = ctx.files
    .filter((f) => f.isSecretFile)
    .map((f) => ({
      path: f.rel,
      bytes: f.size,
      kind: extname(f.name).replace('.', '') || basename(f.name),
      gitignored: f.gitignored,
      tracked: f.tracked,
      note: f.tracked === true
        ? 'TRACKED IN GIT - treat as compromised and rotate, do not simply transfer.'
        : 'Present on this machine and not in the repository: it must be transferred deliberately or it is lost.',
    }));

  const ciSecretNames = new Set();
  for (const f of ctx.files) {
    if (typeof f.text !== 'string') continue;
    if (!/\.ya?ml$/.test(f.name) && !/Jenkinsfile/.test(f.name)) continue;
    for (const m of f.text.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)) ciSecretNames.add(m[1]);
    for (const m of f.text.matchAll(/\$\{\{\s*vars\.([A-Za-z0-9_]+)\s*\}\}/g)) ciSecretNames.add(`vars.${m[1]}`);
  }

  const managerCalls = [...code.secretManagers.entries()].map(([vendor, evidence]) => ({ vendor, evidence }));

  return {
    filesOnDisk,
    ciSecretNames: [...ciSecretNames].map((name) => ({
      name,
      note: 'Defined outside the repository. The incoming owner needs to be granted this, by name.',
    })),
    managerCalls,
    noSecretManager: managerCalls.length === 0,
    leakCheck: code.leaks.slice(0, 50),
  };
}

export function detectGates(ctx, tasks, deploy) {
  const testFiles = ctx.files.filter((f) => /\.(test|spec)\.[jt]sx?$|_test\.go$|^test_.*\.py$|.*_spec\.rb$|Test\.java$/.test(f.name));
  const deps = allDeps(ctx);
  const frameworks = ['vitest', 'jest', 'mocha', 'pytest', 'rspec', 'playwright', 'cypress', '@playwright/test']
    .filter((d) => deps.has(d));

  const lint = ctx.files.some((f) => /^\.eslintrc|^eslint\.config\.|^\.rubocop\.yml$|^ruff\.toml$|^\.flake8$/.test(f.name));
  const typecheck = Boolean(ctx.atRoot('tsconfig.json')) || deps.has('mypy');

  const gatesMissingFromDeploy = [];
  const gateTasks = tasks.filter((t) => ['test', 'lint', 'typecheck'].includes(t.classification)).map((t) => t.name);
  for (const p of deploy.paths) {
    if (p.kind !== 'ci') continue;
    const body = [...(p.runSteps ?? []), ...(p.uses ?? [])].join('\n');
    const runsGate = gateTasks.some((n) => body.includes(n))
      || /\b(test|lint|typecheck|tsc|vitest|jest|pytest|rspec)\b/.test(body);
    if (!runsGate && (testFiles.length > 0 || gateTasks.length > 0)) {
      gatesMissingFromDeploy.push({
        deploy: p.id,
        note: `${p.id} deploys without running any test, lint or typecheck step, while ${testFiles.length} test files and ${gateTasks.length} gate tasks exist in the repository.`,
      });
    }
  }

  return {
    testFiles: testFiles.length,
    frameworks,
    lint,
    typecheck,
    gateTasks,
    gatesMissingFromDeploy,
  };
}

export function detectDocs(ctx, code, checkMarkdownFile) {
  const inventory = ctx.files
    .filter((f) => f.ext === '.md' || f.ext === '.mdx')
    .map((f) => ({ path: f.rel, bytes: f.size, tracked: f.tracked }));

  const missingTargets = [];
  for (const f of ctx.files) {
    if (f.ext !== '.md' && f.ext !== '.mdx') continue;
    const { broken } = checkMarkdownFile(f.abs, ctx.root);
    for (const b of broken.slice(0, 10)) missingTargets.push(b);
  }

  // An import written without an extension is not a missing file. Resolve the
  // way the runtime would before calling anything absent.
  const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.py', '.go', '.rb'];
  const resolvesIn = (base, p) => RESOLVE_EXTS.some((e) => existsSync(join(base, p + e)))
    || RESOLVE_EXTS.slice(1).some((e) => existsSync(join(base, p, `index${e}`)));

  const referencedButAbsent = [];
  for (const [p, evidence] of code.referencedPaths) {
    if (p.startsWith('../')) continue;
    // A relative import resolves against the file that wrote it, not the repo
    // root. Checking only the root turns every sibling import into a false
    // "missing file", which is the fastest way to make this list ignored.
    const bases = [ctx.root, ...evidence.map((e) => join(ctx.root, e.file, '..'))];
    if (!bases.some((b) => resolvesIn(b, p))) referencedButAbsent.push({ path: p, evidence });
  }

  const docConsumers = code.docConsumers.map((d) => ({
    ...d,
    note: 'This source file reads a documentation directory at runtime. A file added there changes application behaviour, not just the repository.',
  }));

  // Conflicting counts across docs: one of them is wrong, and the scanner does
  // not know which. Reporting the conflict is the useful act.
  const claims = new Map();
  for (const f of ctx.files) {
    if ((f.ext !== '.md' && f.ext !== '.mdx') || typeof f.text !== 'string') continue;
    linesOf(f.text).forEach((line, i) => {
      for (const m of line.matchAll(/\b(\d{1,4})\s+(tools|endpoints|routes|models|tests|suites|tables|collections)\b/gi)) {
        // "2 tools" in a sentence is a description, not a stated total. Only
        // counts large enough to be an inventory claim are worth comparing.
        if (Number(m[1]) < 5) continue;
        const noun = m[2].toLowerCase().replace(/s$/, '');
        if (!claims.has(noun)) claims.set(noun, new Map());
        const byValue = claims.get(noun);
        if (!byValue.has(m[1])) byValue.set(m[1], []);
        const list = byValue.get(m[1]);
        if (list.length < 3) list.push(`${f.rel}:${i + 1}`);
      }
    });
  }
  const numericClaims = [...claims.entries()]
    .filter(([, byValue]) => byValue.size > 1)
    .map(([noun, byValue]) => ({
      noun,
      values: [...byValue.entries()].map(([value, where]) => ({ value, where })),
    }));

  return { inventory, missingTargets, referencedButAbsent, docConsumers, numericClaims };
}

export function detectOwnership(ctx) {
  if (!ctx.gitAvailable) {
    return { available: false, reason: 'not a git work tree, or git is not on PATH' };
  }
  const shortlog = git(ctx.root, ['shortlog', '-sne', '--all', '--no-merges']);
  if (shortlog === null) {
    return { available: false, reason: 'git shortlog failed (shallow clone or no commits)' };
  }

  const byEmail = new Map();
  for (const line of linesOf(shortlog)) {
    const m = line.match(/^\s*(\d+)\s+(.+?)\s+<([^>]+)>/);
    if (!m) continue;
    const [, count, name, email] = m;
    if (!byEmail.has(email)) byEmail.set(email, { email, names: [], commits: 0 });
    const c = byEmail.get(email);
    c.commits += Number(count);
    if (!c.names.includes(name)) c.names.push(name);
  }

  const contributors = [...byEmail.values()].sort((a, b) => b.commits - a.commits);
  const total = contributors.reduce((n, c) => n + c.commits, 0);
  let running = 0;
  let busFactor = 0;
  for (const c of contributors) {
    running += c.commits;
    busFactor += 1;
    if (running > total / 2) break;
  }

  const codeownersFile = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']
    .find((p) => existsSync(join(ctx.root, p))) ?? null;

  const lastCommit = git(ctx.root, ['log', '-1', '--format=%cI'])?.trim() ?? null;
  // `-1` applies before `--reverse`, so asking git for the first commit that
  // way returns the last one. Take the whole list and read the end of it.
  const allDates = (git(ctx.root, ['log', '--format=%cI']) ?? '').split(/\r?\n/).filter(Boolean);
  const firstCommit = allDates.length ? allDates[allDates.length - 1] : null;
  const branch = git(ctx.root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() ?? null;

  const branches = (git(ctx.root, ['for-each-ref', '--format=%(refname:short)|%(committerdate:iso8601)', 'refs/heads/']) ?? '')
    .split(/\r?\n/).filter(Boolean)
    .map((l) => { const [name, date] = l.split('|'); return { name, lastCommit: date }; });

  return {
    available: true,
    contributors: contributors.map((c) => ({
      ...c,
      share: total ? Math.round((c.commits / total) * 100) : 0,
    })),
    totalCommits: total,
    busFactor,
    codeowners: codeownersFile,
    lastCommitAt: lastCommit,
    firstCommitAt: firstCommit,
    currentBranch: branch,
    branches: branches.slice(0, 40),
  };
}

/* ------------------------------------------------------------------ */
/* Health and unknowns
/* ------------------------------------------------------------------ */

export function buildHealth(report, code) {
  const findings = [];
  /**
   * `factToken` overrides what verification looks for in the finished document.
   * It matters where the natural token - the evidence file - is not what a
   * document would sensibly name. A reader documents the variable
   * `MONGODB_URI`, not the file that happens to read it.
   */
  const add = (id, category, severity, title, evidence, impactOnHandover, factToken = null) =>
    findings.push({ id, category, severity, title, evidence, impactOnHandover, factToken });

  for (const d of report.deploy.divergence) {
    add('deploy-divergence', 'deploy-ambiguity', 'high',
      'More than one deployment path, pointing at different targets',
      d.entries.map((e) => ({ file: e.id, detail: e.tokens.join(' ') })),
      'Nobody taking this over can tell which path is live. Deploying by the wrong one is either a no-op or an outage.');
  }

  for (const p of report.deploy.paths) {
    if (p.tracked === false) {
      add(`untracked-${p.id}`, 'untracked-operational-file', 'high',
        `Operational file not in version control: ${p.file}`,
        [{ file: p.file }],
        'It exists on one machine. If that machine is lost or reimaged before handover, the procedure is gone.');
    }
  }

  for (const s of report.schedules) {
    if (s.boundToHost) {
      add(`host-bound-${s.id}`, 'host-bound-job', 'high',
        `Scheduled job tied to one machine: ${s.taskName ?? s.id}`,
        [{ file: s.file, line: s.line, detail: (s.boundReasons ?? []).join('; ') }],
        'It stops the day that machine is reimaged, renamed, or handed back - silently, with no alert.');
    }
  }

  for (const f of report.secretSurface.filesOnDisk) {
    if (f.tracked === true) {
      add(`committed-secret-${f.path}`, 'committed-secret', 'critical',
        `Credential file committed to the repository: ${f.path}`,
        [{ file: f.path }],
        'Everyone with repository access already has it. It must be rotated, not transferred.');
    } else {
      add(`credential-handoff-${f.path}`, 'credential-handoff', 'high',
        `Credential present locally but not in the repository: ${f.path}`,
        [{ file: f.path }],
        'It has to be handed over deliberately. Nothing in the repository will remind anyone it exists.');
    }
  }
  if (report.secretSurface.noSecretManager && report.secretSurface.filesOnDisk.length > 0) {
    add('no-secret-manager', 'credential-handoff', 'medium',
      'No secret manager is used anywhere in the codebase',
      [], 'Secrets live in files and in people. There is no single place the new owner can be pointed at.');
  }

  for (const g of report.gates.gatesMissingFromDeploy) {
    add(`ungated-${g.deploy}`, 'ungated-deploy', 'high', g.note, [{ file: g.deploy }],
      'A newcomer who is still learning the codebase can reach production without a failing test stopping them.');
  }

  if (report.ownership.available && report.ownership.busFactor <= 1) {
    add('bus-factor', 'bus-factor', 'high',
      `Bus factor is ${report.ownership.busFactor}: one person authored most of this codebase`,
      (report.ownership.contributors ?? []).slice(0, 2).map((c) => ({ detail: `${c.names[0]} - ${c.share}% of commits` })),
      'There is no second person with working knowledge. Everything undocumented leaves with them.');
  }

  for (const c of report.stack.conflicts) {
    add(`lockfile-${c.ecosystem}`, 'lockfile-conflict', 'medium', c.note,
      c.lockfiles.map((f) => ({ file: f })),
      'A new developer running the wrong package manager gets a different dependency tree than production.');
  }

  for (const d of report.env.declaredNotUsed.filter((x) => x.looksSecret || x.shape === 'url').slice(0, 10)) {
    add(`env-orphan-${d.name}`, 'doc-drift', 'medium',
      `${d.name} is documented in ${d.source.split(':')[0]} but referenced nowhere in code`,
      [{ file: d.source }],
      'The configuration template no longer describes the system. A newcomer will configure something that does nothing.');
  }
  const undocumentedApp = report.env.usedNotDeclared.filter((r) => r.inAppCode);
  for (const r of undocumentedApp.slice(0, 10)) {
    add(`env-undocumented-${r.name}`, 'doc-drift', 'high',
      `${r.name} is read by the application but documented in no environment template`,
      r.evidence.slice(0, 2),
      'A fresh deployment is missing it, and nothing says so until something fails at runtime.',
      r.name);
  }
  const undocumentedTooling = report.env.usedNotDeclared.filter((r) => !r.inAppCode);
  if (undocumentedTooling.length) {
    add('env-undocumented-tooling', 'doc-drift', 'medium',
      `${undocumentedTooling.length} environment variables are read only by scripts and tooling, and documented nowhere`,
      undocumentedTooling.slice(0, 6).flatMap((r) => r.evidence.slice(0, 1)),
      `Those scripts cannot be run by anyone who did not write them. Variables: ${undocumentedTooling.slice(0, 12).map((r) => r.name).join(', ')}.`);
  }

  for (const n of report.docs.numericClaims) {
    add(`claim-${n.noun}`, 'doc-drift', 'low',
      `Documentation disagrees with itself about the number of ${n.noun}s: ${n.values.map((v) => v.value).join(' vs ')}`,
      n.values.flatMap((v) => v.where.map((w) => ({ file: w }))),
      'At least one document is stale. A newcomer cannot tell which.');
  }

  if (report.docs.missingTargets.length) {
    add('dead-doc-links', 'doc-drift', 'low',
      `${report.docs.missingTargets.length} documentation links point at files that do not exist`,
      report.docs.missingTargets.slice(0, 5),
      'The onboarding trail has holes in it.');
  }
  for (const r of report.docs.referencedButAbsent.slice(0, 5)) {
    add(`absent-path-${r.path}`, 'doc-drift', 'medium',
      `Code references ${r.path}, which does not exist`,
      r.evidence, 'Either a feature is silently inert or a directory was never committed.');
  }

  if (!report.deploy.paths.length) {
    add('missing-runbook', 'missing-runbook', 'high',
      'No deployment path of any kind was detected',
      [], 'How this reaches production exists only in someone\'s memory.');
  }

  const todoTotal = [...code.todos.values()].reduce((a, b) => a + b, 0);
  const topTodo = [...code.todos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    findings,
    metrics: {
      todoCount: todoTotal,
      todoHotspots: topTodo.map(([file, count]) => ({ file, count })),
      dependencyCount: report.stack.dependencyCount,
      lockfileConflicts: report.stack.conflicts.length,
      testFiles: report.gates.testFiles,
      docCount: report.docs.inventory.length,
      severityCounts: findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }), {}),
    },
  };
}

/**
 * Questions the repository provably cannot answer, each seeded with options the
 * scan already knows. Closed questions get answered; open ones get skipped.
 */
export function buildUnknowns(report) {
  const out = [];
  /**
   * `subject` is the distinctive string a document must contain for this
   * question to count as addressed. Matching on the question's ordinary words
   * instead lets a template full of the word "credential" look like it answered
   * everything, which is the failure mode this field exists to prevent.
   */
  const add = (id, category, question, why, suggestedOptions = [], subject = null) =>
    out.push({ id, category, question, why, suggestedOptions, subject });

  for (const d of report.deploy.divergence) {
    add('deploy-live', 'deploy', 'Which deployment path is live?',
      'Two or more paths point at different targets and the repository states no preference.',
      [...d.entries.map((e) => `${e.provider} -> ${e.tokens.join(' ')}`), 'Both are live', 'I do not know']);
  }
  for (const f of report.secretSurface.filesOnDisk) {
    add(`cred-${f.path}`, 'credentials', `How will ${f.path} reach the incoming owner?`,
      'It exists on this machine and nowhere in the repository.',
      ['Shared password manager', 'Secret manager / vault', 'Re-issue new credentials instead', 'Already shared', 'I do not know'],
      f.path);
  }
  for (const s of report.schedules.filter((x) => x.boundToHost)) {
    add(`sched-${s.id}`, 'operations', `What should happen to the scheduled job "${s.taskName ?? s.id}" after handover?`,
      'It is tied to one machine and will stop silently when that machine changes hands.',
      ['Move it to a server', 'Move it into CI', 'Re-register on the new owner\'s machine', 'Retire it', 'I do not know'],
      s.taskName ?? s.file);
  }
  for (const d of report.datastores.filter((x) => !x.conflict)) {
    add(`restore-${d.engine}`, 'data', `Has a restore of ${d.engine} from backup ever been tested end to end?`,
      'A backup that has never been restored is a hypothesis, and the handover is when it gets tested.',
      ['Yes - give the date', 'No', 'I do not know'],
      'restore');
  }
  const unknownServices = report.services.filter((s) => s.kind === 'unknown');
  if (unknownServices.length) {
    add('service-owners', 'vendors',
      'Which of these external services do you hold the account for?',
      'Hostnames are visible in the code; account ownership, cost and support contacts are not.',
      unknownServices.map((s) => s.name).slice(0, 12),
      'account owner');
  }
  if (report.ownership.available && report.ownership.busFactor <= 1) {
    add('backup-owner', 'people', 'Who is the incoming owner, and who is their backup?',
      'One person authored effectively all of this. Without a named second person the bus factor does not change at handover.',
      [], 'Incoming owner');
  }
  add('escalation', 'people', 'Who is called when this breaks outside working hours?',
    'Nothing in a repository records an escalation path.', [], 'scalation');
  if (report.services.length) {
    add('billing', 'commercial', 'Who pays for the external services, and when do the contracts renew?',
      'Licences, seats, renewal dates and notice periods are never in the code.', [], 'renew');
  }

  return out;
}

export { readCapped, git, linesOf };
