# Contributing

Authoring standards for skills in this repository. These are rules, not preferences — each exists
because of a specific failure mode, and the rationale is stated so it can be argued with rather than
guessed at.

Run `node scripts/validate-repo.mjs` before every commit. It enforces most of what follows.

---

## 1. Portable frontmatter only

Use only these six keys:

```yaml
---
name: kebab-case-name          # must match the directory name
description: …                 # see rule 2
license: LicenseRef-FAHM-Proprietary
metadata:                      # free-form; Claude Code ignores the contents
  owner: First Alliance Home Mortgage
  source: fahm-claude-plugins/plugins/<plugin>
  last-reviewed: YYYY-MM-DD
allowed-tools: …               # only when genuinely needed — see below
---
```

Claude Code accepts many more (`when_to_use`, `paths`, `context`, `effort`, `shell`,
`disable-model-invocation`, `user-invocable`, `disallowed-tools`, `hooks`, `arguments`,
`argument-hint`, `model`). **claude.ai skill uploads and the Skills API accept only the six above,
and reject anything else as a hard error, not a warning.** Skills written to the six-key subset work
everywhere; skills that reach for a Claude Code extra are stuck in Claude Code. Default to the subset.

**`version` is not a SKILL.md field.** It belongs in `plugin.json`. Some of Anthropic's own bundled
examples show `version:` in SKILL.md; they are out of date.

**Be careful with `allowed-tools`.** It pre-approves tools for the invoking turn; it does not
restrict anything. But an over-narrow list on a skill that legitimately writes files produces a skill
that fails silently. None of the current four skills declares one, on purpose.

## 2. Description budget — target ≤ 600 characters, hard ceiling 700

This is the rule that matters most at scale, and the reason is not obvious:

- `description` plus `when_to_use` is **truncated at 1,536 characters** in the skill listing.
- The whole skill listing has a budget of roughly **1% of the model's context window**.
- On overflow, Claude Code **silently drops descriptions, starting with the least-invoked skills**.

A dropped description means the skill loses its trigger keywords and **stops firing, with no error
and no log line**. At four skills the listing is comfortable. The rule exists so that at fifteen it
still is.

Write the key use case first, and end with a `Use when …` sentence carrying the literal trigger
tokens a person would actually type. Measure before committing:

```powershell
(Select-String -Path SKILL.md -Pattern '^description:').Line.Length
```

Re-check the total cost with `/doctor`, which estimates listing cost and names the top contributors.

**Grandfathered exceptions.** `docs-answers` (984 chars) and `project-turnover` (952) exceed the
ceiling. They are allowlisted by name in `scripts/validate-repo.mjs` and scheduled for a trim.
Trimming a description is a **trigger-coverage change** and deserves its own evaluation — it was not
done as a drive-by edit during the migration that created this repo. **Decide that trim before adding
a fifth skill, not after.**

## 3. Voice, size, and structure

**Imperative or infinitive, never second person.** "Validate the input before processing", not "You
should validate the input."

**Body 1,500–2,000 words; hard ceiling under 5,000.** Progressive disclosure has three levels:
metadata (always in context), the SKILL.md body (loads on invoke), and bundled resources (loaded or
executed on demand).

**A fact lives in SKILL.md *or* in a reference — never both.** Duplication is how the two drift.

**Every bundled file must be linked from SKILL.md.** An unreferenced file is invisible: Claude does
not know it exists. The validator checks that every relative link resolves, but it cannot check that
a file is reachable — that is on the author.

Use the four resource buckets for what they are:

| Directory | Loaded into context? | For |
|---|---|---|
| `references/` | On demand | Schemas, API details, policies — things read to answer a question |
| `scripts/` | **Never** — executed | Deterministic work. Token-free by construction |
| `templates/` | Used in output | Fallback structures for a repo with nothing to learn from |
| `assets/` | Never | Files that appear in output — logos, fonts, boilerplate |

One lifecycle detail worth knowing: invoked skill content enters the conversation once and **stays
for the session**. Claude Code never re-reads the file. Write standing instructions, not one-time
steps.

## 4. Paths

