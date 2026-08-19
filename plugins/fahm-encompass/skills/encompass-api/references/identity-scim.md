# SCIM account linking (ICE Cross-Domain SSO)

All paths relative to `https://api.elliemae.com/scim2/v1`. Auth is the ordinary `lp` Bearer token —
see [auth-and-tokens.md](auth-and-tokens.md).

## What this is, and what it is not

"ICE MT Cross-Domain SSO" is **Account Linking**, not federated login. It lets a human already signed
into one ICE MT product move to another without re-authenticating, by tying their profiles to a
backend **`globalUserId` (GUID)**.

| | Federated SAML SSO | Account Linking (this file) |
|---|---|---|
| Purpose | An IdP asserts identity to a service provider | Links accounts across ICE products via a backend GUID |
| Trigger | User authenticates at the IdP | User is already authenticated into *an* ICE MT domain |
| FAHM's use | Entra → app login | Encompass ↔ other ICE products for the same person |

**Adopt it only** to let users hop between ICE products, or to hold one canonical GUID per employee.
If the requirement is just "users log into our app", the Entra SAML integration already covers it and
this is out of scope.

**It is also not needed to identify a user.** Per-user scoping resolves identity by matching email
against the company directory and deliberately does not depend on a GUID.

## Verified corrections to ICE's published documentation

Three published details are wrong. All verified against production.

### 1. No special scope exists — use `lp`

The SCIM surface accepts the same `lp` token the apps already mint. `encompass_admin` (recommended by
third-party docs), `scim`, `scim2`, `admin` and `user_management` are **all rejected by the token
endpoint** with `invalid_scope`. No new credential, client or scope is needed.

### 2. Two schema URNs, and they are endpoint-specific

This is the single most common cause of a SCIM `400`. Check it before checking anything else.

| Constant | URN | Used by |
|---|---|---|
| link schema | `urn:ietf:params:scim:schemas:extension:link:ice:2.0:EncompassInternalUser` | accountLinks request bodies (Create / Link / Delete) |
| user schema | `urn:ietf:params:scim:schemas:extension:ice:2.0:EncompassInternalUser` | `GET /scim2/v1/users?schema=` |

Note the difference is one segment: `link:`.

The Get Users reference page also lists
`urn:ietf:params:scim:schemas:extension:enterprise:2.0:EncompassInternalUser` as allowed. **That is
stale** and returns `400 Invalid schema` against production.

> **A conflict in FAHM's own records.** An earlier probe (2026-07-22) concluded the `link:` URN was
> rejected outright and that only the `link:`-less form worked. A later verification (2026-08-04)
> found the distinction is per-endpoint, as tabled above. The later, more specific finding is
> recorded here because it explains both observations — the earlier probe was exercising
> `GET /users`, where the `link:`-less URN is indeed the correct one. Treat this as documented but
> not independently re-confirmed, and re-probe before relying on the `link:` form in a write.

Whether other ICE products follow the same pattern is untested.

### 3. `GET /users` requires a `schema` query param

Omitting it returns `400 "The schema is required and should not be null or empty"`. The param is
**singular and lowercase** (`?schema=`); `schemas` and `userSchema` are not recognised.

### Also noted

`GET /accountLinks/{guid}` returns **`500 SCIM-1000`**, not `404`, for an unknown GUID — regardless
of schema. Do not read a 500 here as an outage; it may just mean "no such GUID". Real 404 behaviour
is unverified until a valid GUID is held.

## The four operations

### Find an existing GUID

```
GET /scim2/v1/users?schema={userSchema}&filter=userName eq "user@example.com"
```

Returns a standard SCIM `ListResponse`. Look GUIDs up **at runtime**; never persist one as a source
of truth.

> On the FAHM instance this currently returns `totalResults: 0` for every username, unfiltered
> included. FAHM users were created directly in Encompass and never SCIM-provisioned, so **nobody
> holds a `globalUserId` yet.** Every user needs one minted via `POST /accountLinks` — and that is a
> write.

### Create an account link — mint a GUID

