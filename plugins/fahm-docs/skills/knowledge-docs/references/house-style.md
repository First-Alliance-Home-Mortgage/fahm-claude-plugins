# House style

Load this at the writing step, not before.

These are qualities of good technical prose, not layout rules. That distinction matters: **layout is inferred from the repo, voice is not.** A repo can tell you whether it numbers its headings; it cannot tell you to explain your reasoning. So the rules here apply everywhere, while step 3 of the skill stays adaptive.

## Rationale first

State the decision, then why it was made.

A doc that only restates the code is worth less than the code, because it can go stale and the code cannot. The value a doc adds is the part that isn't in the source: why this approach, what was rejected, what breaks if you change it.

> **Search is never cached.** Results depend on a query the user just typed, and a stale result set is worse than an honest "search needs a connection."

The first sentence is a fact you could read off the source. The second is the reason it's that way, and it's the sentence that stops someone "fixing" it next quarter.

## Name the alternative that was rejected

When something looks odd, say what the obvious approach was and why it wasn't taken. This is the single highest-value thing a feature doc contains — it's what stops the next person re-litigating a settled decision, or worse, silently reversing it.

## Bold the claim

Open a paragraph with the claim in bold, then justify it. It lets a reader skim the bold sentences and still come away with the argument.

Where the reasoning *is* the section, put it in the heading: `## Why a service account and not client credentials` tells a reader what they'll learn.

## Tables for facts, prose for reasons

Tables suit anything enumerable — symptoms and causes, options and defaults, props and types. The moment a cell wants a "because", it belongs in prose.

## Snippets prove a point

The shortest excerpt that demonstrates the thing, usually 5–15 lines, always with a language tag on the fence. Copy from the source; don't retype it. A snippet that has drifted from the code is worse than no snippet, because it's quoted with authority.

## Diagrams

ASCII by default — it renders everywhere, diffs cleanly, and survives being pasted into a terminal. Use Mermaid only where the repo already uses it.

## Anti-patterns

- **Marketing voice.** "Powerful", "seamless", "robust". Say what it does.
- **"Simply" and "just".** If it were simple the reader wouldn't be here, and the word only tells them they're slow.
- **Restating code in English.** "The `getUser` function gets the user." Cut it.
- **Speculation stated as fact.** If you didn't read it, don't write it. Say "unverified" or leave it out.
- **TODOs and open questions.** A doc is not an issue tracker.
- **Author names and dates in the body.** Git already knows. They're wrong within a month.
- **Invented paths.** Every path in a doc is a promise that it exists.
- **Empty sections kept for symmetry.** Delete the heading.

## Length

Long enough to explain the reasoning; no longer. A reader who wants the full picture reads the source — the doc's job is to make the source legible, not to replace it.

When a section starts explaining a second thing, it's two sections.
