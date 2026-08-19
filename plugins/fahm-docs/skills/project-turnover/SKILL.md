---
name: project-turnover
description: Produce project turnover and handover documentation for any repository - a system overview and architecture map, an ops runbook, a credential and access inventory, a health and risk register, open items, and a 30/60/90 onboarding path for the incoming owner. Scans the project first for its stack, entry points, deployment paths, scheduled jobs, environment variables, secret surface, CI gates, documentation drift and contributor concentration, then asks the user only what the repository cannot answer - vendor accounts, contacts, licences, and the reasoning behind past decisions. Use when the user is handing a project over, offboarding, onboarding a new owner or maintainer, leaving a team or a client, asking who owns what or what the bus factor is, writing a runbook or operations guide, doing a knowledge transfer, documenting how to deploy and support a system, or asking what someone taking over this codebase would need to know.
license: LicenseRef-FAHM-Proprietary
metadata:
  owner: First Alliance Home Mortgage
  source: fahm-claude-plugins/plugins/fahm-docs
  last-reviewed: 2026-08-19
---

# Project turnover

Hands a system to its next owner: what it is, how it runs, what will break, and what nobody wrote down.

This skill carries a method, not a house style. It works in any repository, in any language, whatever its documentation conventions - so it **infers** those conventions rather than imposing the ones in `templates/`. Those templates are a fallback for a project with nothing to learn from, and nothing more.

The scan is read-only. It never runs the tests, the deploy, or the backup, because a handover scan has to be safe to point at a system nobody understands yet.

## Modes

Resolve **after** the scan; the scan usually answers it.

1. **full** (default) - the whole pack. "handing over", "taking over", "offboarding", "knowledge transfer", "what would someone need to know".
2. **runbook** - operations only, from `templates/runbook.md`. "write a runbook", "how do we operate this", "what do I do at 2am".
3. **risk** - stops after step 2 and writes nothing. "what's the bus factor", "what are the risks", "what happens if X leaves".
4. **refresh** - a turnover pack already exists. Re-scan, diff, update only what changed.

If `stack.monorepo.deployables` has more than one entry, ask which unit before writing. One pack per deployable, and each pack lists its siblings.

## Steps

The scripts below need Node. If Node is unavailable, say so and do the equivalent work by reading - never report a check that did not run.

