---
name: {{SLUG}}-docs
description: Route any question about {{PROJECT}} to the documentation that already answers it — {{TOPICS}}. Carries the doc map, which sections are internal versus published, which documents are historical snapshots, and the places where the docs and the code are known to disagree. Use for any "how does {{PROJECT}} work", "where is this configured", "what does the runbook say", "how do I {{COMMON_OPS_TASK}}", "who owns this", or "is this documented" question in this repository, and before writing new documentation into {{DOCS_ROOT}}.
---

# {{PROJECT}} docs

Answers questions about this system from `{{DOCS_ROOT}}`, which is where the answers were written
down.

Method comes from the `docs-answers` skill — route, cite, verify the load-bearing claims against
source, report drift without fixing it. This file carries what is specific to this repository: the
map, the confidentiality tiers, and the drift already known.

## Routing

Start at [{{HUB}}]({{HUB_REL}}) — it is the hub and it is short. This table is the same routing,
question-first.

| The question is about | Read |
|---|---|
| {{INTENT}} | `{{DOC_PATH}}` |

<!-- One row per document a question would actually land on. Intent phrased as the user would say
     it, not as the doc titles itself. Omit documents nobody would route to. -->

Full per-file inventory: [references/doc-map.md](references/doc-map.md). Load it only when the table
above does not resolve the question.

<!-- If any document is numbered and self-referencing, record its citation idiom here, e.g.:
     `RUNBOOK.md` is numbered — cite it as §8.3, the convention the document itself uses,
     alongside the line number. -->

## Confidentiality tiers

| Directory | Tier |
|---|---|
| {{PUBLISHED_DIRS}} | Published — {{PUBLISHED_AUDIENCE}} |
| {{INTERNAL_DIRS}} | Internal — never leaves the repository |

<!-- Fill from evidence, not assumption: an in-app docs route with an allowlist, a docs-site config's
     include list, a `public: false` frontmatter convention, `.docsignore`, or a gitignored path.
     If the project has no publishing mechanism at all, delete this whole section rather than
     inventing tiers. -->

The internal tier carries {{INTERNAL_CONTENT}}. Its content does not go into an artifact, a published
doc, a commit message, or a message to any external service. Quote it into the conversation, and
nowhere else.

<!-- Note any gitignored-but-present doc here: it exists on one machine only. -->

## Publishing is a side effect of file placement

<!-- Only if the project publishes docs. Name the file and line that decides it. -->

[{{PUBLISHER}}]({{PUBLISHER_REL}}) serves an allowlist, not a directory walk — {{ALLOWLIST_SYMBOL}}
at line {{ALLOWLIST_LINE}}.

**Adding a `.md` to {{PUBLISHED_DIRS}} publishes it.** Before writing a new doc, decide the tier
first and the filename second.

## {{HISTORICAL_DIR}} is history

<!-- Only if the project keeps dated snapshots — audits, ADRs, post-mortems, release notes. -->

`{{HISTORICAL_DIR}}` holds dated snapshots of the codebase as it stood on their dates. Cite them for
what changed and when. Never cite one as a description of current behaviour.

## Known drift

Recorded so it is not rediscovered each session. In each case the code is authoritative — say both,
and offer `knowledge-docs` to repair the doc rather than fixing it mid-answer.

- [{{DOC}}]({{DOC_REL}}), line {{N}}, says {{CLAIM}}. The code {{REALITY}} at
  [{{SOURCE}}]({{SOURCE_REL}}).

<!-- Only entries verified by opening both sides. An unverified suspicion is worse than an empty
     section — delete the section if the scan found nothing. Re-check these when they are cited;
     drift gets fixed, and a stale drift list is itself drift. -->

## Rules

- Route first. The hub and this table exist so a question is a lookup, not a sweep of `{{DOCS_ROOT}}`.
- Verify against source anything that would break if a digit were wrong: {{FRAGILE_IDENTIFIERS}}.
  Narrative and rationale come from the doc.
- Never present a dated snapshot as current state.
- Never carry internal-tier content out of the repository.
- Never add a file to a published directory without stating that it will be published.
- Do not edit docs while answering. Repair is a `knowledge-docs` run; a new handover pack is a
  `project-turnover` run.

<!-- Add project-specific rules below only where a wrong answer has a real cost here that it would
     not have elsewhere. Resist padding: every rule the model must weigh dilutes the others. -->
