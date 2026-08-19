# FAHM Claude Code plugins

A private Claude Code **plugin marketplace** for First Alliance Home Mortgage.

| Plugin | Skills | What it is for |
|---|---|---|
| [`fahm-docs`](plugins/fahm-docs/) | `docs-answers`, `knowledge-docs`, `project-turnover` | Portable documentation tooling. Useful in every repo |
| [`fahm-encompass`](plugins/fahm-encompass/) | `encompass-api` | The ICE Encompass Developer Connect reference. Useful in the four repos that touch Encompass |

Two plugins rather than one, deliberately: `version` is the update gate, and Encompass facts change
whenever ICE changes an endpoint while the docs tooling changes almost never. Splitting also lets a
repo enable only what it needs — a disabled plugin costs nothing in the skill listing.

## Install

```
/plugin marketplace add First-Alliance-Home-Mortgage/fahm-claude-plugins
/plugin install fahm-docs@fahm-claude-plugins
/plugin install fahm-encompass@fahm-claude-plugins
```

> **Add the marketplace by `owner/repo` or git URL — never by a raw-file URL.** The plugin sources
> here are relative paths, and a raw fetch downloads only `marketplace.json`, so nothing resolves.

A private repo works over your existing git credentials. A teammate whose credentials do not reach
the `First-Alliance-Home-Mortgage` org gets a **clone failure, not a permissions prompt** — an
unhelpful error to debug, so check org membership first.

### Zero-touch enrolment for a project

Commit this into a consuming repo's `.claude/settings.json` and the marketplace is added
automatically once the teammate trusts the folder — no separate prompt, no install step:

```json
{
  "extraKnownMarketplaces": {
    "fahm-claude-plugins": {
      "source": { "source": "github", "repo": "First-Alliance-Home-Mortgage/fahm-claude-plugins" }
    }
  },
  "enabledPlugins": {
    "fahm-docs@fahm-claude-plugins": true,
    "fahm-encompass@fahm-claude-plugins": true
  }
}
```

Enable `fahm-encompass` only in repos that actually touch Encompass. Marketplace state itself lives
once per user in `~/.claude/plugins/known_marketplaces.json`, not per project.

## Published

The marketplace lives at `First-Alliance-Home-Mortgage/fahm-claude-plugins` and `main` is pushed.
Teammates install with the three commands under [Install](#install) above.

Still unverified: nobody has added this marketplace from a **second machine**. A fresh clone is the
only real test of the relative plugin sources in `marketplace.json`, since they resolve against the
clone rather than against this working copy.

> Keeping `plugins/` **inside** this repository is deliberate, not just tidy. For the claude.ai
> Team/Enterprise plugin-sync path, private plugin sources must share the marketplace repo's owner —
> so private plugins have to live here and be referenced by relative path, not as separate repos.

## Validate before committing

```bash
node scripts/validate-repo.mjs
```

Offline, zero dependencies, no network. Checks manifest structure, the `.claude-plugin/` layout rule,
frontmatter portability, description budget, forbidden path forms, relative-link resolution, and runs
a secret scan. It is the same check the GitHub Actions workflow runs.

Then, with the Claude Code CLI:

```
claude plugin validate .
claude plugin validate ./plugins/fahm-docs
claude plugin validate ./plugins/fahm-encompass
claude --plugin-dir ./plugins/fahm-encompass
```

`claude plugin validate` checks the **manifest only** — it does not read SKILL.md files. Everything
in rules 1–5 of CONTRIBUTING.md is enforced by `scripts/validate-repo.mjs`, so run that first.
(Some documentation mentions a `--strict` flag; it is not present in the installed CLI.)

> `/reload-plugins` counts only `commands/` directories in its summary, so it reports **0 skills**
> for both plugins here. That is a known reporting defect, not a failure — confirm from the skill
> listing instead.

## Migrating from user-level skills

The three `fahm-docs` skills previously lived in `~/.claude/skills/`. **Do not run both copies.** A
personal skill and a plugin skill of the same name can both load in one session — two near-identical
descriptions in the listing, double budget cost, and unpredictable selection when the model fires by
description rather than by slash command.

Retire the originals before installing the plugin, and rename rather than delete so rollback is one
command:

```powershell
Rename-Item "$env:USERPROFILE\.claude\skills" "skills.premigration"
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before adding a skill. Two rules there are not preferences:
the **portable-frontmatter** rule (anything outside the six-key subset is a hard error on a
claude.ai/Skills API upload) and the **description budget** (the skill listing has a bounded context
allowance, and on overflow Claude Code silently drops descriptions — a dropped description means the
skill stops firing, with no error).

---

*Proprietary — First Alliance Home Mortgage. All rights reserved.*
