# Troubleshooting

Symptom → cause. Merged from `com.echat.ai` and `com.web.fahm`.

## Configuration and auth

| Symptom | Cause |
|---|---|
| An Encompass route 404s and no admin affordance renders | A credential var is unset, or `ENCOMPASS_ENABLED=false`. This is "not configured", not "broken" — `ENCOMPASS_*` is deliberately outside `REQUIRED_ENV` so unconfigured deploys still boot |
| `401` on the token call | The service-account password was rotated, **or** `ENCOMPASS_USERNAME` was given in `user@encompass:instance` form instead of bare. The client assembles that form itself |
| `invalid_grant` mentioning client credentials | Someone switched the grant type. ICE will not issue client-credentials tokens to a lender — only ISV partners |
| `invalid_scope` | Something other than `lp` was requested. `lp` is the only scope this client can mint, including for SCIM |
| Intermittent `401`s that recover on retry | **Normal.** The cached token outlived ICE's real expiry; the 401-evict-and-retry path did its job. If these are frequent, the cache lifetime is too long — see the unresolved `expires_in` question in auth-and-tokens.md |
| Every page of a long report re-handshakes TLS | No explicit keep-alive agent, on a Node runtime older than v19 |

## SCIM

| Symptom | Cause |
|---|---|
| `400 Invalid schema` | Wrong URN for that endpoint. `GET /users?schema=` wants the URN **without** `link:`; accountLinks bodies want the one **with** it. Check this before anything else |
| `400 "The schema is required and should not be null or empty"` | `GET /scim2/v1/users` was called without `?schema=`. The param is singular and lowercase |
| `500 SCIM-1000` from `GET /accountLinks/{guid}` | Probably an unknown GUID, not an outage. ICE returns 500 here instead of 404 |
| `409` on `POST /accountLinks` | The user already has a GUID. Read it with Get Linked Accounts and reconcile — do not retry the POST |
| `409` on `PATCH /accountLinks/{guid}` | Already linked, or multiple IDs exist for that person. Resolve duplicates with DELETE + re-PATCH onto a canonical GUID |
| `GET /scim2/v1/users` returns `totalResults: 0` for a real person | Expected on the FAHM instance. Users were created directly in Encompass, never SCIM-provisioned, so nobody holds a GUID yet |
| `403` on a SCIM call with a valid token | The token is fine but the identity is not authorized for account-link operations. The service account needs SCIM permissions granted explicitly |

## Pipeline queries

| Symptom | Cause |
|---|---|
| `400` filtering a status | `Fields.1997` is a **date** (funds sent), not a status. Status text lives in `Fields.1393` |
| `500` on a date-range query | A **bounded `Fields.2025` range**. AND it with `Loan.LoanFolder exact` or `Fields.ORGID exact` and union across folders |
| `400` on a lone date term | A lone `Fields.2025` term. Same fix |
| `500` on a folder-scoped query that worked at a smaller page size | `limit > 300` on folder-scoped shapes |
| Intermittent `400` deep into pagination | Past roughly page 7. Segment by calendar year, retry with backoff, and treat a `start=0` failure as fatal but a later-page failure as a partial cohort |
| A count looks plausible but low | Check the pagination warnings. Non-empty means the cohort may be incomplete — a hard cap, a cut-short segment, or an unreadable folder |
| Zero rows from a channel filter | `Fields.2626` values are compound (`"Banked - Retail"`). Match `contains`, never `exact` |
| Zero rows from a borrower-contact search | Casing. Contacts want `operator: "Or"` / `matchType: "Contains"`; the pipeline wants `"and"` / `"contains"` |
| A filter param had no effect and no error | `status` and `withdrawnOnly` are accepted and silently ignored |
| Every rate reads 100% | The numerator was filtered server-side. The cohort must come back unfiltered and be marked client-side |
| HTTP 429 from the LLM on a report | Raw loan objects were shipped to the model. Aggregate first — the aggregate *is* the answer |
| A key is missing from a single-loan response | `GET /loans/{id}` omits empty fields server-side. Absent means empty, not missing |
| A date parses wrong or not at all | Encompass dates are `M/D/YYYY`, sometimes with a time. Never `Date.parse` raw |
| A loan GUID is null | The pipeline returns it as `loanId`, not `loanGuid`. Read both |
| Every milestone shows today's date | The transform fell back to "now" because the response carried neither `completedDate` nor `updatedAt`. Check the raw response |
| A fallout report buckets everything as "Unknown" | It was scoped by `Fields.749` but bucketed by `Fields.1997`, which is empty on every loan that never funded. A cohort scoped by `Fields.749` must be bucketed by `Fields.749` |

## Scoping

| Symptom | Cause |
|---|---|
| Empty borrower list for a valid LO | They are not the assigned officer on any pipeline row, or the folder filter excludes them |
| Directory lookup returns the same user for everyone | Server-side filters on `GET /encompass/v1/company/users` are silently ignored. Match client-side |
| A user resolves to no tier | No Encompass account matches their email, or the email is shared by several active accounts. Ambiguity is refused on purpose — picking by iteration order is a privilege-escalation path |
| A branch filter matches nothing | `organization.entityId` was used instead of `orgInformation.orgCode`. Different numbering systems |
| Setting `PROMPT_PERMISSION_MODE=enforce` changed nothing | By design. It is conjoined with `ENCOMPASS_SCOPING_MODE` in code — refusing a named report while rows are unfiltered is theatre |
| One user's results served to another | The access scope is missing from the tool-cache key. The **mode** must be in the key too |
| A new tool returns company-wide data | It builds its own filter and bypassed the access-filter chokepoint |
| A refusal contains numbers | The model answered from baseline figures in the system prompt. The refusal payload must contain no digits |

## Diagnosing with the probe

```bash
node "${CLAUDE_SKILL_DIR}/scripts/encompass-probe.mjs" --endpoint /encompass/v1/company/users/me
```

Prints the HTTP status and the response *shape* — key names, array lengths, types — never values and
never the token. A `200` means the credentials are fine and the problem is in the query; a `401` or
`invalid_grant` means it is not.

Field lookups need no credentials at all:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/resolve-field.mjs" Fields.1997
```
