# Pipeline queries

`POST /encompass/v3/loanPipeline`. The v3 surface also exposes
`POST /encompass/v3/loanPipeline/report` and `GET /encompass/v3/loanPipeline/canonicalFields`; the v1
surface has `POST /encompass/v1/loanPipeline` and `GET /encompass/v1/loanPipeline/fieldDefinitions`.

## Filter shape

A filter is either a bare term, or `{ operator: "and", terms: [...] }`. Three return shapes come out
of a filter builder: `undefined` when nothing applies, the bare term when there is exactly one, and
the wrapped form otherwise.

**Access filter terms must come first and must be unconditional.** When every query funnels through
one builder, a newly added tool is scoped *by construction* rather than by the author remembering to
opt in. See [scoping-and-permissions.md](scoping-and-permissions.md) for what gets injected.

## Match types are not interchangeable

| Param | Term | Why this match type |
|---|---|---|
| `channel`, `channelContains` | `Fields.2626` **contains** | Live values are compound — `"Banked - Retail"`, `"Brokered - Wholesale"`. `exact` on `"Retail"` returns zero rows |
| `loanStatus` | `Fields.1393` contains | Live value is `"Active Loan"`; contains survives label drift |
| `loanStatusExact` | `Fields.1393` exact | Honours a spec written as `= "Active Loan"` and future-proofs against new `Active *` values |
| `loanProgram` | `Fields.1401` contains | `"Non-QM"` has to catch `NON-QM - DSCR`, `Non-QM Bank Statement`, `Non-QM P&L`… |
| `branch` | `Fields.ORGID` exact **or** contains | A display name resolves to an org code and matches `exact`; an unrecognised string falls back to `contains` rather than being dropped |
| `noteRateMin`, `purchaseAdviceMin` | `Fields.3` / `Fields.3422` greaterThan | Both probed live; the pipeline does support `greaterThan` on these |

> **Two params are accepted and then ignored.** `status` and `withdrawnOnly` add no term and emit a
> warning, because `Fields.1997` is a date field and cannot be matched against a status string.
> Withdrawn loans are separated downstream, not server-side. A caller passing `status` gets an
> unfiltered cohort and **no error**.

## Cohorts — when one query is not enough

Picking the wrong fetcher is the most common way to get a wrong number.

| | Fetch by year | Fetch by creation date |
|---|---|---|
| Date axis | any field (`Fields.1997`, `Fields.3142`, `Fields.749`…) | `Fields.2025` **only** |
| Strategy | one paginated run per calendar year | one paginated run **per loan folder**, unioned |
| Page size | 500 | 300 |
| Hard cap | 8,000 | 8,000 |
| Use it | always, unless the axis is `Fields.2025` | only because there is no alternative |

### Fetch by year

The v3 endpoint silently truncates large result sets on transient 400s past roughly page 7. Three
mitigations:

1. **Split by calendar year**, so each pagination run stays shallow.
2. **Retry each page up to 3×** with exponential backoff (1 s, 2 s, 4 s).
3. **Distinguish the two failure kinds.** A failure at `start=0` throws — that is a real error. A
   failure on any later page records a pagination warning and stops that segment, because the
   alternative is returning a truncated cohort that looks complete.

### The `Fields.2025` workaround

This looks over-engineered until the reason is stated.

**The problem.** `loanPipeline` returns **HTTP 500** for any filter whose terms are a *bounded*
`Fields.2025` range. Verified live at limit 500 / 300 / 100, with and without `sortOrder`, and with a
third discriminating term added (`Fields.1393`, `Fields.3142`, `Fields.749` — all still 500). A lone
`Fields.2025` term returns **400**. The axis is simply unqueryable the ordinary way.

**The way through.** The range *does* work when ANDed with a sufficiently discriminating term —
`Loan.LoanFolder exact` or `Fields.ORGID exact` both return 200. Every loan lives in exactly one
folder, so a union over all folders reconstructs the cohort **exactly**, with no change to the
business definition.

**Why not use a different date field.** Because it would change the answer. A large share of loans
created year-to-date sit in the Prospects folder with no GFE date at all, so re-basing on
`Fields.3142` would silently drop most of them.