```
POST /accountLinks
Content-Type: application/json

{
  "schemas": ["{linkSchema}"],
  "{linkSchema}": { "userName": "user@example.com" }
}
```

**201 Created.** The system-generated GUID comes back as `id` / `globalUserId`.

Errors: `400` empty or invalid payload/schemas/userName · `401` bad JWT · `403` unauthorized ·
`404` user does not exist · **`409` a GUID already exists for this user** · `500` · `503`.

A `409` means the user already has a GUID — read it with Get Linked Accounts, then PATCH their other
product account onto it.

### Link a further account to an existing GUID

```
PATCH /accountLinks/{globalUserId}

{
  "schemas": ["{linkSchema}"],
  "{linkSchema}": { "encompassUser": {} }
}
```

**204 No Content.** Errors: `400` · `401` · `403` · `404` user or GUID not found ·
**`409`** already linked / multiple IDs exist · `500` · `503`.

### Read everything tied to a GUID

```
GET /accountLinks/{globalUserId}
```

**200 OK**, pairing each username with its ICE MT product:

```json
{ "accountLinks": [ { "username": "user@example.com", "product": "Product Name" } ] }
```

### Delete a link

```
DELETE /accountLinks/{globalUserId}?schema={userSchema}
```

**204 No Content.** `schema` is a **required** query param.

Removes the link between a username and a GUID. It does **not** delete the product account, and does
**not** remove the GUID — one GUID can span many products. Primary use is resolving duplicate-GUID
conflicts.

## Flows

### One-time migration

For every current employee across ICE products:

1. **Look up** any existing GUID via Get Users filtered by `userName`.
2. **No GUID?** → `POST /accountLinks`. Capture the returned `globalUserId`.
3. **GUID exists in one product, person also exists in another?** → `PATCH` for each additional
   product account.
4. **Verify** with `GET /accountLinks/{guid}` — every product account appears exactly once.
5. **Duplicate GUIDs for one person?** → pick the canonical GUID, `DELETE` the strays, re-`PATCH`
   them onto the canonical one.

At scale, handing the migration to ICE Professional Services is a real option.

### Ongoing provisioning

Bake linking into onboarding so it never drifts. A user created **through SCIM** gets a GUID
automatically; link further product accounts with `PATCH` as they are created. A user created
**out-of-band** needs the migration sequence run for that one person.

### Idempotency

- Treat `409` as "already exists" — `GET` and reconcile, never blind-retry the same `POST`/`PATCH`.
- Fetch GUIDs at runtime; never cache one as a source of truth.
- Make every migration step safe to re-run: check-then-act before create-or-link.

## Prerequisites

- ICE MT / Developer Connect account with **admin** rights over user management.
- Licences for **each** ICE product to be linked. Linking only matters when the same person exists in
  two or more.
- **SCIM provisioning enabled on the instance.** Request it from ICE if it is not.
- The service account needs SCIM account-link permissions granted explicitly.
- `userName` for every user in every product.

## Still open

1. **No sandbox or UAT host for SCIM.** The first `POST /accountLinks` mints a real, permanent GUID
   on a live user. Do it for **one volunteer account** first.
2. **GUID format** — opaque string vs canonical UUID. Treat as opaque; unverifiable until one is held.
3. **The exact `POST`/`PATCH` body.** ICE's own pages contradict each other on the `schemas` key: the
   overview shows a SCIM-standard **array** plus a sibling object keyed by the URN; the reference
   pages show an **object map**. Only one can be right, and it can only be settled by attempting a
   write. Every documented example also leaves the inner product object empty (`encompassUser: {}`),
   so the expected inner shape is unknown.
4. **`DELETE` is not an un-mint.** It removes a *link*, not the GUID, and a GUID is immutable once
   minted. There is no documented way to reverse a mint — which is why the first write matters.

## Canonical ICE references

- Cross-Domain SSO overview: `/developer-connect/docs/ice-mt-cross-domain-sso`
- SCIM Global User ID: `/developer-connect/docs/scim-global-user-id`
- Reference pages: `/developer-connect/reference/{create-account-link, get-linked-accounts,
  link-user-to-existing-guid, delete-account-link}`
