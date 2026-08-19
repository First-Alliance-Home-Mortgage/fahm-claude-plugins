# Per-user scoping and prompt permissions

Two independent layers. **Row scoping answers WHICH LOANS. Prompt permission answers WHICH
QUESTION.** They are orthogonal, and confusing them is the main way this gets implemented wrong.

| Switch | Values | Controls |
|---|---|---|
| `ENCOMPASS_SCOPING_MODE` | `report` (default) \| `enforce` | which loans |
| `PROMPT_PERMISSION_MODE` | `report` (default) \| `enforce` | which questions |

## The problem being solved

Every FAHM app calls Encompass through a **single shared service account**. The signed-in user's
identity reaches session ownership but not the data layer, so without this any authenticated user can
ask for the entire company pipeline. Role fields exist on the user model but scope no loan data.

## Resolving a user

1. Fetch `GET /encompass/v1/company/users`, cached 15 minutes.
2. Match the app login **email** client-side.
3. Map the user's **personas** to a tier; translate their organization to a branch code.

> **Server-side filtering on that endpoint does not work.** `?email=`, `?filter=` and `?userName=`
> are silently **ignored** — the API returns the full unfiltered list with `200` instead of erroring.
> Trusting them returns the first user for every lookup. Matching must stay client-side.

### Tiers

| Persona | Scope | Filter applied |
|---|---|---|
| Administrator, Super Administrator | company | none |
| Branch Manager, Manager, and back-office (Loan Processor, Underwriter, Closer, Funder, Disclosures, Post Closer, Shipper, Lock Desk, Secondary Marketing, Quality Control, Accounting, Marketing, Archiver, TPO admin/AE roles) | branch | `Fields.ORGID = <orgCode>` **exact** |
| Loan Officer, TPO Loan Officer | own | `Loan.LoanOfficerName = <fullName>` **exact** |
| anything else | **denied** | query refused |

**Why personas and not `subordinateLoanAccess`.** That field encodes *edit rights*, not job function
— some plain Loan Officers carry `ReadWrite`, and using it would grant them branch-wide visibility.

**`exact`, never `contains`.** A contains-match on a short name returns colleagues' loans.

**Branch codes need translation.** A user's `organization.entityId` is an org primary key. Loans
carry `Fields.ORGID` = `orgInformation.orgCode`. Different numbering systems — resolve via
`GET /encompass/v1/organizations`, walking to the parent org for the few that inherit their code.

## Enforcement

Put the access filter at **every** chokepoint that builds a filter. In `com.echat.ai` there are two —
the shared filter builder and the year-cohort fetcher, which builds its own. Miss one and a new tool
silently returns company-wide data.

Carry the scope in `AsyncLocalStorage` rather than threading a parameter through every call site. A
parameter fails **open** the first time someone forgets it.

**Fail closed in enforce mode:** a `denied` scope throws, and so does a *missing* scope. If an entry
point ever forgets to establish one, the result is a 500, not a silent company-wide read.

**Encompass's own `loanOfficerVisibility=personal` cannot be used** — it scopes to the *token's*
user, which is the shared service account, not the person chatting.

**Cache safety.** The access scope **and the mode** must both be part of any tool-cache key. Without
the scope, one user's filtered results get served to the next caller asking the same question — via
in-flight coalescing, instantly. Without the mode, unfiltered report-only entries get served as
filtered once enforcement flips on.

**The prompt is not the control.** Telling the model about the restriction makes it phrase answers
honestly ("your 12 loans", not "the company closed 12"), but that message is advisory only, and must
be omitted entirely in report-only mode where it would be false.

## Layer 2 — prompt permissions

Row scoping alone does not stop a Loan Officer from *running* a company-wide report. This layer gates
each named report by the same persona-derived tier.

> The data leak is already closed by row scoping: in enforce mode an `own`-tier user who asks for a
> company leaderboard gets a leaderboard with exactly one row — themselves. **That is not a leak.**
> This layer exists so that one row is not *presented as a company statistic*, and so the model does
> not spend a large aggregation producing it.

Keep the slug→tier map in **one file**, not as a field on each report definition — the whole access
matrix should be reviewable on one screen.

**The rule:** a slug requires the *lowest tier at which its output is still a truthful answer to the
question the slug is named for*, after row scoping has been applied.

| Tier | Unit of analysis |
|---|---|
| `own` | One loan, or the caller's own book |
| `branch` | Team aggregates, product mixes, terminal-state listings, turnaround intervals |
| `company` | Crosses branches or organisations, or is not row-filtered at all |

