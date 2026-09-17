# Command Center — Sync Protocol

> How `data/registry.json` stays accurate as the single source of truth for every agent + scheduled task,
> across **Cowork**, the **laptop daemon**, **Windows Task Scheduler**, and **non-Cowork (open-model gateway) jobs**.

## The problem
The registry is hand-maintained. Any time an agent is changed on any host — a new scheduled task, a cron edit, a
disable, a tier migration — the registry can silently drift. Because tasks live on **multiple hosts** (Cowork's
scheduler, the laptop daemon's supervisor, Windows Task Scheduler, gateway/open-model rows), no single tool sees them
all. Discipline alone doesn't hold. The fix is **discipline + an automated reconciler**.

## Two kinds of fields (this is the key design idea)
Split every task row into two ownership lanes so humans and machines never fight:

- **Declared / policy fields** (human + agent owned): `name`, `agent`, `recommendedTier`, `model`, intended `cron`,
  `notes`, `mcp`. These express intent. Only a person or an agent making a real change edits these.
- **Observed / actual fields** (reconciler owned): `observedCron`, `observedEnabled`, `observedHost`, `lastSeen`,
  and a computed `drift` flag. The reconciler writes only these. The Command Center renders `drift: true` in red.

When declared ≠ observed, that's drift you can see — not a silent lie.

## Rule 1 — Write-through (every change updates the registry in the same action)
Any session on any host that **creates, edits, deletes, enables, or disables** a scheduled task MUST update
`registry.json` in the same change. Not "later." The task isn't done until the registry row matches.
- This is now stated in `registry.json._sync_protocol` and should be added as a one-line rule in `CLAUDE.md` so
  every Cowork session inherits it.
- For open-model/non-Cowork agents, the same rule goes in their system prompt / handoff doc.

## Rule 2 — Nightly reconciler (catches every miss)
A small scheduled infra task — `registry-reconcile` — runs nightly and enumerates the **actual** tasks on each host,
then writes the observed fields + drift flags back into `registry.json`:

| Host | How the reconciler reads ground truth |
|---|---|
| Cowork | `mcp__scheduled-tasks__list_scheduled_tasks` (taskId, cron, enabled, lastRunAt) |
| Windows Task Scheduler | `schtasks /query /fo LIST /v` (filter to the agent tasks, e.g. GrailHunter3h) |
| Laptop daemon | the supervisor's task list / its own config file (openmodel_worker registry) |
| Gateway / open-model | the Agent Dispatch queue rows + gateway job config |

For each actual task it finds:
- Match to a declared row by `id`. Set `observedCron`, `observedEnabled`, `observedHost`, `lastSeen`.
- If declared cron/enabled ≠ observed → `drift: true` + a one-line `driftReason`.
- If an actual task has **no** declared row → append a `status: "undeclared"` stub row so nothing is invisible.
- If a declared row has **no** actual task on its host → `drift: true`, `driftReason: "declared but not found"`.

It does **not** edit policy fields, and it never deletes rows — drift is surfaced, you decide.

## Rule 3 — Surface drift on the dashboard, do NOT text
Registry drift is **not** an interrupt. Write the drift flags into `registry.json` (Rule 2) and let the Command
Center render them. Send **no** iMessage.

> **Changed 2026-07-26 (Eddie).** This rule used to read "it sends one iMessage … e.g. *Registry drift: 2 tasks
> differ from declared. Open Command Center.*" Because that instruction lives in a doc rather than in code, it was
> being carried out by whichever agent read this file — which is why the exact wording drifted between runs
> (`"Registry drift - 4 tasks…"`, `"Registry drift: 6 tasks…"`) and why no grep of the codebase ever found a
> sender. One of those texts landed at 06:42 on 2026-07-26 among the ten that morning, reporting 18 drifted tasks
> in the same hour the Python reconciler logged `79 rows, 0 drifted` — so the number was not even reconciled
> against ground truth.
>
> Drift is a "look at this when you next open the dashboard" condition, not a wake-Eddie condition. The single
> daily text is the 09:00 briefing; nothing else may claim an unprompted send.

**The one exception:** if the reconciler itself *fails to run or crashes*, that is a genuine warning and follows
the normal escalation path — a reconciler that is silently dead is exactly the failure that hides everything else.

## Why this covers the Cowork + gateway split specifically
The whole reason the Command Center exists is that you run agents in **two ecosystems** and need one view. Rule 1
keeps Cowork and gateway sessions honest at write time; Rule 2's per-host readers mean even tasks that Cowork's
MCP can't see (Windows, daemon, gateway) still get reconciled — so the registry reflects *all* hosts, not just the
one you happen to be in.

## Build status
- Protocol: defined here + referenced in `registry.json._sync_protocol`.
- `registry-reconcile` task: **built and armed** (commit `aa876a9`, rebuilt 2026-07-25). Runs as the Windows task
  `RegistryReconcile` at 06:00 and logs to `agent_framework/state/registry-reconcile.log`
  (e.g. `2026-07-26T06:00:01  registry-reconcile: 79 rows, 0 drifted, 0 unverifiable`).
  Corrected 2026-07-26 — this line still read "not yet built" long after it shipped, which is the kind of stale
  status that invites an agent to helpfully build a second one.
- CLAUDE.md one-liner for Rule 1: recommended add — "When you change any scheduled task, update
  Agent/command-center/data/registry.json in the same change."
