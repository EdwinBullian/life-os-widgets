# Registry control actions — backend contract

The Registry tab now lets you toggle tasks on/off, edit their schedule/frequency, and change their
model inline. Every change is **applied optimistically** to a local override
(`localStorage["agentos_task_overrides"]`, merged over `data/registry.json` at render time) so the
UI works immediately and across reloads — even with no proxy connected.

Each change **also POSTs** to the Apps Script proxy (the same `/exec` URL set in Settings). Add the
matching handlers to the Apps Script `doPost` to make the controls actually re-schedule the real
jobs. All three are `application/x-www-form-urlencoded`:

| Action | Params | Meaning |
|---|---|---|
| `settaskenabled` | `id`, `enabled` = `"true"` \| `"false"` | Enable/disable the task with that registry `id`. |
| `settaskmodel` | `id`, `model` = e.g. `"gpt-oss-20b"` | Change the model the task runs on. |
| `settaskschedule` | `id`, `trigger` = e.g. `"Mon 08:00"` | Change the human-readable schedule/frequency. Map this back to a cron string on the backend. |

`id` is the registry task id (e.g. `daily-finance-scan`). The proxy should write the change back to
the source of truth for that host (cron / Windows Task Scheduler / the daemon) and update
`registry.json` so the override and the file converge.

Until the handlers exist, an unknown action returns a non-2xx and the widget shows
"Saved on this device — proxy offline"; the local override still holds. The allow-list lives in
`js/proxy.js` (`ALLOWED_ACTIONS`).
