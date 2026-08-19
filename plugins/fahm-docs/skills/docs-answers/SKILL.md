---
name: docs-answers
description: Answer a question about how a project works by reading the documentation it already has, instead of re-deriving the answer from source. Finds the docs hub, routes the question to the one or two docs that own it, cites the file and line, verifies every load-bearing claim (commands, env vars, paths, ports, schedules) against the real source, and reports where the docs and the code disagree rather than quietly resolving it. Also scaffolds a committed per-repository docs skill — routing table, confidentiality tiers, known drift — so a project answers its own questions. Use when the user asks how something works, where something is configured, what the runbook says, how to deploy or rotate a credential, what a flow does end to end, or any "explain this system" question in a repo that has a docs tree or a substantial README; when checking whether the docs still match the code; or when asked to make the docs usable, reusable or discoverable in another project.
license: LicenseRef-FAHM-Proprietary
metadata:
  owner: First Alliance Home Mortgage
  source: fahm-claude-plugins/plugins/fahm-docs
  last-reviewed: 2026-08-19
---

# Docs answers

Answers questions from the documentation a project already wrote, and says so when that
documentation is wrong.

The docs are the fastest correct answer when they are right and the most expensive wrong answer when
they are stale. This skill reads them first, then checks the parts that would hurt if they had
rotted. It never edits a doc — writing and repair belong to `knowledge-docs`.

## Modes

Resolve from the user's words; the scan rarely changes the answer.

1. **Answer** — "how does X work", "where is X configured", "what does the runbook say", "how do I
   deploy". The default. Steps 1–6.
2. **Coverage** — "do the docs cover X?", "is this documented?". Stop after step 2 and report what
   exists, without opening the source.
3. **Drift** — "are the docs still accurate?", "does this doc match the code?". Steps 1–5 with the
   emphasis inverted: the answer *is* the disagreement list.
4. **Scaffold** — "set this up for this repo", "make the docs reusable here", "give this project its
   own docs skill". Steps 1 and 2, then [Scaffolding a repo docs skill](#scaffolding-a-repo-docs-skill).

## Steps

### 1. Find the docs hub

In order, first hit wins: `docs/README.md`, `docs/index.md`, a docs-site config
(`mkdocs.yml`, `docusaurus.config.*`, `.vitepress/`), the repository `README.md`.

A hub is worth reading in full — it is usually a routing table, and it is short.

When the tree is large, unfamiliar, or the hub is missing, get an inventory rather than guessing.
Reuse the existing scanner; do not write another one:

```bash
node "${CLAUDE_SKILL_DIR}/../knowledge-docs/scripts/scan-docs.mjs" --root <repo-root>
```

It returns the stack, the full doc inventory, gaps, `stale` (docs older than the sources they link
to) and a broken-link baseline. `stale` is the field that matters here — a doc on that list gets
step 4 applied harder, not skipped.

If Node is unavailable, say so and build the inventory by reading. Never report a check that did not
run.

### 2. Route before reading widely

Pick the one or two docs that **own** the question and open those. A hub's routing table exists
precisely so this is a lookup, not a search.

Do not grep the whole docs tree first. Do not open eight files to answer one question — that is the
behaviour the docs were written to replace.

If the routing table does not resolve the question, then search, and note the gap in the report:
a question the index cannot route is a defect in the index.

### 3. Answer from the doc, and cite it

Every claim carries a `path/to/doc.md:NN` reference. The user must be able to check you in one
click, and to find the doc again next time without asking.

Where a doc uses its own reference idiom — numbered sections, anchors, page slugs — use that idiom
in prose and keep the `path:NN` alongside it.

### 4. Verify what is load-bearing

A doc is evidence, not proof. Before repeating any of these, confirm it in the real file:

- commands, scripts and their flags — check `package.json`, the Makefile, the script itself
- environment variable names, config keys, feature flags
- file paths, route paths, table and collection names
- ports, hostnames, schedules, cron expressions, retention windows
- identifiers a wrong digit would break: field IDs, slugs, account IDs, API versions

Everything else — rationale, history, architecture narrative, why a decision was made — take from
the doc as written. It is usually the only place that knowledge exists.

Scale the checking to the blast radius. A question about naming conventions needs none of this; a
question that ends in the user running a command against production needs all of it.

### 5. Report drift, do not silently fix it

Where the source contradicts the doc, **the source wins** — and both get stated:

