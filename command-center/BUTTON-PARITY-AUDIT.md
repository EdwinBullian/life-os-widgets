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
| "Request work" / dispatch a job to an agent | `dispatch` | `request_job {agent, goal}` (same pipe as the iMessage Request Inbox, P4.9) | ✅ WIRED |
| Run now | `runnow` | — | 🟡 FUTURE — an ad-hoc immediate run is not a registry write; needs a dedicated action or a local schtasks `/Run`. Not faked. |
| Cancel a queued run | `cancel` | — | 🟡 FUTURE — queue lifecycle not on the bus yet. |
| Pause one agent | `pause` / `toggleagentpause` | — | 🟡 FUTURE — "pause one agent" = disable all of that agent's rows; implement as a `toggle_enabled` fan-out. Currently local-optimistic (`getPausedAgents`) only. |
| Set model for a whole agent | `setagentmodel` | (maps per-row to `set_model_override`) | 🟡 FUTURE — fan-out over the agent's jobs; single button, N bus requests. |

## Chat tab (`render/chat.js`)
| Control | Legacy behaviour | Bus mapping | Status |
|---|---|---|---|
| Send a message | ~~`toast('Sent (Phase 2)')`~~ | `chat {message}` → poll `replies/<id>.json` (~30–60s, iMessage band) | ✅ WIRED (**was the exact dead-end this audit exists to kill** — now posts a real bus request and renders the Assistant's reply). Requires a bus token; without one it prompts to set one instead of faking a send. |
| Model selector | (cosmetic) | — | 🔵 LOCAL — display only; the Assistant's routing is server-side. |

## Queue tab (`render/queue.js`) — the P2 stubs
| Control | Legacy action | Bus mapping | Status |
|---|---|---|---|
| Notify toggle | `notify` | `toggle_notify {id, notify}` | ✅ WIRED (via `busActionFor`; wire the queue handler to `submitLegacyAction('settasknotify', …)` at publish). |
| Edit | `edit` | — | 🔵 LOCAL — opens an editor form; no write until the form submits its real action. |
| Approve | `approve` | — | 🗑 DELETE — P2 approval stub, never implemented; no bus semantics. |
| Reject | `reject` | — | 🗑 DELETE — same. |
| Schedule / Reschedule | `schedule` / `reschedule` | — | 🗑 DELETE — duplicate of the Registry `set_cron` path; the schedule editor is the one true surface. |

## Settings + chrome (`render/settings.js`, `render/chrome.js`)
| Control | Bus mapping | Status |
|---|---|---|
| acc-bus token entry | — (stores the PAT locally) | 🔵 LOCAL — arm-time credential, localStorage only, never committed. |
| Global kill switch ("Pause all agents") | `global_pause {paused:true}` | ✅ WIRED — consumer flips `registry.global_pause`; `run.py` then exits early for every non-exempt job (maintenance watchdog + bridge stay alive). |
| Apps Script proxy URL | — | 🟡 LEGACY — the pre-rewire write path; kept only as a fallback when no bus token is set. **Delete once the bus is armed and proven.** |
| Claude Max % used | — | 🔵 LOCAL — Anthropic exposes no API; Eddie types it. |
| Phone-bridge snooze | — | 🔵 LOCAL — local countdown; the real disable is a `toggle_enabled`. |

## Deletion list for publish (Eddie's go)
Publishing the dashboard is an explicit arm-time step (needs go/no-go). At that point:
1. **Delete** Queue: Approve, Reject, Schedule, Reschedule (dead-end stubs).
2. **Delete** the Apps Script proxy URL field once the bus path is proven live.
3. **Convert to real controls or hide** the 🟡 FUTURE items (runnow, cancel, per-agent pause, per-agent model, schedule-tab cron emission) — they must not toast fake success in the meantime.

Nothing else in the UI silently no-ops: every remaining control is ✅ WIRED or 🔵 LOCAL by design.