**Cost and quirks.** One paginated query per loan folder; most return zero rows fast, and the folder
list is worth caching (15 min) with in-flight deduplication. Page size is pinned to 300 because
`limit > 300` is a *separate* 500 on these shapes. Deduplicate by `loanGuid → loanId →
Loan.LoanNumber`. Two folders on the live instance misbehave **consistently, not transiently**:

- One refuses the windowed query but answers an unbounded-start one — fetch it wide and filter
  client-side.
- One refuses both, and must be **named in the pagination warnings** rather than quietly dropped.

### Pagination warnings are not decoration

The warnings array is non-empty exactly when the cohort may be incomplete — a hard cap hit, a segment
cut short, or an unreadable folder. **Surface it.** A report that swallows these presents a truncated
count as a real one, which is worse than an error.

## Aggregation

**Grouping.** A friendly `groupBy` maps to a property; an unmapped value passes through as a raw
property name. People dimensions (underwriter, processor, LO, account exec) label an empty value
`"(Unassigned)"` rather than `"Unknown"` — "nobody was assigned" is a real finding, not missing data.

**Rate reports.** A rate needs a numerator *and* a denominator out of one pipeline call. Filtering the
numerator server-side would return only matching loans and collapse every rate to 100%. So the cohort
comes back unfiltered and the numerator is marked **client-side** by a predicate.

> This used to be the model's job and it broke production. Handing hundreds of raw loan objects ×
> ~40 fields to the LLM for a single year-to-date window reliably tripped the tokens-per-minute
> ceiling and returned HTTP 429 instead of a report. Two consequences are load-bearing: a rate
> request **never** ships the raw cohort back (the aggregate *is* the answer), and an unknown rate
> key **throws** rather than degrading to a silent 0%.

Carry a status-distribution audit alongside every rate — the full distribution of the classification
field with match flags — so a reader can see the denominator's composition and which live spellings
the tolerant test actually caught.

**Sorting** depends on what was asked:

| `groupBy` | Order | Why |
|---|---|---|
| `month`, `statusQuarter` | chronological (lexical on `YYYY-MM` / `YYYY-Qn`) | a time series reads left to right |
| any, with a rate | rate desc, matched count as tiebreak | a volume sort buries a high-rate niche product |
| everything else | total volume desc | |

Flag rows below 20 loans as a small sample. Carry the numerator into sub-groups so a rate can be
broken out along a second dimension without the model inventing the arithmetic.

## Borrower contacts

`POST /encompass/v1/borrowerContactSelector`. Route a free-text query to an email, phone or name
search. Match phone queries against **both** the raw input and a standard-dashed candidate — stored
numbers carry formatting that a digits-only `Contains` would miss.

> **The contacts selector uses different casing from the loan pipeline.** Contacts want
> `operator: "Or"` / `matchType: "Contains"`; the loan pipeline wants `operator: "and"` /
> `matchType: "contains"`. Copying a filter from one to the other without adjusting case is a silent
> zero-row result.

Exclude `Contact.SSN` and `Contact.Birthdate` from any default field set — PII, opt-in only.

**Contacts year-to-date is loan-first, and has to be.** The Contacts CRM exposes no created-date and
neither selector returns associated-loan dates, so "year to date" can only be scoped by the *loan's*
`Fields.2025`. Read borrower, co-borrower and loan-officer contacts straight off pipeline fields with
no per-loan calls. Dedupe borrowers and co-borrowers on name + email, loan officers on name; the same
person appearing as both borrower and co-borrower stays two rows. Processor, title and realtor need a
per-loan `/associates` call and are omitted on purpose.

## Single-loan reads

`GET /encompass/v3/loans/{id}` **omits empty fields server-side** — an absent key means empty, not
missing. `POST /encompass/v3/loans/{id}/fieldReader` reads specific fields without pulling the whole
loan.

eFolder **document containers** come from `/loans/{id}/documents?view=Full` — the rows the eFolder UI
shows, which are distinct from the raw files under `/attachments`. Drop rows marked removed.

> A milestone transform that falls back to "now" when a milestone has neither `completedDate` nor
> `updatedAt` renders as *today* rather than as unknown on an instance where the milestones API does
> not return `completedDate`. Check the raw response before trusting a milestone date.
