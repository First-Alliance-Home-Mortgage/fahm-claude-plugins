# Interview

Loaded at step 5, after the scan. Not before - a visible list of forty questions gets asked, and most of these have already been deleted by the time you read this.

## The shape

**Round 0 is silent.** The scan emits `unknowns[]`. Go through it and answer everything you can by reading: opening a deployment runbook, a registration script or a workflow file typically kills several outright. Anything you can read is never asked.

Then, of the survivors:

| Round | Ask about | Cap |
|---|---|---|
| 1 | Blockers - gaps where a wrong guess makes the document dangerous | 4 |
| 2 | People and commercial - who owns, who pays, who is called | 4 |
| 3 | Only if rounds 1-2 opened something new | 3 |

**Hard ceiling: 3 rounds, 11 questions.** Whatever is still unanswered goes into "Known unknowns" with a named person to ask. That section is a feature - it hands the incoming owner a to-do list, which a twelfth question does not.

## Phrasing rules

- **Never ask open where the scan can propose options.** Every option should be a literal string lifted from the scan, so the user is confirming rather than composing. "GitHub Actions → Azure Web App `fahm-echat`" is answerable in one click; "how do you deploy?" is an essay.
- **Always include an escape** - "I don't know", "no longer used", "nobody". Unknown is itself a finding worth recording, and forcing a guess corrupts the document.
- **One thing per question.** "Who owns the account and what does it cost?" gets half an answer.
- **Never ask what the repository already answers.** It reads as not having looked.
- **Batch the vendors.** One multi-select over every detected service beats six separate questions and is the single biggest saving available.

## Round 1 - blockers

Only ask these when the scan actually found the trigger.

**Deploy divergence** — trigger: `deploy.divergence` is non-empty.
> Which of these deployment paths is live?
> Options: one per detected path, verbatim, plus "Both are live" · "One is legacy - I'll say which" · "I don't know"

Nothing else in the document can be trusted while this is open: the runbook, the rollback and the access list all depend on the answer.

**Credential transfer** — trigger: `secretSurface.filesOnDisk` is non-empty.
> How will `<files>` reach the incoming owner?
> Options: Shared password manager · Secret manager / vault · Re-issue new credentials instead · Already shared · I don't know

Ask once for the whole set, not per file. If any file has `tracked: true`, the question is different and more urgent: it is already in everyone's clone, so the answer is rotation, not transfer.

**Host-bound job** — trigger: any `schedules[].boundToHost`.
> What should happen to `<task name>` after handover?
> Options: Move it to a server · Move it into CI · Re-register on the new owner's machine · Retire it · I don't know

**Backup reality** — trigger: `datastores` is non-empty and not `conflict`.
> Has a restore from backup ever been tested end to end?
> Options: Yes - and the date · No · I don't know

A backup nobody has restored is a hypothesis. The handover is the worst possible time to test it.

## Round 2 - people and commercial

**Owner and backup** — trigger: `ownership.busFactor <= 1`, which is nearly always true when someone commissions a turnover.
> Who is taking this over, and who is their backup?

Without a named second person the bus factor is unchanged by the handover, and the document should say so.

**Escalation** — always.
> Who is called when this breaks outside working hours, and how?

**Vendor accounts** — trigger: `services` contains entries with `kind: "unknown"`. One multi-select, not one question per host.
> Which of these external services do you hold the account for?
> Options: every unknown service name from the scan.

Then a single follow-up for whichever they selected: who administers it, and what happens to access at handover.

**Billing and licences** — trigger: any paid-looking service, or a `LICENSE` naming a commercial grant.
> Who pays for these, and when do the contracts renew?

## Round 3 - only if earned

Ask only what rounds 1-2 opened. Typical triggers:

- They said a deploy path is legacy → "Can it be decommissioned, or does something still depend on it?"
- They named a vault → "Who can grant access to it?"
- They said a backup restore was never tested → "Should testing one be in the first 30 days?"
- They named a backup owner → "What does that person already know about this system?"

## Questions worth asking when nothing triggers them

If the scan came back thin - a small project, no CI, no schedules - spend the budget here instead. These are the highest-value things no repository contains:

- What breaks, and who notices, if this stops for a day?
- What is the one thing you would tell someone that is written down nowhere?
- What has broken before, and what fixed it?
- Which part would you rewrite, and why has it not been rewritten?
- Is anything here load-bearing for a deadline, an audit, or a contract?
- What do you do manually that ought to be automated?

## What never to ask

- Anything in the repository. Read it.
- The value of a secret. Ask where it lives and how it transfers; never what it is.
- Permission to write the document. That was settled at step 3.
- Confirmation of something the scan measured. "Is it true you have 25 test files?" wastes a question and reads as not trusting your own tools.
