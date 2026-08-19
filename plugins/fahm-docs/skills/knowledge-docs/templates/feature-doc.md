<!--
  FALLBACK ONLY. Use this when the repo has no docs to learn conventions from.
  When it does have docs, copy their shape instead - see SKILL.md step 3.

  Delete every HTML comment before saving. Replace every {{PLACEHOLDER}}.

  Frontmatter: this template has none, because most plain repos have none. If
  the scan reported a docs-site generator (mkdocs, docusaurus, sphinx, ...) or
  frontmatterUse "all", add the keys that site requires at the top of the file.

  Section numbering: roughly half of repos number their H2s ("## 1. Files") and
  half do not. Numbered form is written below. Strip the numbers if the repo is
  unnumbered, and drop the Contents index with them.
-->

# {{TITLE}}

{{ONE_PARAGRAPH: what this is and what it does, in the present tense. A reader
who has never opened the code should finish this paragraph knowing whether the
doc is relevant to them.}}

{{SCOPE: what this doc deliberately does not cover, and where that lives
instead. Delete if the doc covers the whole feature.}}

---

<!-- Delete this index if the repo's docs don't use one, or if there are fewer than ~5 sections. -->
## Contents

1. [Files](#1-files)
2. [Entry points](#2-entry-points)

---

## 1. Files

<!-- The map a newcomer needs to find their way around. Paths must be real. -->

```
{{PATH}}    {{WHAT_IT_DOES}}
{{PATH}}    {{WHAT_IT_DOES}}
```

---

## 2. Entry points

{{HOW_EXECUTION_REACHES_THIS_CODE: the route, the command, the event, the block
type. A table works well when there is more than one way in.}}

---

## {{N}}. {{FEATURE_SPECIFIC_SECTION}}

<!--
  One section per idea that needs explaining, not one per file. Lead with the
  decision, then the reason for it. See references/house-style.md.
-->

{{BODY}}

---

<!-- Delete unless the feature has real anti-requirements worth writing down. -->
## {{N}}. What this deliberately does not do

- **{{THING_IT_DOES_NOT_DO}}.** {{WHY_NOT, and what would break if someone added it.}}

---

<!-- Delete unless you have real symptoms. Invented rows are worse than no table. -->
## {{N}}. Troubleshooting

| Symptom | Cause |
|---|---|
| {{WHAT_THE_READER_SEES}} | {{WHAT_IS_ACTUALLY_WRONG}} |

---

<!-- Delete if the repo's docs don't carry a testing section. -->
## {{N}}. Testing

1. {{STEP_SOMEONE_CAN_ACTUALLY_RUN}}
2. {{WHAT_THEY_SHOULD_SEE_IF_IT_WORKS}}

---

## See also

- {{RELATED_DOC_PATH}} — {{WHY_A_READER_WOULD_WANT_IT}}
