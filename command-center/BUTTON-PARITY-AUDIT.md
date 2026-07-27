# ACC Button-Parity Audit (doc 24 §2.2, P3.5)

> Every interactive control in the dashboard either **produces a valid bus request**
> or is **deleted**. The failure mode this kills is the old chat tab's "Send only
> toasts" — a button that fakes success and does nothing. Reconciled against the
> GitHub-as-bus consumer (`agent_framework/acc_bus.py`), whose closed action enum is:
> `chat · request_job · toggle_enabled · toggle_notify · set_cron · set_model_override · global_pause`.

Status legend:
- **✅ WIRED** — routes to the bus today (via `proxy.postAction` → `busclient.submitLegacyAction`, or a direct `busclient` call).
- **🔵 LOCAL** — a device-local preference; correctly NOT a bus action.
- **🟡 FUTURE** — a real concept with no single bus action yet (needs a compound fan-out or an enum addition); until then it must show "not yet live", never a fake success toast.
- **🗑 DELETE** — a dead-end stub with no valid bus action; remove from the UI at publish time.

## Registry tab (`render/registry.js`)
| Control | Legacy action | Bus mapping | Status |
|---|---|---|---|
| Enable/disable a job | `settaskenabled` | `toggle_enabled {id, enabled}` | ✅ WIRED |
| Change a job's model | `settaskmodel` | `set_model_override {id, model}` (display→alias in `busclient.MODEL_ALIAS`; consumer enforces privacy legality) | ✅ WIRED |
| Change a job's schedule | `settaskschedule` | `set_cron {id, cron}` | 🟡 FUTURE — the editor still emits a human trigger ("Mon 08:00"); `busActionFor` refuses anything that isn't a 5-field cron. **Fix: the schedule editor must emit cron** (or add a trigger→cron parser to the consumer). Until then it surfaces the refusal, not a fake save. |

## Agents / Overview tabs (`render/agents.js`)
| Control | Legacy action | Bus mapping | Status |
|---|---|---|---|
| "Request work" / dispatch a job to an agent | `dispatch` | `request_job {agent, goal}` (same pipe as the iMessage Request Inbox, P4.9) | ✅ WIRED — goes through `dispatchOneOff`, so every hand-fired job is also recorded in the one-off ledger and tracked in the Schedule tray until the consumer answers. `runMode` / `model` used to be silently dropped (request_job carries only agent+goal); they are now appended to the goal text so the intent reaches the desk. |
| Run now | `runnow` | — | 🟡 FUTURE — an ad-hoc immediate run is not a registry write; needs a dedicated action or a local schtasks `/Run`. Not faked. |
| Cancel a queued run | `cancel` | — | 🟡 FUTURE — queue lifecycle not on the bus yet. |
| Pause one agent | `pause` / `toggleagentpause` | — | 🟡 FUTURE — "pause one agent" = disable all of that agent's rows; implement as a `toggle_enabled` fan-out. Currently local-optimistic (`getPausedAgents`) only. |
| Set model for a whole agent | `setagentmodel` | (maps per-row to `set_model_override`) | 🟡 FUTURE — fan-out over the agent's jobs; single button, N bus requests. |