### 1. Scan the project. Always, before anything else

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scan-project.mjs" --root <repo-root>
```

Returns JSON. Read it rather than skimming it. Five keys decide most of what follows:

- `deploy.paths` and `deploy.divergence` - how many ways this reaches production, and whether they disagree.
- `schedules[].boundToHost` - a job that dies with one machine.
- `secretSurface` - what has to be transferred, and what has to be rotated instead.
- `health.findings` at severity `critical` or `high` - the register, pre-scored.
- `unknowns` - what the repository provably cannot answer. This is the interview.

`limits.truncated` means the walk hit its cap and the report is **partial**. Say so in the document rather than letting it read as complete. `--section <keys>` narrows the output; `--max-files` raises the cap.

**What the scan cannot know, and you must not invent:** which deploy path is live; who to call; account ownership, cost, licences and renewal dates; why a decision was made; whether a risk is deliberately accepted; where secret *values* live; DNS, TLS, firewalls, whether backups actually run, where alerts go; whether the tests currently pass; undocumented manual procedures; who has production access today.

### 2. Read the divergences before anything else

Four things, in this order. They are what a turnover exists to surface:

1. **`deploy.divergence`** - more than one path, pointing at different targets. Nobody can tell which is live, and deploying by the wrong one is either a no-op or an outage.
2. **`schedules[].boundToHost`** - a scheduled job tied to an absolute personal path, an interactive logon, or one user profile. It stops the day that machine is reimaged, silently.
3. **`secretSurface.filesOnDisk`** - `tracked: true` means rotate, not transfer. `tracked: false` means it exists on one machine and nothing in the repository will remind anyone it is there.
4. **`gates.gatesMissingFromDeploy`** - production reachable without a test, by someone still learning the codebase.

In **risk** mode, report these and stop. Write nothing.

### 3. Learn the destination and its conventions

*The step that makes this skill portable. Never skip it, including in a repository that feels familiar.*

Read 2-3 existing documents nearest the target and extract: frontmatter (present or absent, which keys); title idiom; heading style, numbering, and whether an anchor index is expected; table vs prose; ASCII vs Mermaid; link style into source; file naming. Match what is there, **including conventions you would not have chosen**. Use `templates/` only when there is genuinely nothing to learn from. State in one line which document you used as the model.

**Then choose the destination.** Default is a `turnover-documentations/` directory at the repository root:

```
turnover-documentations/
├── README.md      index: what is here, when it was produced, when to re-verify
├── TURNOVER.md    the pack
└── RUNBOOK.md     runbook mode, or when the pack is long enough to split
```

Check `docs.docConsumers` first. If a source file reads a documentation directory at runtime, a file added there **changes application behaviour** - read that file, learn its rule, and say what would happen. This is why the default is a separate directory: a pack that inventories where credentials live is the wrong thing to publish into an application's knowledge base.

If `turnover-documentations/` already exists, switch to **refresh** mode. Do not overwrite a pack a human has edited.

Confirm the path before writing. Then ask, once, whether to gitignore it: committing the pack means it survives a lost laptop, but puts a credential *map* in the repository. Recommend committing - section 9 holds locations and transfer methods, never values - but let the owner decide.

### 4. Read the real source for anything you assert

Non-negotiable.

Open every deployment path end to end. Open the script behind every scheduled job. Confirm every path you name exists. Copy commands from the source rather than retyping them from memory.

Where a runbook and a workflow disagree, **report the disagreement**. Do not resolve it. Where the scan and a document disagree, the scan describes what is in the tree today and usually wins - but say which you trusted.

### 5. Interview - targeted, and seeded by the scan

Load [references/interview.md](references/interview.md) at this point, not before.

First answer every `unknowns` entry you can by reading. Most survive; some do not, and the ones that do not should never be asked. Then at most **3 rounds, 4 questions each, 11 questions total**, blockers first. Every option is a literal string from the scan, so the user confirms rather than composes. Everything still unanswered becomes the "Known unknowns" section with a named person to ask - an honest gap hands the new owner a to-do list, and a twelfth question does not.

### 6. Write the pack

Fill the skeleton you inferred in step 3, or `templates/turnover.md` if there was nothing to infer. Load [references/risk-rubric.md](references/risk-rubric.md) now for the register.

Three rules of voice, specific to this document:

- **State the fact, then its consequence for the handover.** "The weekly smoke job is registered on one workstation" is an observation. "…so it stops the day that machine is reimaged, with no alert" is a handover document.
- **Attribute everything a human told you** - `per <name>, <date>`. A reader must be able to tell what was measured from what was said.
- **Write "unknown - ask <name>" rather than a plausible sentence.** A visible gap is useful. A confident invention is worse than nothing, because it will be believed.

Delete sections with no real content. An empty "Common failures" is noise.

### 7. Verify

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scan-project.mjs" --verify turnover-documentations/TURNOVER.md --root <repo-root>
```

- **Exit 2** - a secret in the document. Hard stop. Remove it before anything else; nothing else matters until it is gone.
- **Exit 3** - coverage gaps: missing sections, uncovered facts, dead links, unreplaced placeholders. Fix each, or consciously justify it. `uncoveredFacts` is a gap to *justify*, not an automatic failure - you may omit something deliberately, but not accidentally.
- **Exit 0** - the mechanical checks pass. Now load [references/verification.md](references/verification.md) for the judgement checks a script cannot make.

### 8. Report

The path written. Which document you used as the style model. The source files you read. What you were **told** versus what was **detected**. The risks left unmitigated. The questions still open, and who to ask. The date this needs re-verifying.

## Rules

- Never write the pack before the scan and the first interview round.
- **Never put a secret value in the document.** Names, locations and transfer methods only. A handover doc containing a key is a doc that has to be shredded.
- Never resolve a deployment ambiguity by guessing. Two paths stay two paths until a human says which is live.
- Never state a contact, account owner, licence, cost or SLA the user did not give you.
- Never mark a risk "accepted" on the user's behalf. Only the owner accepts a risk.
- Never run the deploy, the tests, the backup, or any command the runbook documents. Document them; do not execute them.
- Never present a file's modification time as authorship when git history is absent.
- **Never publish a turnover pack.** It is internal by construction - do not route it through any documentation-publishing flow, and never write it into a directory the application reads at runtime.
- Never overwrite an existing `turnover-documentations/` pack. Refresh it.
- Do not copy `.env*` files, key files, or backups anywhere.
- Do not restructure the project's existing documentation. The pack is additive.
- Do not commit, unless asked.
- A visible gap beats a confident invention.
