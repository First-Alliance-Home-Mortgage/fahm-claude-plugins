# Encompass canonical field IDs

The `PIPELINE_FIELDS` map as FAHM uses it: Encompass canonical name → friendly property name.
Transcribed from `com.echat.ai` → `app/lib/chatbot/encompass.ts`. Where this file and that source
disagree, the source wins.

`scripts/resolve-field.mjs` parses the tables below. Keep the three-column
`| canonical | property | note |` shape when editing.

## Insertion order is load-bearing

The transform walks this map **in order**, so a later entry overwrites an earlier one when both are
populated. That matters in exactly one place:

```
Fields.2012 → underwriterName   FALLBACK — listed first, only wins when Fields.984 is empty
Fields.984  → underwriterName   PRIMARY  — listed second, wins when both are present
```

`Fields.2012` is sparse and at least one loan stores a **date string** in it. Reordering those two
lines is a silent data-corruption bug.

`Fields.362` and `Fields.1811` both map to `processorName` under the same rule — the later entry is
the fallback that fills in when the first is empty.

## Corrections that were expensive to learn

Each verified against the live instance; each contradicts what the field name suggests.

| Field | What it actually is |
|---|---|
| `Fields.1997` | **Funds Sent Date — a date field**, not a loan status. Filtering it with `"Closed"` returns 400 |
| `Fields.364` | the **loan number**, not the branch name. Formerly mapped to `branchName`; `Fields.ORGID` is canonical for branch |
| `Fields.3422` | investor purchase **price as % of par** (par = 100), not a dollar amount. `> 0` means the loan has been sold on the secondary market |
| `Fields.2306` | Account Executive — **empty on this instance**. Use `Fields.TPO.X30` |
| `Fields.TPO.X61` | the TPO loan officer's **name**. `X63` is their email |
| `Fields.TPO.X1` | TPO Company ID — **the same value for every loan**, not the broker name |
| `Fields.TPO.X14` | broker company name, sparsely populated. `Fields.1822` is authoritative for broker grouping |
| `Fields.2` vs `Fields.1109` | total loan amount **includes** financed fees; base loan amount does not. Use `Fields.2` for volume reporting |
| `Fields.317` | returns the same LO name as `Loan.LoanOfficerName` — a redundant alias, not an address |
| `Fields.37` | matches `Fields.4002` exactly. Kept only because some prompt specs reference it directly |

## Core loan identifiers

| Canonical | Property | Note |
|---|---|---|
| `Loan.LoanFolder` | `loanFolder` | Every loan lives in exactly one folder |
| `Loan.LoanNumber` | `loanNumber` | |
| `Loan.LoanAmount` | `loanAmount` | Same as `Fields.1109` — excludes financed fees |
| `Loan.LoanRate` | `interestRate` | |
| `Loan.BorrowerName` | `borrowerName` | |
| `Loan.LastModified` | `lastModified` | |
| `Loan.CurrentMilestoneName` | `currentMilestone` | |

## Property

| Canonical | Property | Note |
|---|---|---|
| `Loan.Address1` | `propertyAddress` | Joined into `fullPropertyAddress` downstream |
| `Loan.City` | `propertyCity` | |
| `Loan.State` | `propertyState` | |
| `Loan.Zip` | `propertyZip` | |

## Borrower

| Canonical | Property | Note |
|---|---|---|
| `Fields.4000` | `borrowerFirstName` | |
| `Fields.4002` | `borrowerLastName` | |
| `Fields.37` | `borrowerLastNameAlt` | Verified identical to `Fields.4002`; alias only |

## Dates

Every date arrives `M/D/YYYY`, sometimes with a time. Never ISO, never `Date.parse` raw.

| Canonical | Property | Note |
|---|---|---|
| `Fields.745` | `applicationDate` | |
| `Fields.748` | `closingDate` | |
| `Fields.763` | `estimatedClosingDate` | |
| `Fields.2025` | `loanCreationDate` | **A bounded range on this field returns 500.** See pipeline-queries.md |
| `Fields.352` | `rateLockExpiration` | |
| `Fields.Log.MS.Date.Funding` | `fundedDate` | Funding milestone date |
| `Fields.3142` | `gfeApplicationDate` | RESPA/TRID marker that a true application exists. Empty on prospect-folder loans |
| `Fields.749` | `currentStateDate` | Date the loan entered its current `Fields.1393` status |
| `Fields.1997` | `loanStatus` | **A DATE — funds sent.** Named `loanStatus` for historical reasons |

