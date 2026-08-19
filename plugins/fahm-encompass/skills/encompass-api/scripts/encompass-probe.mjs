#!/usr/bin/env node
/**
 * encompass-probe.mjs — read-only Encompass diagnostic.
 *
 * Mints a token from the ambient ENCOMPASS_* environment, issues ONE GET, and
 * prints the HTTP status plus the SHAPE of the response — key names, array
 * lengths, value types. It never prints a token, a credential, or a field value.
 *
 * Exists so "is this a credential problem or a query problem?" can be answered
 * without anyone assembling an ad-hoc request containing a secret.
 *
 *   node encompass-probe.mjs --endpoint /encompass/v1/company/users/me
 *   node encompass-probe.mjs --endpoint /encompass/v3/loanFolders --depth 3
 *   node encompass-probe.mjs --token-only
 *
 * Refuses any method other than GET, by construction. To probe a POST endpoint
 * such as /loanPipeline, write the request in the owning repo where it can be
 * reviewed — not here.
 */

const REQUIRED = [
  'ENCOMPASS_API_URL',
  'ENCOMPASS_CLIENT_ID',
  'ENCOMPASS_CLIENT_SECRET',
  'ENCOMPASS_INSTANCE_ID',
  'ENCOMPASS_USERNAME',
  'ENCOMPASS_PASSWORD',
];

function usage(code = 1) {
  console.error(`
usage: encompass-probe.mjs --endpoint <path> [--depth N] [--json]
       encompass-probe.mjs --token-only

  --endpoint   path beginning with "/" (GET only)
  --depth      how deep to describe the response shape (default 2)
  --token-only mint a token and report success/failure, nothing else
  --json       emit the shape description as JSON

Reads credentials from the environment. Set them in the shell, or run with
Node's --env-file. Never pass a secret as an argument.
`.trim());
  process.exit(code);
}

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : (argv[i + 1] ?? '');
}
const tokenOnly = argv.includes('--token-only');
const asJson = argv.includes('--json');
const depth = Number(flag('--depth') ?? 2) || 2;
const endpoint = flag('--endpoint');

if (!tokenOnly) {
  if (!endpoint) usage();
  if (!endpoint.startsWith('/')) {
    // Git Bash / MSYS rewrites a leading-slash argument into a Windows path, so
    // "--endpoint /encompass/v1/..." arrives as "C:/Program Files/Git/encompass/...".
    if (/^[A-Za-z]:[\\/]/.test(endpoint)) {
      console.error(`Endpoint arrived as "${endpoint}" — Git Bash rewrote the leading slash.`);
      console.error('Run this from PowerShell, or prefix with MSYS2_ARG_CONV_EXCL="*".');
    } else {
      console.error(`Endpoint must begin with "/", got "${endpoint}".`);
    }
    process.exit(1);
  }
  // The tool is GET-only. Reject anything that looks like an attempt to smuggle
  // a method or a second request in.
  if (/\s/.test(endpoint)) {
    console.error('Endpoint must be a single path with no whitespace.');
    process.exit(1);
  }
}

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment: ${missing.join(', ')}`);
  console.error('This is a configuration problem, not an API problem.');
  process.exit(3);
}

const baseUrl = process.env.ENCOMPASS_API_URL.replace(/\/+$/, '');

/** Mint a token. Password grant: client credentials go in the FORM BODY. */
async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: `${process.env.ENCOMPASS_USERNAME}@encompass:${process.env.ENCOMPASS_INSTANCE_ID}`,
    password: process.env.ENCOMPASS_PASSWORD,
    client_id: process.env.ENCOMPASS_CLIENT_ID,
    client_secret: process.env.ENCOMPASS_CLIENT_SECRET,
    scope: 'lp',
  });

  const res = await fetch(`${baseUrl}/oauth2/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (!res.ok) {
    // Error bodies from the token endpoint carry no secrets, but truncate anyway.
    const detail = parsed?.error ?? text.slice(0, 200);
    throw new Error(`token → HTTP ${res.status} (${detail})`);
  }
  if (!parsed?.access_token) throw new Error(`token → HTTP ${res.status} but no access_token in body`);

  // Report which lifetime keys came back — this is the open question in
  // references/auth-and-tokens.md, and the answer is one probe away.
  return { token: parsed.access_token, keys: Object.keys(parsed).sort() };
}

/** Describe a value's structure without revealing any of its content. */
function shape(value, remaining) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (remaining <= 0) return `array[${value.length}]`;
    if (value.length === 0) return 'array[0]';
    return { [`array[${value.length}] of`]: shape(value[0], remaining - 1) };
  }
  if (typeof value === 'object') {
    if (remaining <= 0) return `object{${Object.keys(value).length} keys}`;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = shape(v, remaining - 1);
    return out;
  }
  if (typeof value === 'string') {
    // Classify the format, never echo the value.
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) return 'string<M/D/YYYY date>';
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'string<ISO date>';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return 'string<guid>';
    if (/^-?\d+(\.\d+)?$/.test(value)) return 'string<numeric>';
    return `string<len ${value.length}>`;
  }
  return typeof value;
}

async function main() {
  let auth;
  try {
    auth = await getToken();
  } catch (err) {
    console.error(`FAIL  ${err.message}`);
    console.error('\nThis is a CREDENTIAL problem. See references/troubleshooting.md → Configuration and auth.');
    process.exit(4);
  }

  console.log(`OK    token minted (scope=lp)`);
  console.log(`      token response keys: ${auth.keys.join(', ')}`);
  if (!auth.keys.includes('expires_in')) {
    console.log('      note: no expires_in — matches the com.web.fahm observation, not com.echat.ai');
  }

  if (tokenOnly) return;

  const url = `${baseUrl}${endpoint}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
  });

  console.log(`\n${res.ok ? 'OK   ' : 'FAIL '} GET ${endpoint} → HTTP ${res.status}`);

  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    console.log(`      non-JSON body, ${text.length} bytes`);
    process.exit(res.ok ? 0 : 5);
  }

  const described = shape(parsed, depth);
  console.log('\nResponse shape (no values):\n');
  console.log(JSON.stringify(described, null, 2));

  if (!res.ok) {
    console.log('\nCredentials are fine — this is a QUERY problem.');
    console.log('See references/troubleshooting.md → Pipeline queries / SCIM.');
    process.exit(5);
  }
}

main().catch((err) => {
  console.error(`unexpected: ${err.message}`);
  process.exit(1);
});
