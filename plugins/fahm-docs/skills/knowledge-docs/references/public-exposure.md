# Public exposure recipes

Load this at step 8, when the user has asked to publish and `publish-docs.mjs` has produced a proposal.

The script detects the framework and prints the files. This file explains *what to actually put in them*, per framework, so the proposal you relay is specific enough to act on.

## The rule that outranks everything here

**You propose. You do not apply.**

Every recipe below ends at a suggested edit. Do not make it — not to middleware, not to a route guard, not to a navigation component. Print it and let the user apply it. This holds even when the user says "just do it": reply with what to paste.

The reason is narrow and worth stating plainly. A route file added in the wrong place fails loudly — the page 404s and someone notices. An auth exemption written slightly too broadly fails **silently**: the app keeps working, nothing errors, and a section that was meant to stay private is readable by anyone who guesses the URL. Nobody finds out until it matters. That asymmetry is why this one edit stays with a human.

## What to show the user

Three things, in this order:

1. The route files to create — cheap, reversible, uninteresting.
2. **The auth exemption, on its own**, with its consequence in plain words: *this makes `/help/*` readable by anyone on the internet.*
3. The nav or footer link.

Never fold the auth line into a list of six other edits. It's the one that carries risk, and it should read that way.

If the script reported `action: "locate"` for the security entry, no conventional middleware was found. Say that explicitly rather than implying no auth change is needed — an unfound chokepoint is not an absent one. Point at the candidates it listed and ask the user which enforces auth.

## Scope the exemption as narrowly as the framework allows

The common mistake is a matcher that exempts more than intended. `/help` should not imply `/helpdesk`, and a prefix match on `/help` will match both. Prefer an exact path plus an explicit subtree (`/help` and `/help/:slug`) over a bare prefix, and check whether the framework's matcher is prefix-based or exact by default.

## Next.js — app router

Routes: `src/app/help/page.tsx` (index), `src/app/help/[slug]/page.tsx` (article).

Auth is usually in `middleware.ts` or `src/middleware.ts`. Two shapes are common:

- A `config.matcher` array listing protected paths — the exemption is a **negative lookahead** added to the existing pattern, which is easy to get subtly wrong. Have the user check it against `/helpdesk`-style neighbours.
- An explicit public-paths allowlist checked inside the middleware body — safer, and the exemption is one array entry.

If there is no middleware, auth may be enforced per-layout (a `layout.tsx` that redirects) or inside a provider. `/help` must then live **outside** that layout's segment, or it inherits the redirect. This is the most common way a "public" route silently stays private.

## Next.js — pages router

Routes: `pages/help/index.tsx`, `pages/help/[slug].tsx`. Auth is typically in `getServerSideProps` per page, or in `_app.tsx`. If it's in `_app.tsx`, the exemption is a path check there.

## Remix

Routes: `app/routes/help._index.tsx`, `app/routes/help.$slug.tsx`. Auth lives in each route's `loader`. There is usually no global chokepoint, so a public route is simply one whose loader doesn't call the auth helper — verify no parent layout route (`app/routes/help.tsx` or the root loader) enforces it.

## SvelteKit

Routes: `src/routes/help/+page.svelte`, `src/routes/help/[slug]/+page.svelte`. Auth is in `src/hooks.server.ts` (`handle`). The exemption is a path check there. Watch for a `+layout.server.ts` higher in the tree that also redirects.

## Nuxt

Routes: `pages/help/index.vue`, `pages/help/[slug].vue`. Auth is route middleware, either global (`middleware/*.global.ts`) or named. For a global one, the exemption is a path check inside it; a page can also opt out with `definePageMeta`.

## Astro

Routes: `src/pages/help/index.astro`, `src/pages/help/[slug].astro`. Auth is in `src/middleware.ts`. Static output may make the pages public regardless of middleware — confirm which output mode the site uses before assuming the middleware runs at all.

## Django

Add URL patterns in `urls.py` and a view. Auth is `@login_required`, `LoginRequiredMixin`, or a global middleware. A global `LoginRequiredMiddleware` needs an exempt-paths setting; per-view decorators need nothing beyond omitting them.

## Rails

Add routes in `config/routes.rb` and a controller. Auth is typically a `before_action :authenticate_user!` in `ApplicationController`; the exemption is `skip_before_action` in the new controller. Scope it to that controller — do not weaken `ApplicationController`.

## Laravel

Add routes in `routes/web.php`, outside the `auth` middleware group. Do not remove the middleware from an existing group to achieve this.

## Unknown framework

Report what the script found — the framework it guessed, the auth candidates, the nav candidates — and ask. Do not guess a routing convention. A wrong guess here produces a confident, plausible, wrong proposal, which is worse than admitting the tool didn't recognise the stack.

## Before the user applies any of it

Worth stating alongside the proposal:

- Confirm the exported docs are the redacted copies, not the source docs. The route should read from the export directory.
- The export is regenerated. If it's gitignored (recommended), the deploy needs to run the publish step, or the route needs to read from the source docs and redact at request time.
- Anything served publicly is fetched, cached and indexed by things you don't control. Removing a doc later does not un-publish what was already crawled.
