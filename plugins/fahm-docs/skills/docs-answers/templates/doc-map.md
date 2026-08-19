# {{PROJECT}} — full doc inventory

Every document under `{{DOCS_ROOT}}`, plus the indexes that sit outside it. Transcribed from
[{{HUB}}]({{HUB_REL}}); when the two disagree, the hub wins.

<!-- Keep the "Tier" column only if the project actually publishes some docs. -->

**Tier** — `published` is served to {{PUBLISHED_AUDIENCE}} by [{{PUBLISHER}}]({{PUBLISHER_REL}});
`internal` never leaves the repository.

## Indexes

| Document | Tier | What it is |
|---|---|---|
| {{PATH}} | {{TIER}} | {{ONE_LINE}} |

<!-- Then one section per directory, in the order the hub lists them. Reuse the hub's own column
     header — "Read it when" if it uses that, "What it is" if it does not. Reuse its one-liners
     verbatim rather than rewriting them; where the hub has none, write one from the document's own
     opening paragraph, never from its filename. -->

## `{{DIR}}` — {{DIR_PURPOSE}}

{{DIR_NOTE}}

| Document | Tier | Read it when |
|---|---|---|
| `{{FILENAME}}` | {{TIER}} | {{WHEN}} |

<!-- For a long, numbered document that gets cited section by section, add a section map so it can
     be cited precisely without opening it first: -->

### `{{LONG_DOC}}` section map

Cite as `§n` or `§n.n` alongside the line number.

| § | Section |
|---|---|
| {{N}} | {{SECTION_TITLE}} |

<!-- If the document records provenance per claim — verified, transcribed, told by a person,
     not executed — say so here. It is the difference between quoting it as fact and quoting it as
     someone's recollection. -->