## Status

Only one field here holds status text. The field *named* `loanStatus` is a date and is listed under
Dates above.

| Canonical | Property | Note |
|---|---|---|
| `Fields.1393` | `loanStatusAlt` | **The field that holds actual status text.** Match `contains` |

## Loan details

| Canonical | Property | Note |
|---|---|---|
| `Fields.2` | `totalLoanAmount` | Includes financed fees — use for volume reporting |
| `Fields.3` | `noteRate` | Matches `Loan.LoanRate`. Supports `greaterThan` |
| `Fields.19` | `loanPurpose` | Purchase, Refinance, etc. |
| `Fields.384` | `loanPurposeAlt` | |
| `Fields.608` | `loanProgram` | |
| `Fields.1401` | `loanProgramAlt` | Match `contains` — `"Non-QM"` must catch `NON-QM - DSCR`, `Non-QM Bank Statement`, … |
| `Fields.1172` | `mortgageType` | Conventional, FHA, VA, USDA/RHS |
| `Fields.1109` | `baseLoanAmount` | Excludes financed fees |
| `Fields.3422` | `purchaseAdviceActual` | **% of par, not dollars.** Supports `greaterThan` |
| `Fields.2626` | `channel` | Compound values — match `contains`, never `exact` |

## People and roles

| Canonical | Property | Note |
|---|---|---|
| `Loan.LoanOfficerName` | `loanOfficerName` | Canonical LO name; correct in the pipeline |
| `Fields.317` | `loanOfficerNameAlt` | Redundant alias of the above |
| `Fields.1416` | `loanOfficerNameAlt2` | Sparse secondary fallback |
| `Fields.362` | `processorName` | Primary |
| `Fields.1811` | `processorName` | Fallback — later entry, fills in when 362 is empty |
| `Fields.2012` | `underwriterName` | **FALLBACK ONLY.** Stores a date string on at least one loan |
| `Fields.984` | `underwriterName` | **PRIMARY.** Underwriter Contact |
| `Fields.2306` | `accountExecNameLegacy` | Empty on this instance |
| `Fields.TPO.X30` | `accountExecName` | **Canonical AE field** |
| `Fields.TPO.X61` | `tpoLoanOfficerName` | Broker-side originator. Use when channel is `"Banked - Wholesale"` |

## Organization and branch

| Canonical | Property | Note |
|---|---|---|
| `Loan.OrgId` | `orgId` | |
| `Fields.ORGID` | `orgCode` | **Canonical branch field.** Equals `orgInformation.orgCode`, *not* `organization.entityId` |
| `Fields.VEND.X263` | `investorName` | Investor, not broker |
| `Fields.TPO.X1` | `tpoCompanyId` | Constant across loans — not the broker name |
| `Fields.TPO.X14` | `brokerName` | Legacy, sparse |
| `Fields.1822` | `referralSourceName` | Authoritative for broker-grouped volume |

## Derived properties

These exist nowhere in Encompass; the transform computes them.

**`branchName`** — the pipeline exposes no per-loan branch name, so it is looked up from
`Fields.ORGID` through the branch-code map, falling back to the raw code.

**`officerType` / `effectiveLoanOfficerName`** — `"Banked - Wholesale"` loans attribute to the
broker-side originator (`Fields.TPO.X61`); everything else uses `Loan.LoanOfficerName`.

**`channelBucket`** — `"Banked - Retail"` → Retail; `"Banked - Wholesale"` **and** `"Brokered"` →
Wholesale (TPO).

> The asymmetry between the last two is deliberate. A `"Brokered"` loan is
> `channelBucket = "Wholesale (TPO)"` (its production is third-party-sourced) but
> `officerType = "Retail"` (no `Fields.TPO.X61`; its LO is an internal originator). Retail vs
> Wholesale is a different question depending on whether volume is being counted or attributed to a
> person. Do not "fix" one to match the other.

**`closingMonth`** (`YYYY-MM`) from `Fields.1997` · **`statusQuarter`** (`YYYY-Qn`) from `Fields.749`.
Not substitutes. `Fields.1997` is empty on every loan that never funded — precisely the withdrawn,
denied and incomplete population a fallout report is about, all of which would bucket as "Unknown".

> **A cohort scoped by `Fields.749` must be bucketed by `Fields.749`.**

## Amount parsing

`loanAmount`, `totalLoanAmount` and `interestRate` arrive as fixed-point strings and are parsed to
numbers by the transform. Anything else stays a string.