Note the tie-break the rule produces **on purpose**: a branch manager is refused a cross-branch
*ranking* (filtered to one branch it is a wrong answer, not a narrow one) but is **allowed** a total
that row scoping narrows to exactly their branch. The refusal payload *offers* that substitution
rather than silently performing it.

Unclassified slugs default to `company` (fail closed), and a coverage test should assert the table
and the registry hold exactly the same slugs — a new report must not be able to ship unclassified.

### What is gated, and what deliberately is not

| Gated | Why |
|---|---|
| The named-report tool, per slug | The primary path |
| The free-form pipeline report tool, when grouping by branch, channel, channelBucket, broker, accountExec, underwriter or processor | The one tool that can reconstruct any company-tier slug free-form |
| Company-users and organizations reads | Directory reads, **not** pipeline reads — the access filter never touches them, so an LO could otherwise enumerate the whole directory |

**Everything else is ungated on purpose.** Loan search, loan details, field reads and the compute
family all funnel through the access filter, so their rows are already narrowed. Gating them would
break the one thing an LO must be able to do — ask about their own book — and buy no security. The
grouping guard likewise excludes `loanOfficer`, `productType`, `month`, `loanPurpose` and
`loanProgram`: those narrow correctly and are the whole of branch-manager and LO self-service.

### Enforcement placement

Primary gate: the tool-dispatch loop, **above** any cached-execute helper. A helper that checks the
cache before calling the executor means a check placed only inside the executor is skipped entirely
on a cache hit.

Defence in depth: inside the report handler, **before planning runs** — refusing before planning
costs zero Encompass calls, and some plans are a paginated scan plus hundreds of milestone requests.

### The refusal payload

- Name the key **`error`**, so cache logic that skips caching error results never pins a refusal for
  the TTL. Flipping the flag back off then takes effect immediately.
- **Compute** the allowed alternatives from the same table, ranked by name overlap with what was
  asked, so it can never suggest something that will also refuse and the model can never invent a
  slug that does not exist.
- **No numbers anywhere in the payload.** The biggest hallucination risk on a refusal is the model
  answering from baseline figures baked into the system prompt. Assert the prose fields contain no
  digits.

Make the no-retry guarantee **structural, not prompted**: put the report tool in the terminal-tools
set so the round after a refusal is sent without the tools array and the model physically cannot call
anything else.

### Why the report enum is not filtered per user

Tempting — a per-user enum means the model never picks a forbidden slug. Rejected because (1) it is
not a control, since the free-form tool reaches the same data either way; (2) it makes refusals
*worse* — with the full enum the model names the exact report and explains it, while with a filtered
enum it has no name for what was asked and falls back to the raw tool, pushing traffic toward the
hole; and (3) it expresses one decision in two places that can drift.

## Before switching to enforce

Expect a meaningful share of existing app users to be denied on first measurement, for two reasons:

- **No Encompass account matches their email** — common for admin and shared accounts.
- **The email is shared by several active Encompass accounts.** Ambiguity is refused **on purpose**.
  Picking one candidate by iteration order is a coin flip, and where one of the candidates is an
  admin account it is a **privilege-escalation path**. Fail closed.

**Data-hygiene work to do first:** give integration logins their own addresses rather than a human's;
split shared team mailboxes into per-person addresses; ensure every app user has exactly one active
Encompass account with a unique email.

### Flip the two flags in this order

Conjoin the prompt-permission check with the row-scoping check **in code**, not merely as documented
ordering: while rows are unfiltered, refusing a named report is theatre, because the same numbers are
one free-form question away. Setting only `PROMPT_PERMISSION_MODE=enforce` must do nothing, by design.

1. **Merge with both flags at `report`** — zero behaviour change in production.
2. Watch the report-only log lines against real traffic. Work the data-hygiene items until every
   active user shows a real tier.
3. `ENCOMPASS_SCOPING_MODE=enforce`. Observe, then run the scenario suite.
4. `PROMPT_PERMISSION_MODE=enforce`. Run the scenario suite again — company-tier reports must still
   work for admin users, while an LO account should now receive a refusal rather than a one-row table.

The two assertions that matter most in tests: the slug-table coverage check (a new report cannot ship
unclassified), and that prompt-permission enforcement is **false** when only `PROMPT_PERMISSION_MODE`
is set — the flag ordering is a test, not a convention.
