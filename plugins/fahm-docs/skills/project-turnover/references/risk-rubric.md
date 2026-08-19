# Risk rubric

Loaded at step 6, while writing the register. The point of a fixed rubric is that the same project scores the same twice, and that severity means something specific rather than how alarming the finding felt.

## Severity

Score against **one question**: what does this do to the person taking over?

| Severity | Definition | Test |
|---|---|---|
| **critical** | Live exposure, or certain data loss. Acting is more urgent than the handover itself. | A credential is already readable by people who should not have it, or the only copy of something is one disk away from gone. |
| **high** | The incoming owner will hit this, and will not be able to resolve it alone. | They cannot deploy, cannot restore, cannot get access, or will break production without knowing why. |
| **medium** | Real, costs time, has a workaround. | Solvable by reading the code for an afternoon. |
| **low** | Untidy. Worth recording so it is not rediscovered. | Nobody is blocked. |

Two calibration rules:

- **Do not inflate.** If everything is high, the register is a list and not a ranking. A project with fifteen high findings usually has four.
- **Do not deflate a credential.** Anything involving access to production or customer data starts at high and argues its way down, not up.

## Standing scores

These come out of the scan pre-scored. Keep them unless you have a specific reason, and state the reason.

| Finding | Severity | Why |
|---|---|---|
| Credential file committed to the repository | critical | Everyone with repo access has it already. Rotation, not transfer. |
| More than one deployment path, different targets | high | Nobody can tell which is live. Wrong choice is a no-op or an outage. |
| Scheduled job bound to one machine | high | Stops silently at reimage. Nothing alerts. |
| Credential present locally, absent from the repo | high | Transfers deliberately or is lost. Nothing reminds anyone. |
| Deploy without a test/lint/typecheck gate | high | A newcomer reaches production with no safety net. |
| Bus factor of 1 | high | No second person holds working knowledge. |
| Operational file untracked in git | high | Exists on one machine. |
| No deployment path detected at all | high | The route to production is in someone's memory. |
| Env var read by the app, documented nowhere | high | A fresh deploy is missing it and nothing says so until runtime. |
| No secret manager anywhere | medium | Secrets live in files and people; no single place to point at. |
| Two lockfiles in one ecosystem | medium | A newcomer resolves a different dependency tree than production. |
| Env var documented but referenced nowhere | medium | The template no longer describes the system. |
| Code references a path that does not exist | medium | Either a feature is inert or a directory was never committed. |
| Documentation contradicting itself on counts | low | Something is stale; a newcomer cannot tell which. |
| Dead documentation links | low | The onboarding trail has holes. |

## Bus factor

Smallest number of contributors whose commits together exceed half of all commits. `1` means one person authored the majority.

Read it with three caveats, and write them down if they apply:

- **A rewrite distorts it.** One person who reformatted everything looks like the author of everything.
- **Vendored code and generated files distort it.** Check whether the majority author's commits are concentrated in a lockfile.
- **Commits are not knowledge.** Someone with 5% of commits may hold all the operational knowledge. Bus factor is a prompt to ask, not a conclusion.

Where git is unavailable, say `unknown` and ask. Never substitute file modification times: they record who last touched a checkout, not who wrote anything.

## Writing a register row

Every row needs five things, and the fourth is the one usually missing:

| Field | Rule |
|---|---|
| Risk | What is true, in one sentence. No adjectives. |
| Severity | From the table above. |
| Evidence | A file and line, or a person and date. A row with neither is an opinion. |
| **Impact on handover** | What this does to the incoming owner, specifically. This is the column that makes the register useful. |
| Mitigation and owner | What to do, and **who** - named, or explicitly "unassigned". |

Never write "accepted" unless the owner said so, in this conversation. An unmitigated risk with no owner is honest; a risk silently marked accepted is a document that lies.

### The phrasing pattern

State the fact, then the consequence, then the trigger.

> The weekly smoke test is registered as a Windows scheduled task on one workstation, running as the interactive user, with absolute paths under that user's profile *(fact)*. It will stop running the day that machine is reimaged or handed back, and nothing will alert anyone *(consequence)* — most likely at offboarding, which is when it is least likely to be noticed *(trigger)*.

Against the version that fails:

> ⚠️ Scheduled task risk — the weekly smoke test may have issues.

## Worked examples

**Host-bound job.** `boundToHost: true` with three reasons: a `C:\Users\<name>\…` path, `-LogonType Interactive`, and `$env:USERNAME`. High. Impact: the job's output is a weekly signal somebody relies on; when it stops, the absence of a failure looks identical to a pass. Mitigation: move to CI or a server, or accept and name who re-registers it. Note in the register that a job whose *silence* is its success signal has no failure mode a human notices.

**Deploy divergence.** A CI workflow deploying to a managed app service, and a markdown runbook describing a VM with a process manager behind a reverse proxy. High. Do **not** infer that the newer file wins, or that CI supersedes the runbook. Impact: the incoming owner has a 50% chance of deploying somewhere nothing is served from. Mitigation is a sentence from the outgoing owner, and it belongs in round 1 of the interview.

**Untracked operational file.** The deployment runbook exists but is not in version control. High, independent of its contents: the risk is not what it says, it is that the only copy is on one disk. Check `tracked` from `git ls-files` rather than inferring from `.gitignore` — a tracked file ignores its ignore rule, and getting this backwards inverts the finding.
