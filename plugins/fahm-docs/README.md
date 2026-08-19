# fahm-docs

Three documentation skills that work in any repository, in any language. They carry a **method**, not
a house style — each infers the conventions of whatever docs it finds rather than imposing the ones
in its own `templates/`.

| Skill | Invoked as | What it does |
|---|---|---|
| `docs-answers` | `/fahm-docs:docs-answers` | Answers "how does X work" from the docs a project already has. Routes to the one or two docs that own the question, cites file and line, verifies load-bearing claims against source, and reports doc-vs-code drift rather than resolving it silently. Also scaffolds a committed per-repo docs skill |
| `knowledge-docs` | `/fahm-docs:knowledge-docs` | Writes and repairs documentation — engineering feature docs or end-user KB articles. Scans first, reads the real source, verifies every link, and can publish a redacted guest-readable copy |
| `project-turnover` | `/fahm-docs:project-turnover` | Produces a handover pack: architecture map, ops runbook, credential inventory, risk register, open items, 30/60/90 onboarding path |

## The three are a set

`docs-answers` invokes `knowledge-docs/scripts/scan-docs.mjs` and `check-doc-links.mjs` by relative
path, and both `docs-answers` and any repo-scoped docs skill hand off to `knowledge-docs` for repair.
**Installing one without the others produces a skill that fails at its verification step.** They ship
in one plugin for that reason.

## Requirements

Node, for the bundled scanners. Without it the skills still work; only their automated verification
does not, and each says so rather than reporting a check that did not run.

## Relationship to repo-scoped skills

A repo may carry its own `.claude/skills/<name>-docs/` — a routing table for that specific project,
with its doc map, confidentiality tiers and known drift. Those stay committed in their own
repositories. `docs-answers` is the portable method behind them, and its scaffold mode generates one.

Where both are present, the repo-scoped skill should win for questions about that repo. That is the
two-tier arrangement these skills are designed for, not a conflict.

## Paths

Every bundled script is reached through `${CLAUDE_SKILL_DIR}`, and cross-skill references use
`${CLAUDE_SKILL_DIR}/../<sibling>`. Both resolve whether the skill is installed as part of this
plugin or copied into a home directory, so the skills stay portable in either direction.
