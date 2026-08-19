<!--
  FALLBACK ONLY. Use this when the project has no docs to learn conventions from.

  Delete every HTML comment before saving. Replace every {{PLACEHOLDER}}.

  This is a strict subset of turnover.md sections 7-9, written for a different
  reader: someone at 2am who is not reading sixteen sections. Keep it short,
  keep commands copy-pasteable, and put the diagnosis order before the fixes.

  Credentials are named and located here, never quoted.
-->

# {{SERVICE}} — Operations Runbook

**Last verified:** {{DATE}}
**Owner:** {{NAME}}
**Escalation:** {{NAME / rota}}

---

## 1. What this service is and what it depends on

{{Two or three sentences. Then the dependencies whose failure looks like this
service failing - a newcomer debugging at 2am needs to know what is downstream
of what.}}

## 2. Service facts

| | |
|---|---|
| Runs on | {{host / platform}} |
| Port | {{port}} |
| Process manager | {{systemd / PM2 / container orchestrator / managed}} |
| Start command | {{command}} |
| Working directory | {{path}} |
| Logs | {{location or command}} |
| Config source | {{env file, secret store, platform settings}} |

## 3. Start, stop, restart

```
{{commands, with the working directory they assume}}
```

## 4. Deploy

<!-- One subsection per path. If more than one exists, say which is live in the
     first line of this section - not further down. -->

### 4.1 {{PATH_NAME}}

{{Trigger, build, destination, credentials required, and roughly how long it
takes. Then: how to tell it worked.}}

## 5. Scheduled jobs

| Job | Schedule | Where it runs | Host-bound? | Symptom if it stops |
|---|---|---|---|---|

<!-- A job whose success is silent has no failure mode anyone notices. If that
     applies here, say it in this section rather than leaving it implied. -->

## 6. Health checks — what to look at, in what order

<!-- Ordered, not a list. The order is the diagnostic value. -->

1. {{check}} — healthy looks like {{…}}
2.
3.

## 7. Common failures

| Symptom | Likely cause | Fix |
|---|---|---|

## 8. Rollback

{{How to reach the last known-good state. How far back is safe. What is NOT
reverted by a rollback — migrations, cached data, third-party state.}}

## 9. Escalation

{{Who to call, in what order, and what to have ready before calling. Include the
out-of-hours path, and say plainly if there is not one.}}
