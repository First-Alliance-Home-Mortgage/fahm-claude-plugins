<!--
  FALLBACK ONLY. Use this when the project has no docs to learn conventions from.
  When it does have docs, copy their shape instead - see SKILL.md step 3.

  Delete every HTML comment before saving. Replace every {{PLACEHOLDER}}.
  Delete any section with no real content: an empty "Common failures" tells the
  reader there are none.

  Section numbering: roughly half of projects number their H2s and half do not.
  Numbered form is written below. Strip the numbers if the project is unnumbered,
  and drop the Contents index with them.

  ONE RULE THAT IS NOT STYLISTIC: section 9 records where credentials live, who
  holds them, and how they transfer. It NEVER records a value. A handover
  document containing a key is a document that has to be shredded.
-->

# {{PROJECT}} — Project Turnover

**Outgoing owner:** {{NAME}}
**Incoming owner:** {{NAME, or "not yet named"}}
**Handover date:** {{DATE}}
**Status:** {{Draft | Reviewed by both parties | Signed off}}
**Repository:** {{URL or path}}
**Last verified:** {{DATE}}

---

## Contents

<!-- Delete this index if the project's docs don't use one. -->

---

## 1. What this is

{{One paragraph, present tense: what the system does and who uses it. A reader
who has never opened the code should finish this knowing whether it matters.}}

**What breaks if it stops:** {{Who notices, how quickly, and what they cannot do.
If the honest answer is "nobody would notice for a week", write that - it changes
how the next owner prioritises everything below.}}

## 2. Status at handover

| | |
|---|---|
| Environments | {{prod / staging / dev, and which are real}} |
| Production URL | {{URL}} |
| Deployment path in use | {{the one that is live - see §7.3}} |
| Access granted to incoming owner | {{yes / partial / not yet}} |
| Open high-severity risks | {{count, from §11}} |
| Known unknowns | {{count, from §13}} |

## 3. System overview

{{Stack table: language, framework, runtime version, package manager, datastore.
Then how the pieces connect - ASCII if the project's docs use ASCII, Mermaid if
they use Mermaid, prose if they use neither.}}

### 3.1 Entry points

{{Where execution starts. The command that runs it locally, and the command that
runs it in production - if those differ, say so explicitly.}}

### 3.2 Repository map

{{Only the directories a newcomer needs. A full tree is noise; six annotated
lines are a map.}}

## 4. External services and accounts

<!-- One row per service. "Account owner" is the single most valuable column and
     the one the repository cannot fill - it comes from the interview. -->

| Service | What it is used for | Env vars | Account owner | Who grants access | Cost / plan |
|---|---|---|---|---|---|

## 5. Data

{{What is stored, where it lives, and how sensitive it is. Name the production
instance and who can reach it.}}

### 5.1 Backup and restore

| | |
|---|---|
| What runs | {{command or job}} |
| Schedule | {{when}} |
| Where it lands | {{location, retention}} |
| Restore procedure | {{steps, or a link to them}} |
| Last verified restore | {{date, or **never tested** — say so plainly}} |

## 6. Environments and configuration

{{Every environment variable, grouped as the project groups them. Mark each
required or optional, and say where its value comes from. Do not paste values.}}

| Variable | Group | Required | Where the value comes from |
|---|---|---|---|

**Documented but unused:** {{from the scan - these mislead a newcomer}}
**Used but undocumented:** {{from the scan - these break a fresh deployment}}

## 7. Deployment

<!-- One subsection per detected path. Do not merge them and do not pick a
     winner: §7.3 is where the ambiguity gets resolved, by a human. -->

### 7.1 {{PATH_A}}

{{Trigger, what it builds, where it lands, which credentials it needs, and what
it does NOT check.}}

### 7.2 {{PATH_B}}

### 7.3 Which one is live

<!-- Emit only when more than one path exists. If nobody could answer, say that
     here in one sentence - an unresolved ambiguity stated plainly is far more
     useful than a guess. -->

## 8. Operations runbook

### 8.1 Start, stop, restart

### 8.2 Logs and health checks

{{Where to look, in what order, and what healthy looks like.}}

### 8.3 Scheduled and recurring jobs

| Job | Schedule | Where it runs | Host-bound? | What happens if it stops |
|---|---|---|---|---|

<!-- "Host-bound?" earns its column: a job tied to one machine is the finding
     most likely to be missed and most likely to break at handover. -->

### 8.4 Common failures

| Symptom | Cause | Fix |
|---|---|---|

### 8.5 Rollback

{{How to get back to the last known-good state, and how far back is safe.}}

## 9. Access and credentials

<!-- LOCATIONS AND TRANSFER METHODS ONLY. Never a value. -->

| Item | Kind | Where it lives | Who holds it now | How it transfers | Rotate at handover? |
|---|---|---|---|---|---|

### 9.1 Revoke on departure

{{A checklist. This is a different list from the one above - transferring access
to the new owner does not remove it from the old one.}}

- [ ] {{item}}

## 10. Testing and quality gates

{{What test suites exist and how to run them. Then, explicitly: what CI enforces
and what it does not. A pipeline that deploys without running the tests is a
fact the incoming owner needs on day one.}}

## 11. Health and risk register

| # | Risk | Severity | Evidence | Impact on handover | Mitigation | Owner after handover |
|---|---|---|---|---|---|---|

<!-- Never write "accepted" unless the owner said so in the handover
     conversation. Unassigned is honest; silently accepted is a lie. -->

## 12. Open items and in-flight work

{{Unmerged branches, half-finished features, known bugs, TODO hotspots. What was
in progress the day the handover started, and what state it is in.}}

## 13. Known unknowns

<!-- Not a failure of the document. A to-do list for the incoming owner. -->

| Question | Why it matters | Who to ask |
|---|---|---|

## 14. Onboarding path for the incoming owner

### First 30 days

<!-- Each item must be doable with the access granted in §9. An action needing
     access nobody has yet is a blocked task, not a first-week task. -->

- [ ] {{item}}

### Days 31–60

### Days 61–90

## 15. Contacts and escalation

| Role | Name | Reach them by | For what |
|---|---|---|---|

## 16. How this document was produced

**Scanned:** {{date, tool, and whether the scan was complete or truncated}}
**Source files read:** {{list}}
**Told by a person:** {{who, when, and which sections rest on it}}
**Not verified:** {{what nobody checked - including that no command here was executed}}
**Re-verify by:** {{date}}
