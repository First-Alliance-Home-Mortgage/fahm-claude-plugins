---
name: knowledge-docs
description: Scan a project's documentation, then write or update it — an engineering feature doc explaining how part of a codebase works, or an end-user knowledge base article. Reports what docs exist, what's missing and what's gone stale before writing; reads the real source; matches the conventions of whatever docs the repo already has; verifies every link; and can publish a redacted, guest-readable copy with a proposed public route and footer link. Use when the user asks to document a feature, write or update docs, audit the docs, explain how something works in a doc, write a KB or help article, fix stale docs, or make documentation publicly accessible.
license: LicenseRef-FAHM-Proprietary
metadata:
  owner: First Alliance Home Mortgage
  source: fahm-claude-plugins/plugins/fahm-docs
  last-reviewed: 2026-08-19
---

# Knowledge docs

Writes documentation that matches the repo it lands in, describes code that was actually read, and links to things that actually exist.

This skill carries a method, not a house style. It works in any repo, in any language, whatever its doc conventions — so it **infers** those conventions rather than imposing the ones in `templates/`. Those templates are a fallback for a repo with no docs to learn from, and nothing more.

## Modes

Resolve **after** the scan; the scan usually answers it.

1. From the user's words. "document how X works", "write docs for X", "explain the X flow" → **feature**. "help article", "KB article", "write this for users", "how-to" → **article**.
2. From the destination, if one was named. A path inside an end-user content tree implies **article**.
3. Otherwise ask. The two produce very different prose; do not guess.

Two more paths fall out of the scan at no extra cost: **audit** ("review our docs", "what's out of date?") stops after step 2 without writing anything, and **publish** can run on its own against docs that already exist.

## Steps

The scripts below need Node. If Node is unavailable, say so and do the equivalent work by reading — never report a check that did not run.

### 1. Scan the project. Always, before anything else

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scan-docs.mjs" --root <repo-root>
```

Returns JSON: the stack, every doc-home candidate with its frontmatter policy and docs-site generator, a full inventory of existing docs, gaps, stale docs, and a broken-link baseline.

Read it rather than skimming it. Four fields decide most of what follows:

- `docHomes[].generator` — a non-null value means the destination is a docs **site**, and its conventions are mandatory, not stylistic.
- `docHomes[].frontmatterUse` — `all` means a doc without frontmatter will break the build. `none` means adding it would be noise.
- `stale` — docs older than the sources they link to. Often the real answer to "our docs are out of date".
- `brokenLinks` — the baseline. Pre-existing rot is never reported later as damage this run caused.

`--stale-only` narrows the report when the user asked specifically what's out of date.

### 2. Report, and agree the target

Summarise in a few lines: what exists, what's missing, what looks stale. Then propose what to write or update, ranked, one line each.

**Confirm before writing a file.** If the user already named a doc, this is a one-line confirmation, not an interview — don't turn a clear request into a questionnaire.

### 3. Learn the local conventions

*The step that makes this skill portable. Never skip it, including in a repo that feels familiar.*

Read 2–3 existing docs nearest the target and extract:

- frontmatter — present or absent, and which keys
- title idiom — scoped (`# Area — Thing (Identifier)`) or a bare noun phrase
- headings — numbered or not, sentence or title case, and whether an anchor index (`## Contents`, `## Table of Contents`) is expected
- closing sections actually in use (`## Testing`, `## Related`, `## See also`, `## References`)
- link style into source, code-fence language tags, tables vs prose, ASCII vs Mermaid, horizontal rules
- file naming — kebab-case, snake_case, SCREAMING-CASE, area prefixes, numeric ordering prefixes

Match what is there, **including conventions you would not have chosen**. Use `templates/` only when there is genuinely nothing to learn from.

State in one line which doc you used as the model, so a wrong pick is caught before it costs anything.

### 4. Read the real source

Non-negotiable.

Open every file the doc will describe. Copy code blocks from source rather than retyping them from memory. Confirm every path you name exists. Trace every behavioural claim to a line you actually read.

Where the source and an existing doc disagree, **the source wins** — and say so in your report rather than quietly resolving it.

### 5. Write

Fill the skeleton you inferred in step 3, or the template if there was nothing to infer. Load [references/house-style.md](references/house-style.md) at this point, not before.

Delete sections with no real content; an empty `## Troubleshooting` is noise.

When updating an existing doc: change only what the source affects, leave untouched prose alone, and keep any anchor index in sync with headings you renamed.

### 6. Verify

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-doc-links.mjs" <path> --root <repo-root>
```

Exits 1 with a JSON list of every unresolvable link and anchor. Fix everything it reports **in the doc you just wrote**. Report pre-existing breakage against the step-1 baseline, but do not fix it uninvited.

### 7. Offer to publish

One line, easy to decline: the doc is finished either way. On yes, go to step 8.

### 8. Publish, if asked

```bash
node "${CLAUDE_SKILL_DIR}/scripts/publish-docs.mjs" <path|--all> --root <repo-root>
```

Three things happen in order, and the first can stop the other two.

**Redact.** Secrets abort the run — exit code 2, nothing written. Do not relabel a hit as a false positive on the user's behalf; report it and let them decide. Internal hosts, tunnel URLs, private IPs and admin links are stripped from the *published copy only*; the source doc is never modified. `.docsignore` and `public: false` frontmatter are honoured.

**Export.** Redacted copies are written to `docs/public/` by default (`--out` to change). Deterministic and idempotent — republishing without a source change rewrites identical bytes.

**Propose.** The script reports where a public route, an auth exemption and a footer link would go, as a diff-shaped list. It does **not** apply any of it.

Relay `proposalText` to the user as-is. The security-relevant entry is separated deliberately — present it that way, and state its consequence in plain words: *this makes `/help/*` readable by anyone on the internet.*

Use `--dry-run` to preview an export, `--propose-only` for the wiring alone.

### 9. Report

The path written, the doc you used as the style model, the source files you read, the link results, and — if published — what was redacted, where the export went, and the wiring still pending.

## Rules

- Never write a file before the scan and the target confirmation.
- Never document behaviour you did not read in source. Not from a filename, not from a commit message, not from a sibling doc.
- Never impose a convention the repo does not use — no frontmatter where there is none, no numbered sections where headings are bare, no Mermaid where every diagram is ASCII.
- **Never edit auth middleware, route guards, or navigation components.** Propose the diff and stop. This holds even when asked to "just do it": say what to paste instead. A wrong automated edit here exposes an entire application.
- Never publish without showing what will be exposed. A secrets hit is a hard stop, not a warning.
- Do not restructure or reformat an existing doc while updating it.
- Do not write a changelog. Docs describe current behaviour; version history lives elsewhere.
- Do not commit. Leave the changes in the working tree.
- One accurate section beats five speculative ones.
