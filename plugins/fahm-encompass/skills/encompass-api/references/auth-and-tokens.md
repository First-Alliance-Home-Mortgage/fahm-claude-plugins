# Authentication and tokens

`POST {baseUrl}/oauth2/v1/token`. Every Developer Connect call — loan pipeline and SCIM alike —
carries `Authorization: Bearer {access_token}`.

## Why password grant

**ICE restricts `grant_type=client_credentials` to ISV partners.** A lender must authenticate as a
real Encompass user, so the integration runs as a **dedicated service-account seat**.

Design consequences:

- The service account is a real Encompass seat and needs SCIM account-link permissions granted to it
  explicitly.
- `ENCOMPASS_USERNAME` is the **bare** login, not the `user@encompass:instance` form. The token
  client assembles that form. Passing the assembled form is a 401.
- A password rotation on that account takes the integration down until the env var is updated. Treat
  it as a certificate expiry, not routine maintenance.
- **FAHM cannot be an ICE SSO domain.** Account linking is a SCIM operation a service account
  performs on an admin's behalf. Designing toward "users sign in with Encompass" is a dead end.

## The two grant shapes do not pass credentials the same way

| `ENCOMPASS_GRANT_TYPE` | Client credentials go | Identity |
|---|---|---|
| `password` (default, and the only one available to FAHM) | in the **form body** as `client_id` / `client_secret` | `username` = `<user>@encompass:<instanceId>` |
| `client_credentials` (ISV partners only) | in a **Basic auth header** | `instance_id` in the form body |

Both request `scope=lp`. The shapes match the Developer Connect Postman collection — check there
before changing one.

## Scope

`lp` is the **only** scope this client can mint. Verified against production:
`encompass_admin` (recommended by third-party docs), `scim`, `scim2`, `admin` and `user_management`
are all rejected by the token endpoint with `invalid_scope`.

The SCIM surface accepts the same `lp` token, which resolves an assumption that blocked account
linking for a while: **no separate SCIM credential, client or scope is needed.**

## Token lifetime — two implementations disagree

This is unresolved and documented as such. Both were recorded as verified against production.

| Repo | Behaviour |
|---|---|
| `com.echat.ai` | Reads `expires_in` from the token response, defaulting to 1800 s when absent. Reuses the token until five minutes before expiry |
| `com.web.fahm` | States ICE returns **only** `access_token` and `token_type` — no `expires_in` at all. Caches conservatively for 15 minutes and relies on a 401-evict-and-retry in `scimFetch()` as the real correctness guarantee |

Both caches are per-process, so every instance authenticates separately, and both clear on any auth
failure so the next call retries cleanly rather than replaying a dead token. `com.web.fahm` also
memoises the in-flight promise, so a burst of concurrent operations mints one token rather than N.

**Do not resolve this by picking one.** Probing `/oauth2/v1/token` once and reading the response keys
settles it; until someone does, a wrong cache lifetime shows up as intermittent 401s that recover —
which is the documented-normal symptom either way, and therefore hides the answer.

The `com.web.fahm` posture is the safer of the two regardless: a retry-on-401 guarantee is correct
whatever the true lifetime, while a trusted `expires_in` is correct only if the field is present.

## Introspection

`POST /oauth2/v1/token/introspection` exists and returns the token's claims including `exp`. It is
the direct way to settle the question above, but calling it on every refresh to read `exp` costs a
round trip per token — which is why neither implementation does.

## Transport

Use explicit keep-alive HTTP/HTTPS agents. A report can make dozens of sequential pagination calls,
and Node before v19 does not keep-alive the global agent — relying on the default silently
re-handshakes every page on older runtimes.

## Logging

Log failures as `<METHOD> <path> → <status>` with the body truncated and sanitised. Borrower data
must not reach the log stream. Never log the token, the assembled username, or the client secret.