## Chat tab (`render/chat.js`)
| Control | Legacy behaviour | Bus mapping | Status |
|---|---|---|---|
| Send a message | ~~`toast('Sent (Phase 2)')`~~ | `chat {message}` → poll `replies/<id>.json` (~30–60s, iMessage band) | ✅ WIRED (**was the exact dead-end this audit exists to kill** — now posts a real bus request and renders the Assistant's reply). Requires a bus token; without one it prompts to set one instead of faking a send. |
| Model selector | (cosmetic) | — | 🔵 LOCAL — display only; the Assistant's routing is server-side. |

## Schedule tab (`render/schedule.js`)
| Control | Bus mapping | Status |
|---|---|---|
| "+ New one-off" | `request_job {agent, goal}` | ✅ WIRED (2026-07-26) — was `toast('One-off jobs are Phase 2')`. Opens the shared dispatch form (`openDispatchModal`) and submits through the same path as the Agents tab. Refuses to open with no bus token rather than letting you fill in a form that will fail. |
| One-off tray | reads `js/oneoffs.js` + `replies/<id>.json` | ✅ WIRED (2026-07-26) — was the hardcoded string `"No one-off jobs."`, so a dispatched job could never appear no matter what happened to it. Now renders the real ledger with earned states: `submitting → pending → accepted / refused`, or `failed` when the write never landed. A failed job stays visible with its reason and a Retry button. |
| Retry / Dismiss / Clear finished | — (local ledger ops; Retry re-fires `request_job`) | ✅ WIRED / 🔵 LOCAL |
| Drag a job onto a day | — | 🟡 FUTURE — `request_job` has no time field, so there is nothing to send. The drop handler now names the two things that DO work (Registry cron, or fire it now) instead of toasting "Scheduling is Phase 2". |

## Queue tab (`render/queue.js`)
| Control | Legacy action | Bus mapping | Status |
|---|---|---|---|
| Notify toggle | `notify` | `toggle_notify {id, notify}` | ✅ WIRED (via `busActionFor`; wire the queue handler to `submitLegacyAction('settasknotify', …)` at publish). |
| Run now / Cancel | `runnow` / `cancel` | — | 🟡 FUTURE — kept, and say so plainly ("Not wired yet — manage this job in Notion for now"). |
| ~~Edit~~ | `edit` | — | 🗑 DELETED 2026-07-26 — never opened an editor; it only toasted. |
| ~~Approve~~ / ~~Reject~~ | `approve` / `reject` | — | 🗑 DELETED 2026-07-26 — P2 approval stubs, no bus semantics. Waiting-approval cards now just say "Approve in Notion". |
| ~~Schedule~~ / ~~Reschedule~~ | `schedule` / `reschedule` | — | 🗑 DELETED 2026-07-26 — duplicate of the Registry `set_cron` path. |

## Settings + chrome (`render/settings.js`, `render/chrome.js`)
| Control | Bus mapping | Status |
|---|---|---|
| acc-bus token entry | — (stores the PAT locally) | 🔵 LOCAL — arm-time credential, localStorage only, never committed. **Now verified on save** (`verifyBusToken` does one read-only GET on the repo) and reported as `bus armed ✓` or the exact failure (401/403/404). Before this, an unset or wrong token was indistinguishable from a working one until a button failed — which is exactly how a dispatched job could vanish with no trace. The field is also now first in the modal, above the legacy Apps Script URL, because it is the only live write path. |
| Global kill switch ("Pause all agents") | `global_pause {paused:true}` | ✅ WIRED — consumer flips `registry.global_pause`; `run.py` then exits early for every non-exempt job (maintenance watchdog + bridge stay alive). |
| Apps Script proxy URL | — | 🟡 LEGACY — the pre-rewire write path; kept only as a fallback when no bus token is set. **Delete once the bus is armed and proven.** |
| Claude Max % used | — | 🔵 LOCAL — Anthropic exposes no API; Eddie types it. |
| Phone-bridge snooze | — | 🔵 LOCAL — local countdown; the real disable is a `toggle_enabled`. |

## Cost tab (`render/cost.js`)
| Control | Bus mapping | Status |
|---|---|---|
| ~~Edit cap~~ | — | 🗑 DELETED 2026-07-26 — toasted "Edit cap" and changed nothing. The weekly cap is a plain number in `data/spend.json` with no bus action behind it; the tab now says so and is fully read-only. |

## Deletion list for publish (Eddie's go)
1. ~~**Delete** Queue: Approve, Reject, Schedule, Reschedule~~ — **done 2026-07-26** (plus Edit, and Cost's Edit cap).
2. **Delete** the Apps Script proxy URL field once the bus path is proven live. Demoted to last in the Settings modal and labelled "legacy read path" — delete outright after the first real bus round-trip.
3. **Convert to real controls or hide** the remaining 🟡 FUTURE items (runnow, cancel, per-agent pause, per-agent model, schedule-tab cron emission) — they must not toast fake success in the meantime.

Nothing in the UI silently no-ops: every remaining control is ✅ WIRED, 🔵 LOCAL, or names the reason it can't act.

## Standing hazard: an unarmed bus looks exactly like a broken dashboard
As of 2026-07-26 the acc-bus repo had received **zero** real requests since the 2026-07-13 smoke
test — every write button on the published dashboard had been failing since it shipped, because no
browser ever had the PAT in localStorage. The consumer side was fine the whole time (`AccBusPoll`
armed, `ACC_BUS_TOKEN` set at User scope, `poll_once()` clean). The failure was silent and entirely
client-side, and it presented to Eddie as "I dispatched a Meta thesis and it was nowhere."

Two guards now exist against a repeat: the token is verified on save, and a job that fails to send
is kept and shown as `failed` in the Schedule tray instead of disappearing behind a toast. **Arming
a new device is still a manual step** — open Settings (⚙), paste the fine-grained PAT, confirm the
`bus armed ✓` toast.
