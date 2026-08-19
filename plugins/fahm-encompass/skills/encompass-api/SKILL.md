---
name: encompass-api
description: Work with the ICE Mortgage Technology Encompass Developer Connect API as First Alliance Home Mortgage integrates it — OAuth password-grant tokens and the `lp` scope, canonical `Fields.*` IDs and the ones whose names lie, loan pipeline filter grammar and the queries that return 400 or 500, SCIM account linking and `globalUserId`, and per-user row scoping by persona. Use for any question about Encompass, Ellie Mae, ICE MT, `api.elliemae.com`, a loan field ID, a pipeline or borrower query, an Encompass token or credential, account linking, or why an Encompass call returns the wrong rows.
license: LicenseRef-FAHM-Proprietary
metadata:
  owner: First Alliance Home Mortgage
  source: fahm-claude-plugins/plugins/fahm-encompass
  last-reviewed: 2026-08-19
---

# Encompass API

Carries what FAHM learned the expensive way about ICE Mortgage Technology's Encompass Developer
Connect API: the field IDs that do not mean what they are named, the query shapes that return 500,
and the three unrelated things everyone calls "SSO".

This skill is a reference, not an implementation. Where it disagrees with the source in an owning
repository, **the source wins** — report the disagreement rather than quietly resolving it.

## Scope check first — three things named "SSO"

Establish which one is meant before answering. They share no code and no credential.

| Name | What it does | Where it lives |
|---|---|---|
| **Entra / SAML SSO** | Signs a human *into* a FAHM app | `@node-saml/node-saml`, `SAML_*` / `ENTRA_*` env |
| **ICE Cross-Domain SSO** (Account Linking) | Ties one person's accounts across ICE products to a shared `globalUserId`. **Not a login.** | `/scim2/v1/accountLinks` |
| **The service-account token** | How every FAHM app actually reads Encompass | `/oauth2/v1/token`, `grant_type=password` |

Two consequences worth stating up front, because designs get built against the opposite assumption:

- **FAHM cannot be an ICE SSO domain.** Account linking is a SCIM operation a service account performs
  on an admin's behalf. "Users sign in with Encompass" is not available.
- **Account linking is not needed to identify a user.** Per-user scoping resolves identity by matching
  email against the company directory, and deliberately does not depend on a GUID.

## Environments

Production `https://api.elliemae.com` · UAT `https://concept.api.elliemae.com` · SCIM service root
`/scim2/v1` · kill switch `ENCOMPASS_ENABLED=false`.

There is **no known non-production environment for SCIM writes**. Treat the first `POST /accountLinks`
as a production write against a live person.

## Authentication

ICE restricts `grant_type=client_credentials` to ISV partners. FAHM is a lender, so the integration
authenticates as a **dedicated service-account Encompass seat** via the password grant. Consequences:

- `ENCOMPASS_USERNAME` is the **bare** login. The client assembles `<user>@encompass:<instanceId>` —
  passing the assembled form in the env var is a 401.
- `scope=lp` is the only scope this client can mint. `encompass_admin`, `scim`, `scim2`, `admin` and
  `user_management` are all rejected with `invalid_scope`. The SCIM surface accepts the same `lp`
  token, so **no separate SCIM credential is needed**.
- A password rotation on that account takes the integration down until the env var is updated. Treat
  it as a certificate expiry, not a routine change.

Full grant shapes, credential placement and the unresolved token-lifetime question:
[references/auth-and-tokens.md](references/auth-and-tokens.md).

### Environment-variable contract

`ENCOMPASS_API_URL` · `ENCOMPASS_CLIENT_ID` · `ENCOMPASS_CLIENT_SECRET` · `ENCOMPASS_INSTANCE_ID` ·
`ENCOMPASS_USERNAME` · `ENCOMPASS_PASSWORD`, plus optional `ENCOMPASS_GRANT_TYPE`,
`ENCOMPASS_ENABLED`, `ENCOMPASS_SCOPING_MODE`, `ENCOMPASS_WEBHOOK_SECRET`.

`ENCOMPASS_*` is deliberately excluded from the server's `REQUIRED_ENV` so a deploy that never
configures Encompass still boots. While unconfigured, the link routes 404 and no admin affordance
renders — a 404 there means "not configured", not "broken".

## Never guess a field ID

This is the single most valuable rule in the skill. Resolve every `Fields.*` against
[references/field-ids.md](references/field-ids.md) before writing a filter, or run
`node "${CLAUDE_SKILL_DIR}/scripts/resolve-field.mjs" <field-or-name>` — it is offline and needs no
credentials.

Carry these inline, because each contradicts what the field name suggests and each was verified live:

| Field | What it actually is |
|---|---|
| `Fields.1997` | **Funds Sent Date — a date**, not a loan status. Filtering it with `"Closed"` returns 400 |
| `Fields.364` | the **loan number**, not the branch. `Fields.ORGID` is the canonical branch |
| `Fields.3422` | investor purchase price as **% of par** (par = 100), not dollars |
| `Fields.2306` | Account Executive — **empty on this instance**. Use `Fields.TPO.X30` |
| `Fields.2` vs `Fields.1109` | total loan amount **includes** financed fees; base loan amount does not |
| `Fields.2012` | underwriter-name **fallback only**. At least one loan stores a date string in it, so it must never override `Fields.984` |

The property named `loanStatus` holds `Fields.1997` — a *date*. The one holding actual status text is
`loanStatusAlt` (`Fields.1393`). Code that reads `loanStatus` to derive a closing month is correct
despite looking like a mistake.

## Constructing a pipeline query

Match types are not interchangeable, and the wrong one fails silently by returning zero rows rather
than erroring:

- `Fields.2626` (channel) — **contains, never exact**. Live values are compound (`"Banked - Retail"`),
  so `exact` on `"Retail"` matches nothing.
