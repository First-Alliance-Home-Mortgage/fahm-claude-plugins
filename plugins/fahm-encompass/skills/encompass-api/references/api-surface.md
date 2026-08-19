# Developer Connect API surface

A routing table, not a specification. Find the right group here, then confirm the exact path and
parameters against ICE's reference before calling it.

**Derived from:** the `26.2_Encompass_Developer_Connect` Postman collection — 13 top-level groups,
~800 requests, ~600 distinct paths. **Derivation date:** 2026-08-19.

> **Version drift warning.** Several FAHM repo docs cite collection **v25.4**; the collection on
> hand is **26.2**. When ICE ships a new collection nothing announces that this file is stale —
> re-derive it and update the version line above rather than patching entries.

## Two API versions, different shapes

Most resources exist at both `/encompass/v1/…` and `/encompass/v3/…`, and they are **not** drop-in
equivalents — different request bodies, different response shapes, sometimes different capabilities.
`v3` is generally the newer surface. FAHM uses `v3` for the loan pipeline and single-loan reads, and
`v1` for the company directory, organizations and borrower contacts.

Where both exist, name the version explicitly. "the loans endpoint" is ambiguous.

## What FAHM actually calls

Everything else in this file is available but unused. Start here.

| Purpose | Endpoint |
|---|---|
| Mint a token | `POST /oauth2/v1/token` |
| Loan pipeline query | `POST /encompass/v3/loanPipeline` |
| Canonical field list | `GET /encompass/v3/loanPipeline/canonicalFields` |
| Single loan | `GET /encompass/v3/loans/{id}` |
| Specific fields without the whole loan | `POST /encompass/v3/loans/{id}/fieldReader` |
| Loan folders (for the `Fields.2025` union) | `GET /encompass/v3/loanFolders` |
| Milestones | `GET /encompass/v3/loans/{id}/milestones` |
| Associates | `GET /encompass/v1/loans/{id}/associates` |
| eFolder document containers | `GET /encompass/v1/loans/{id}/documents?view=Full` |
| Company directory (for user resolution) | `GET /encompass/v1/company/users` |
| Organizations (for branch-code translation) | `GET /encompass/v1/organizations` |
| Personas | `GET /encompass/v3/settings/personas` |
| Borrower contact search | `POST /encompass/v1/borrowerContactSelector` |
| SCIM account linking | `POST\|GET\|PATCH\|DELETE /scim2/v1/accountLinks` |
| SCIM user lookup | `GET /scim2/v1/users?schema={urn}` |

## The 13 groups

### Authentication
`/oauth2/v1/token` · `/oauth2/v1/token/introspection`. Also **User Impersonation** — a distinct token
flow that acts as another user. FAHM does not use impersonation; note that it exists before
concluding per-user Encompass access is impossible.

### Encompass Loan
The largest group by far. Sub-groups and their base paths:

| Sub-group | Base |
|---|---|
| Loan Pipeline | `/encompass/{v1,v3}/loanPipeline`, `/encompass/v3/loanPipeline/report` |
| Loan Management | `/encompass/{v1,v3}/loans`, `/encompass/v1/importers/loan`, `/encompass/v1/loanfolders/{folder}/loans` |
| Loan Schema | `/encompass/v1/schema/loan`, `/encompass/v3/schemas/loan{,/standardFields,/virtualFields}` |
| Loan Folder | `/encompass/v3/loanFolders` |
| Associates & Milestones | `/encompass/{v1,v3}/loans/{id}/{associates,milestones,milestoneFreeRoles}` |
| eFolder Documents | `/encompass/{v1,v3}/loans/{id}/documents` |
| eFolder Attachments | `/encompass/{v1,v3}/loans/{id}/attachments`, `/efolder/v1/loans` |
| eFolder Export / History | `/efolder/v1/exportjobs`, `/encompass/v3/loans/{id}/efolderHistory` |
| Loan Conditions / Enhanced Conditions | `/encompass/v1/loans/{id}/conditions`, `/encompass/v3/loans` |
| Rate Locks | `/encompass/v1/loans/{id}/…` (16 requests) |
| Disclosure Tracking, Audit Trail, AUS Tracking Logs, Registration Logs, Conversation Log | `/encompass/{v1,v3}/loans/{id}/…` |
| Borrower Pairs, Borrower Vesting | `/encompass/{v1,v3}/loans/{id}/…` |
| Batch Update | `/encompass/v1/loanBatch` |
| Resource Lock | `/encompass/{v1,v3}/resourceLocks` |
| Loan Funding, Loan Alerts | `/encompass/v3/loans/{id}/…` |
| Manage Loan Sub-collections | `/encompass/{v1,v3}/loans/{id}/…` (17 requests) |

