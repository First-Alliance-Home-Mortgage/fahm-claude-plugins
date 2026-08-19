<!--
  FALLBACK ONLY. Use this when there are no neighbouring articles to copy.
  When there are, match their frontmatter keys and structure instead.

  Delete every HTML comment before saving. Replace every {{PLACEHOLDER}}.

  FRONTMATTER: use the keys the destination system already uses. Read a
  neighbouring article, or the content model (a CMS schema, a type definition, a
  static-site config) and match it exactly. Do not invent keys the destination
  will silently ignore. The block below is a starting point, not a standard.

  `public` is read by publish-docs.mjs: `public: false` keeps the article out of
  any published export. Keep it on anything not meant for a guest audience.

  MARKDOWN SUBSET: help systems commonly render through a restricted renderer.
  Stay inside headings, bold/italic, inline and fenced code, nested lists,
  blockquotes, horizontal rules, links, standalone images, and GFM pipe tables.
  No raw HTML. Narrow further if you can identify the actual renderer.

  VOICE: second person, present tense. Write for someone who is stuck right now.
  No repository paths. No class, function or variable names. No internal jargon,
  team names or ticket numbers. Do not reference screenshots that do not exist.
-->

---
title: {{TITLE_AS_THE_USER_WOULD_SEARCH_FOR_IT}}
slug: {{kebab-case-slug}}
summary: {{ONE_SENTENCE_SHOWN_IN_SEARCH_RESULTS}}
category: {{CATEGORY}}
tags: [{{TAG}}, {{TAG}}]
public: true
---

# {{TITLE}}

{{ONE_SENTENCE_ANSWER. If the reader stops here, they should already be
unblocked. Put the answer first and the explanation after it.}}

<!-- Delete this section if there are no prerequisites. -->
## Before you start

- {{WHAT_THEY_NEED: an account, a permission, a piece of information.}}

## {{HOW_TO_DO_THE_THING}}

1. {{IMPERATIVE_STEP: "Open Settings." Name what they click, in the words the
   interface uses.}}
2. {{NEXT_STEP}}
3. {{WHAT_CONFIRMS_IT_WORKED}}

<!-- Delete unless you know real failure modes. Guessed ones erode trust fast. -->
## If it doesn't work

- **{{WHAT_THEY_SEE}}** — {{WHAT_TO_DO_ABOUT_IT}}

<!-- Delete if there is nothing genuinely related. -->
## Related

- {{LINK_TO_A_NEARBY_ARTICLE}}