- `Fields.1393` (status) — contains, so the filter survives label drift.
- `Fields.ORGID` (branch) — exact when a display name resolves to an org code, contains as fallback
  rather than dropping an unrecognised string.
- `Fields.3` / `Fields.3422` — `greaterThan` works; both probed live.

**Two params are accepted and then silently ignored:** `status` and `withdrawnOnly` add no term. A
caller passing `status` gets an unfiltered cohort and no error.

Filter grammar, the cohort fetchers, pagination and aggregation:
[references/pipeline-queries.md](references/pipeline-queries.md).

## Known API defects

Each of these is a property of the vendor API, not of FAHM code. Design around them; do not try to
fix them.

| Behaviour | Consequence |
|---|---|
| A **bounded `Fields.2025` range returns 500**; a lone term returns 400 | The axis is only queryable ANDed with `Loan.LoanFolder exact` or `Fields.ORGID exact`, unioned across folders |
| `limit > 300` returns 500 on folder-scoped shapes | Page size is pinned to 300 there, 500 elsewhere |
| Deep pagination 400s intermittently past roughly page 7 | Segment by calendar year and retry with backoff |
| `GET /loans/{id}` omits empty fields server-side | An absent key means empty, not missing |
| The pipeline returns the GUID as `loanId`, not `loanGuid` | Read both, in that order |
| Dates arrive `M/D/YYYY`, sometimes with a time — never ISO | Never `Date.parse` them raw |
| `?email=`, `?filter=`, `?userName=` on `GET /encompass/v1/company/users` are **silently ignored**, returning `200` with the full list | Directory matching must stay client-side. Trusting the filter returns the first user for every lookup |
| The borrower-contacts selector wants `operator: "Or"` / `matchType: "Contains"`; the loan pipeline wants `"and"` / `"contains"` | Copying a filter across without adjusting case is a silent zero-row result |

Distinguish the two pagination failure kinds. A failure at `start=0` is a real error and must throw.
A failure on a later page means a **partial cohort** — surface it as a warning; never swallow it. A
truncated count presented as a real one is worse than an error.

## Choosing an endpoint

The Developer Connect surface is roughly 600 requests across 13 top-level groups. Route through
[references/api-surface.md](references/api-surface.md) rather than guessing a path — most resources
exist at both `/encompass/v1/` and `/encompass/v3/` with different shapes.

## Per-user scoping

`ENCOMPASS_SCOPING_MODE=report|enforce` decides **which loans**; `PROMPT_PERMISSION_MODE` decides
**which questions**. They are orthogonal, and confusing them is the main way this gets implemented
wrong.

Tiers are derived from Encompass **personas**, not from `subordinateLoanAccess` — that field encodes
edit rights, not job function, and some plain Loan Officers carry `ReadWrite`.

Encompass's own `loanOfficerVisibility=personal` **cannot be used**: it scopes to the *token's* user,
which is the shared service account, not the person asking.

Branch codes need translating. A user's `organization.entityId` is an org primary key; loans carry
`Fields.ORGID` = `orgInformation.orgCode`. Different numbering systems.

Tier table, enforcement chokepoints, cache-key requirements and the ordered flag rollout:
[references/scoping-and-permissions.md](references/scoping-and-permissions.md).

## SCIM account linking

Four operations under `/scim2/v1/accountLinks`. Three corrections to ICE's published documentation,
all verified against production:

1. **Two URNs, and they are endpoint-specific.** `GET /scim2/v1/users?schema=` wants the URN
   *without* the `link:` segment; the accountLinks request bodies want the one *with* it. Picking the
   wrong one returns `400 Invalid schema`, and it is the first thing to check on any SCIM 400.
2. **`GET /scim2/v1/users` requires a `schema` query param** — singular and lowercase. Omitting it
   returns `400 "The schema is required and should not be null or empty"`.
3. **`GET /accountLinks/{guid}` returns `500 SCIM-1000`, not `404`, for an unknown GUID.** A 500 here
   may just mean "no such GUID" — do not read it as an outage.

Treat `409` as "already exists": read the current state and reconcile, never blind-retry. Fetch GUIDs
at runtime; never persist one as a source of truth.

Full reference, both flows, and the open items ICE has not settled:
[references/identity-scim.md](references/identity-scim.md).

## Webhooks

Developer Connect exposes a webhook surface — subscriptions, events, resources, and a premium custom
auth surface. **No FAHM system consumes Encompass webhooks today.** Say that plainly rather than
describing a handler that does not exist. `ENCOMPASS_WEBHOOK_SECRET` exists in the env contract but
has no consumer.

## Safety

- **No write against production without an explicit instruction naming the write.** Every read path
  here is safe; `POST /accountLinks` mints a permanent, immutable GUID on a live user with no sandbox
  and no un-mint.
- Sanitise any Encompass response body before logging it. Truncate, and keep borrower data out of
  the log stream.
- Never put a credential, a real loan GUID, a borrower name, or a live row count into a file, a
  commit, or a message that leaves the repo. Use the placeholders in the contributing guide.
- `scripts/encompass-probe.mjs` exists so a "credential problem or query problem?" question can be
  answered without constructing an ad-hoc request containing a secret. It is GET-only and prints
  response *shape*, never values.

## Where the truth lives

| Repo | Owns |
|---|---|
| `com.echat.ai` | The pipeline data layer, report registry, per-user scoping, the SCIM requirements write-up |
| `com.web.fahm` | The account-linking service, token client, SCIM config, the integration knowledge base |
| `com.server.fahm` | The REST API surface |
| `com.mob.fahm` | The mobile client that consumes the normalised pipeline read |

Symptom-to-cause table: [references/troubleshooting.md](references/troubleshooting.md).