Use `${CLAUDE_SKILL_DIR}` for anything inside a skill, and `${CLAUDE_SKILL_DIR}/../<sibling>` to
reach a sibling skill in the same plugin. Both are substituted in the markdown body **and** inside
`allowed-tools` Bash rules.

**Never** `$HOME`, `$env:USERPROFILE`, or an absolute path. The validator rejects all three.

The sibling form is deliberate: sibling skills share a parent directory in both layouts
(`~/.claude/skills/a/../b` and `plugins/p/skills/a/../b`), so a skill written this way works whether
it is installed as a plugin or copied into a home directory. `${CLAUDE_PLUGIN_ROOT}` also works but
is plugin-only, and loses that property.

**One spelling, not two.** A quoted forward-slash path resolves identically on Windows and POSIX. A
Bash line plus a PowerShell line is two things to keep in sync, and one of them will rot.

## 5. Secrets, PII, and redaction

> This repository documents a mortgage lender's loan-origination-system integration. It contains
> **method and metadata only**: endpoint paths, parameter names, field identifiers, error codes, and
> the reasoning behind design decisions. It never contains a credential, a borrower, a real loan, a
> real person, or a live business figure. Every example is synthetic.
>
> **A change that adds a value is rejected on that basis alone**, without an argument about whether
> that particular value is sensitive.

### Redaction conventions

| Category | Convention |
|---|---|
| Client id / secret / password / token | `<client-id>`, `<client-secret>`, `<service-account-password>`, `<access-token>`. Never a truncated or "expired" real value |
| Instance id | `<instanceId>` everywhere. One exception: a provenance line may say "verified 2026-07-22 against production" — keep the date, drop the identifier |
| Loan GUID / loan id | `{{loanGuid}}` or `00000000-0000-0000-0000-000000000000` |
| Loan number | `2600000000` — obviously synthetic |
| Borrower name / email / phone | `Jane Doe`, `borrower@example.com`, `555-0100` (the reserved fictional range) |
| SSN, date of birth | **Never appear, even as placeholders** |
| Employee name / work email | `<loan-officer-name>`, `user@example.com`. The source docs this repo was distilled from name real FAHM staff and real mailboxes; none of it carries over |
| Branch / org codes | `<orgCode>`. Real codes are omitted entirely |
| Live counts and volumes | **Omitted.** Not "969 users" or "2,972 loans YTD" — a live count leaks scale and ages badly. Where magnitude is load-bearing, write "a paginated scan of the full company directory" |
| Hosts | Public ICE hosts (`api.elliemae.com`, `concept.api.elliemae.com`) are fine. Internal FAHM hosts, tunnels and admin URLs are not |

### Never commit an export

`.gitignore` blanket-denies `*.csv`, `*.xlsx`, `*.docx`, `*.pptx`, `*.pdf`, `*.zip`, `*.har` and
`*.postman_collection.json`. This is load-bearing, not tidiness: API field exports and loan-volume
spreadsheets live one folder away in OneDrive and are exactly what gets dropped into a docs repo
"temporarily".

Reference material is **authored as markdown**, never committed as a spreadsheet. If a specific
derived file must ever be tracked, add an explicit `!` exception in the same commit as a human
review — never `git add -f`.

## 6. Releasing

1. `node scripts/validate-repo.mjs`
2. `claude plugin validate .` and `claude plugin validate ./plugins/<name> --strict`
3. `claude --plugin-dir ./plugins/<name>` — smoke-test the change in a real session
4. **Bump `version` in the owning `plugin.json`.** That string is the update gate: teammates get the
   change only when it changes. A substantive edit without a bump ships to nobody.
5. Commit.

Names are kebab-case throughout — skills, plugins, and the marketplace.

## 7. Adding a skill

- New skill in an existing plugin → a directory under that plugin's `skills/`, and a `version` bump.
- New subject area → a new plugin under `plugins/`, plus an entry in `.claude-plugin/marketplace.json`.
  Prefer a new plugin when the update cadence or the audience differs; prefer a sibling skill when
  the skills are a coupled set that would break if installed separately.

Before adding a fifth skill anywhere, settle the description-budget trim in rule 2.