> `docs/ops/runbook.md:88` says the sweep runs at 02:00 UTC; `lib/cron.ts:14` schedules it at
> 06:00 UTC. The code is authoritative — the doc is stale.

Never paper over it by quietly reporting the right answer. A silent correction leaves the wrong doc
in place for the next reader.

Offer `knowledge-docs` to repair the doc, as a separate step the user can decline. Do not edit while
answering.

### 6. Say when the docs do not cover it

Answer from source instead, label it clearly as *not documented*, and name where the doc would have
belonged. An undocumented answer presented as a documented one is worse than no answer.

## Scaffolding a repo docs skill

This skill knows the method. It cannot know a given project's routing, its confidentiality tiers, or
where its docs have already drifted — that knowledge is per-repository, and it belongs in the
repository. Scaffold mode writes it there, once, as a committed skill.

Output, in the target repo:

```
.claude/skills/<slug>-docs/SKILL.md
.claude/skills/<slug>-docs/references/doc-map.md
```

Both start from [templates/repo-skill.md](templates/repo-skill.md) and
[templates/doc-map.md](templates/doc-map.md). The templates carry HTML comments explaining what each
section is for and when to delete it — **delete every comment before writing the file**, and delete
any section the project has no evidence for. A skill full of empty scaffolding is worse than a short
one.

### 1. Scan and route first

Steps 1 and 2 above, in full. The routing table is the scaffold's entire value; it must come from
the project's own hub, not from directory names.

### 2. Fill from evidence only

| Section | Fill it from | Delete it when |
|---|---|---|
| Routing | The hub's routing table, re-phrased question-first | Never — a scaffold without it is pointless |
| Confidentiality tiers | A publishing allowlist, docs-site include list, `.docsignore`, `public:` frontmatter, or a gitignored doc path | Nothing publishes docs |
| Publishing side effect | The file and line that decides what ships | Same |
| Historical | A dated-snapshot directory — audits, ADRs, post-mortems | No such directory |
| Known drift | Contradictions you opened both sides of | The scan found none |

Never populate a section by inference. "There is an `internal/` directory so it is probably private"
is a guess, and a guess about confidentiality is the expensive kind.

### 3. Name it for the project

`<slug>-docs`, where the slug is what a person calls the project — `echat-docs`, `billing-docs`. Not
the repository directory name if that differs, and not `docs` alone: skill names share one namespace
per session, and a project-specific skill should look project-specific in the listing.

The `description` decides whether the skill ever fires. Write it to name the project and its actual
subject areas — "SAML SSO, pipeline queries, report slugs" — not the generic word *documentation*.

### 4. Verify before reporting

```bash
node "${CLAUDE_SKILL_DIR}/../knowledge-docs/scripts/check-doc-links.mjs" \
  .claude/skills/<slug>-docs/SKILL.md --root .
```

Exit 0, and every path named in the routing table exists on disk. A routing table that points at a
moved file sends the next reader somewhere worse than nowhere.

Then confirm the skill loads, and say plainly what you left out and why.

### 5. Keeping it true

A scaffold is a snapshot of the doc tree, and the doc tree moves. Re-run scaffold mode after docs are
added, moved or retired — regenerate rather than hand-patch, the same way the docs themselves are
maintained. Re-check the drift list whenever it is cited: drift gets fixed, and a stale drift list is
itself drift.

## Rules

- Never answer from a filename, a routing-table summary, or a sibling doc's description of a doc.
  Open the file.
- Never treat a dated document — an audit, a snapshot, a point-in-time review, a changelog — as a
  description of current behaviour. Cite it as history, or not at all.
- Never edit, reformat or "tidy" a doc while answering. Reading and writing are separate runs.
- Never repeat a secret, host address, SSH step or internal URL out of a doc into anything that
  leaves the repository — an artifact, a published page, a message to an external service.
- Hand off rather than duplicate: `knowledge-docs` writes and repairs docs, `project-turnover`
  produces handover packs. This skill only reads.
- Prefer the project's own skill if it has one. A repo-level docs skill knows its confidentiality
  tiers and its known drift; this skill only knows the method. Where a repo has a real docs tree and
  no such skill, offer to scaffold one — once, in a line, easy to decline.
- Never scaffold a skill whose routing table you have not verified against the files on disk.
- One cited, verified paragraph beats five paragraphs of confident recall.
