# Claude Design Handoff — AI Command Center Widget

> Paste this whole file into Claude Design as your brief, and **attach the `command-center` folder
> alongside it** (at minimum: `index.html`, `css/styles.css`, and the `js/render/*.js` files).
> This document tells Design what the widget is, what to keep, and what to change. You will steer
> the actual redesign turn by turn.

---

## 1. What this is

A single-page, multi-tab **"AI Command Center" dashboard** that I embed inside a Notion page via an
iframe/embed. It monitors and controls a fleet of personal AI agents (finance, health, research,
etc.) — their schedules, queue, cost/spend, and a registry of scheduled jobs.

It is a **real, working app**, not a mockup. Vanilla HTML + CSS + ES-module JavaScript. **No build
step, no framework, no CSS library.** DOM is built by string templating in the `js/render/*.js`
files. The redesign is therefore primarily a **CSS reskin of `css/styles.css`**, plus small,
surgical edits where colors are hardcoded in JS (see §6).

## 2. Goal of the redesign

Take it from its current cool-gray "Notion dark" theme to a **polished, professional Anthropic /
Claude aesthetic**:

- **Warm, light surfaces** — off-white / cream / ivory paper tones instead of near-black grays.
- **Clay / rust / terracotta accent** (Claude's signature warm orange) as the primary action color.
- **Refined typography** — consider a serif for headings (Tiempos-like) paired with the existing
  sans body; tighten hierarchy, letter-spacing, and weights.
- **Calmer depth** — soft shadows, gentle borders, generous spacing. Less "terminal," more
  "considered product."
- Keep it feeling like **one coherent system across all 7 tabs**, not 7 different pages.

## 3. Hard constraints (do NOT break these)

1. **Keep the CSS-variable architecture.** Almost everything color-codes off `:root` custom
   properties. **Re-theme the tokens; don't rip out the variable system.** This is what keeps the
   reskin paste-able back into my real files with minimal rewiring.
2. **Keep all class names and DOM structure.** The JS renderers target these exact classes
   (`.topbar`, `.panel`, `.acard`, `.kanban`, `.reg-table`, etc.). Renaming classes breaks the app.
   Restyle existing selectors; add new ones only if additive.
3. **Keep the per-agent color coding.** Each agent type has an identity color used everywhere
   (left borders, tags, calendar events, table rows). These 8 must stay visually distinct and
   meaningful — you may re-tune the hexes for a light background, but don't collapse them. They are:
   - `assistant` (blue), `finance` (gold), `health` (green), `research` (purple),
     `programming` (orange), `career` (magenta), `business` (red), `marketing` (teal).
4. **Stays embeddable in Notion.** No fixed full-viewport assumptions beyond what's there; the panel
   height already tracks the embed via `--app-h`. Keep it responsive (existing breakpoints at
   ~1100/1000/620px).
5. **No build tooling, no external CSS frameworks.** Output must be plain CSS I can drop into
   `css/styles.css`. Web fonts via `<link>` in `index.html` are fine (Inter + JetBrains Mono are
   already loaded; add a serif if you want).
6. **Status semantics must survive:** success=green, running=blue (often pulsing), warn=amber,
   fail=red, queued=yellow. Re-tune for contrast on light, keep the meaning.
7. The **agent-art card images** (`agent-art/`) are pixel-art with dark bezels. Don't assume you can
   recolor them — design the card frames to look good *around* dark thumbnails on a light surface.

## 4. Current design tokens (from `css/styles.css :root`)

```
--bg:#191919  --card:#232323  --card2:#2f2f2f  --card3:#383838
--accent:#ececec (near-white — currently the "primary"/button color)
--text:#e6e6e6  --muted:#9b9b9b  --faint:#6f6f6f
--border:#383838  --border2:#474747
--success:#5bbd7e  --running:#6aa3e0  --warn:#e3a05c  --fail:#e07a7a  --queued:#d8c06a
Agent tags: assistant #7a9fd1 · finance #d4b85c · health #5fb98a · research #9d83d6
            programming #d4905c · career #c478c4 · business #e08585 · marketing #5cb8c0
--radius:12px   --app-h:max(680px, calc(100vh - 100px))
Fonts: Inter (body), JetBrains Mono (mono/code/numbers)
```

**Suggested Anthropic-aesthetic target palette** (starting point — tune freely):
- Background ivory `#FAF9F5` / paper `#F0EEE6`; card surfaces slightly warmer-white with soft
  warm-gray borders.
- Primary accent clay/rust ~`#CC785C`–`#D97757`; dark warm charcoal text ~`#1A1A18` / `#3D3D3A`.
- The current `--accent` is near-white and used as the *button* fill + active-tab underline + "me"
  chat bubble. In the new theme the **clay accent** should take that role, with dark text flipping
  to light on the accent fill.

## 5. The 7 tabs (what each panel contains, so Design knows what it's styling)

Single header row (`.topbar`): tab bar on the left; status **pills** (gateway status, Max-plan %,
OpenRouter $) + refresh/settings icon buttons on the right. Then one `.panel` per tab:

1. **Overview** (`overview.js`) — KPI row (4 stat cards), a quick-dispatch box (model select +
   prompt → run an agent), "fuel gauge" bars/donut for usage, and a live activity feed list.
2. **Chat** (`chat.js`) — an assistant chat surface: context chips, message bubbles
   (`.bubble.me` / `.bubble.ai`), model selector, input + Send. (Currently a stub UI.)
3. **Agents** (`agents.js`) — roster grid of agent cards (`.acard`) with pixel-art thumbnail,
   name, type badge, health dot, description, skill chips. Clicking opens a per-agent **modal**
   (`.overlay`/`.modal`) with dispatch presets, pause/start toggle, skills accordion.
4. **Schedule** (`schedule.js`) — read-only weekly calendar, 7 day-columns Sun→Sat, color-coded
   event cards (`.evt.ag-<agent>`), per-day token totals pinned to column bottoms, plus a drag tray.
5. **Queue** (`queue.js`) — 3-column kanban (Waiting approval / Approved / Scheduled) with a 3-way
   filter toggle (Manual | Scheduled | All). Cards = `.qcard`; full-width rows = `.qrow`.
6. **Cost** (`cost.js`) — spend KPIs, by-model and by-agent bar rows, a weekly-cap **donut** gauge.
7. **Registry** (`registry.js`) — dense sortable/filterable **table** of every scheduled task
   (Name, Agent, Tier, Enabled toggle, Trigger, Model, Tok/wk, Notes). Has on/off switches and
   inline schedule/model editors. This is the most data-dense screen — needs the most care for
   readability on a light theme (zebra/hover, border weights, the toggle switch styling).

Shared components to theme consistently: **pills, tags, chips, buttons** (`.btn`, `.btn.ghost`,
`.btn.danger`, `.btn.go`), **inputs/selects/textareas**, **modal + overlay**, **toast**,
**scrollbars** (already custom-styled), status dots, and the donut/spark/bar primitives.

## 6. JS files with hardcoded colors (must match the new tokens)

CSS covers ~99% of color. The only hardcoded hexes in JS are agent colors in the Cost chart, in
`js/render/cost.js` (lines ~31–36): `#7a9fd1 #6aa3e0 #9d83d6 #c478c4 #5fb98a #d4905c`. If you change
the agent palette, update these six literals to match (or, better, refactor them to read the CSS
variables). A couple of button fills assume dark text on the near-white accent (`color:#1a1a1a`) —
those need to flip when the accent becomes clay.

## 7. Suggested opening prompt for Claude Design

> This is a working, embedded-in-Notion multi-tab dashboard (vanilla HTML/CSS/ES-module JS, no
> build step). Read `css/styles.css` and `index.html` and **build a design system from my existing
> CSS variables** — keep the variable architecture and all class names; only re-theme tokens and
> restyle existing selectors. Redesign it to a polished **Anthropic/Claude aesthetic**: warm ivory
> surfaces, a clay/rust primary accent, refined typography (serif headings + sans body), soft depth,
> generous spacing. Preserve the 8 per-agent identity colors and the status color semantics
> (success/running/warn/fail/queued). Start by restyling the **shell (topbar + tabs) and the
> Overview panel** as a proof of concept; once I approve the system, apply it across the other six
> tabs: Chat, Agents, Schedule, Queue, Cost, Registry. Output plain CSS I can paste back into
> `css/styles.css`, and flag any JS color literals I need to update.

## 8. When you're done in Design

Export the updated CSS (and any new `<link>` font tags). Paste the CSS into `css/styles.css`,
add font links to `index.html` if any, update the six hardcoded agent hexes in `cost.js` if the
agent palette changed, then reload the Notion embed to verify all 7 tabs.
