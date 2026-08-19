# fahm-encompass

One skill, `encompass-api`, invoked as `/fahm-encompass:encompass-api`.

Carries what FAHM learned the expensive way about ICE Mortgage Technology's **Encompass Developer
Connect** API: the field IDs that do not mean what they are named, the query shapes that return 500,
the SCIM schema URNs ICE documents wrong, and the three unrelated things everyone calls "SSO".

## What it covers

| Reference | Subject |
|---|---|
| `references/auth-and-tokens.md` | Password grant, the `lp` scope, the unresolved token-lifetime question |
| `references/field-ids.md` | The canonical field map and the corrections table. Parsed by `scripts/resolve-field.mjs` |
| `references/pipeline-queries.md` | Filter grammar, match types, cohort fetchers, pagination, aggregation, borrower contacts |
| `references/api-surface.md` | Routing table over ~600 endpoints in 13 groups |
| `references/scoping-and-permissions.md` | Persona tiers, enforcement chokepoints, the flag rollout order |
| `references/identity-scim.md` | Account linking, both flows, and ICE's open items |
| `references/troubleshooting.md` | Symptom → cause |

## Scripts

```bash
node scripts/resolve-field.mjs Fields.1997      # offline; no credentials, no network
node scripts/encompass-probe.mjs --token-only   # reads ENCOMPASS_* from the environment
```

`encompass-probe.mjs` is **GET-only by construction** and prints response *shape* — key names, array
lengths, value types — never values, never the token. It exists so "credential problem or query
problem?" is answerable without anyone assembling an ad-hoc request containing a secret.

## What this is not

A client library, and not an implementation. It is a reference that four repositories share:
`com.echat.ai` (pipeline data layer, scoping), `com.web.fahm` (account linking, token client),
`com.server.fahm` (REST surface), `com.mob.fahm` (mobile consumer).

**Where this skill and a repo's source disagree, the source wins** — and the disagreement gets
reported, not quietly resolved.

## Contents policy

Method and metadata only: endpoint paths, parameter names, field identifiers, error codes, and the
reasoning behind design decisions. No credentials, no borrower data, no real loans, no live business
figures. See the repository CONTRIBUTING.md.

## Version

Starts at `0.1.0` deliberately. Several facts here carry open items ICE has not settled, and the
`api-surface.md` derivation is pinned to one Postman collection version — this reference is expected
to change more often than a documentation tool does.