> The collection contains a typo — one Loan Conditions request targets `/encomapss/v1/loans`.
> That is a defect in ICE's collection, not an alternate host.

### Settings and Utilities
The second-largest group, and where identity lives.

| Sub-group | Base |
|---|---|
| Settings: Internal Users | `/encompass/v1/company/users{,/{id},/me}`, `/encompass/v3/users` |
| Settings: Organizations | `/encompass/v1/organizations{,/{id},/{id}/children,/root}` |
| Settings: Personas | `/encompass/{v1,v3}/settings/personas` |
| Settings: Roles | `/encompass/{v1,v3}/settings/roles` |
| **Settings: SCIM Account Linking** | `/scim2/v1/accountLinks` — see identity-scim.md |
| **Settings: SCIM Provisioning** | `/scim2/v1/users`, `/scim2/v1/groups` (19 requests) |
| Settings: External Users / Organizations | `/encompass/v3/externalUsers`, `/encompass/v3/externalOrganizations/tpos` |
| Custom Field Management | `/encompass/{v1,v3}/settings/loan/customFields` |
| Custom Data Objects | `/encompass/v1/{company,loans,users}/…` |
| Settings: Document / Loan Templates / Milestones / Policies / Fees / HMDA | `/encompass/v3/settings/…` |
| Tools: Search | `POST /encwsearch/v1/search` |
| Tools: Loan Transformer | `/services/v1/transformer` |

### Encompass Contacts
`/encompass/v1/borrowerContacts` · `/encompass/v1/borrowerContactSelector` ·
`/encompass/v1/businessContacts` · `/encompass/v1/businessContactSelector` ·
`/encompass/v1/contactGroups` · `/encompass/v1/settings/borrowerContacts/fieldDefinitions`.

Selector casing differs from the loan pipeline — see pipeline-queries.md.

### Webhook
`GET /webhook/v1/events` · `/webhook/v1/resources` · `/webhook/v1/resources/{id}/events` ·
`GET|POST|PUT|DELETE /webhook/v1/subscriptions{,/{id}}`.

**Webhook Custom Auth — Premium** is a separate licensed surface:
`/webhook/v1/functions/auth{,/{id},/{id}/test}` and
`/webhook/v1/subscriptions/{id}/functions/auth`.

**No FAHM system consumes Encompass webhooks today.** `ENCOMPASS_WEBHOOK_SECRET` exists in the env
contract with no consumer.

### Services
`/services/v1/partners` (Partner Services) · `/ecs/v1/compliancereports` (Encompass Compliance
Service) · `/epps/v2/{loans,programs,lookups,loanQualifier,userMappings}` (Product and Pricing).

### Secondary and Trades
`/secondary/v1/trades` · `/secondary/v1/tradePipeline` · `/encompass/v3/settings/…` for secondary
settings and funding templates.

### Workflow Management
`/workflow/v1/{tasks,taskPipeline,templates,settings}`. Task configuration and task-instance
management, 30 requests.

### Consumer Engagement
`/loanOpportunity/v1/{loanOpportunities,loanOpportunitySelector,settings}` ·
`/consumers/v1/{invitations,reminders}`.

> Path casing is inconsistent in the collection itself — both `/loanOpportunity/v1/` and
> `/loanopportunity/v1/` appear. Verify which the API accepts before relying on either.

### Encompass Docs
`/encompassdocs/v1/{documentOrders,documentAudits,planCodes}` plus Print OnDemand.

### Document Delivery
`/delivery/v3/{id}` (Delivery Packages) · `/pos/v1/sessions` (Point of Sale Integration Framework).

### Calculators
`/encompass/v3/calculators` — amortization, compliance calendar, print form. `/encompass/v1/calculators`
for loan calculators.

## Before calling anything unlisted

1. Check whether a `v1` and a `v3` form both exist, and which one this instance's licensing exposes.
2. Confirm the request is a **read**. Writes against production need an explicit instruction naming
   the write.
3. Run `scripts/encompass-probe.mjs --endpoint <path>` to see the real status and response shape
   before writing code against an assumed one.
