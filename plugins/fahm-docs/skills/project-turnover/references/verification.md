# Verification - the judgement half

Loaded at step 7, **after** `--verify` exits 0. The script has already checked what a script can check: required sections present, high-signal facts mentioned, links resolving, placeholders replaced, no secret in the file. What follows cannot be automated, and is where a document that passes still fails.

## The four tests

### 1. Could a stranger deploy from this, without asking a question?

Read sections 7 and 8 as someone with repository access, credentials, and no context. Stop at the first point where you would have to ask something.

Usual failures: a command with no working directory; an env var named but not sourced; "restart the service" without saying which process manager; a rollback that says "revert and redeploy" without saying how far back is safe.

### 2. Can the incoming owner do every 30-day action on day one?

Go through the onboarding path line by line and check each item against the access list. An action needing access the person does not have yet is not a first-week task - it is a blocked task with a due date, and the document should say who unblocks it.

The common miss: "review the deployment pipeline" when the CI secret has not been granted, or "verify the backup" when the database credential is still in the outgoing owner's password manager.

### 3. Is every claim either measured or attributed?

Every sentence should be traceable to the scan, a file you read, or a person who told you - `per <name>, <date>`. A reader has to be able to separate what was verified from what was reported.

Sentences that fail this test tend to sound like: "the system typically handles…", "it should be safe to…", "usually deployed weekly". If you cannot name the source, either find it or move the claim into Known unknowns.

### 4. Does every credential name a transfer method?

Every row in the access section needs `where it lives` **and** `how it transfers` **and** `who holds it now`. A credential inventory with no transfer column is a list of things that will be discovered missing later.

Check the reverse too: is there anything in the access list that should be **revoked** rather than transferred? A departure checklist is not the same list as a handover checklist, and conflating them leaves the outgoing owner with production access.

## Specific things to re-read

- **Every `unknowns` entry** - is it answered in the text, or listed openly in Known unknowns? Silence is the only wrong answer.
- **Every `deploy.divergence`** - does the document state which path is live, or state plainly that nobody knows? "Both are documented" is not an answer.
- **Every high finding** - is it in the register with an owner, or consciously left out for a stated reason?
- **The partial-scan flag** - if `limits.truncated` was true, does the document say the scan was partial? A document that reads complete when the scan was not is worse than a shorter one.
- **The empty sections** - delete them. An empty "Common failures" tells the reader there are none.

## What a passing document looks like

- Somebody who has never seen the project can find where it runs, in under a minute.
- Every risk has a named owner or an explicit "unassigned".
- The gaps are visible, and each names someone to ask.
- Nothing in it is a guess presented as a fact.
- Section 16 says when it was produced, from what, and when it needs re-verifying.

## What still fails after all of this

Two things this skill cannot check, worth saying out loud in the final report:

- **Whether the commands work.** Nothing was executed. Every command in the runbook is transcribed from source, not tested. The first real verification is the incoming owner running them with the outgoing owner still reachable - and that is worth scheduling before the handover date, not after.
- **Whether the tribal knowledge is complete.** You asked at most eleven questions. The interesting things are the ones nobody thought to mention because they seemed obvious. The Known unknowns section is the honest record of that limit; do not let its shortness imply completeness.
