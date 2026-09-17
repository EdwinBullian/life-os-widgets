// Pure week-board model for the Schedule tab: which recurring jobs land on which day.
//
// Built from registry.json, not schedule.json. schedule.json was a hand-maintained snapshot that
// stopped being updated in June and listed 17 jobs, which is why days rendered blank.
//
// Display rules Eddie set (2026-09-17): one line per job, coloured by agent; background and infra
// work never appears; noisy families collapse into one line; jobs that run every day (or every
// weekday) are the "daily" set and only show when he toggles them on.

export const AGENT_ORDER = ['assistant', 'health', 'finance', 'career', 'programming', 'research', 'business', 'marketing'];

// registry `agent` → colour tag. Anything that serves the assistant's loop wears its colour.
const TAG = {
  assistant: 'assistant', media: 'assistant', coach: 'assistant', 'assistant-retro': 'assistant',
  coordinator: 'assistant', health: 'health', finance: 'finance', career: 'career',
  programming: 'programming', tech: 'programming', research: 'research', business: 'business',
  marketing: 'marketing',
};

// Work that runs in the background — never shown, even with daily jobs on.
export const HIDDEN = new Set([
  'health-dashboard-refresh', 'projects-snapshot', 'team-coordinator-3h',
  'programming-maintenance-hourly', 'acc-bus-poll', 'oneoff-runner', 'vitals-bar-framework',
  'prog-fixer', 'health-mcp-resync', 'agentos-agentruntime-shadow-tick', 'clawd-day-bump',
  'resources-pin-reconcile',
]);

// Families shown as a single line. Order of GROUPS is irrelevant; members may span agents.
export const GROUPS = [
  { key: 'morning', name: 'Morning Briefing', tag: 'assistant', members: ['assistant-standup-daily', 'media-curator-framework'] },
  { key: 'watchers', name: 'Notification Watchers', tag: 'assistant', members: ['watcher-calendar', 'watcher-email', 'watcher-tasks', 'watcher-health', 'GrailHunter3h', 'career-triage-daily'] },
  { key: 'market', name: 'Market Watch', tag: 'finance', members: ['finance-pulse', 'watcher-market', 'watcher-news'] },
  { key: 'evening', name: 'Evening Wrap-Up', tag: 'assistant', members: ['tasks-steward-evening', 'evening-reschedule', 'nightly-maintenance'] },
];

const NAMES = {
  'health-watchdesk-daily': 'Health Coach',
  'programming-scout-daily': 'Tools Scout',
  'finance-daily-recap': 'Daily Market Recap',
  'midweek-quality-check-framework': 'Midweek Quality Check',
  'finance-portfolio-monthly': 'Monthly Portfolio Review',
  'health-science-monthly': 'Monthly Health Research',
};

// ── cron day matching ────────────────────────────────────────────────────────
function fieldSet(expr, lo, hi) {
  const out = new Set();
  for (const part of String(expr).split(',')) {
    const [rng, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    let a = lo; let b = hi;
    if (rng !== '*') {
      const m = rng.split('-');
      a = Number(m[0]); b = m.length > 1 ? Number(m[1]) : (stepRaw ? hi : a);
    }
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(step > 0)) return null;
    for (let v = a; v <= b; v += step) out.add(v === 7 && hi === 6 ? 0 : v);
  }
  return out;
}

// True if any cron in `crons` ("a; b") fires on `date`. Day-of-month and day-of-week are ANDed
// when both are restricted: the registry writes "0 9 1-7 * 0" to mean "first Sunday", and
// classic cron's OR would put it on the 1st–7th as well.
export function cronFiresOn(crons, date) {
  return String(crons || '').split(';').some((c) => {
    const f = c.trim().split(/\s+/);
    if (f.length !== 5) return false;
    const dom = fieldSet(f[2], 1, 31); const mon = fieldSet(f[3], 1, 12); const dow = fieldSet(f[4], 0, 6);
    if (!dom || !mon || !dow) return false;
    return dom.has(date.getDate()) && mon.has(date.getMonth() + 1) && dow.has(date.getDay());
  });
}

export function weekDates(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = '1,2,3,4,5';
// A generic Mon–Sun week (2026-09-13 is a Sunday). Daily-ness is judged against a normal week so a
// monthly job never counts as daily just because this week happens to include its date.
const REF_WEEK = weekDates(new Date(2026, 8, 13));

function dayPattern(crons) {
  return REF_WEEK.filter((d) => cronFiresOn(crons, d)).map((d) => d.getDay()).join(',');
}

// → { days: [[{name, tag, daily, title}] × 7] } for the week containing `now`.
export function buildWeek(registry, now = new Date()) {
  const tasks = (registry && Array.isArray(registry.tasks)) ? registry.tasks : [];
  const dates = weekDates(now);
  const live = tasks.filter((t) => t && t.enabled && t.cron && !HIDDEN.has(t.id)
    && t.agent !== 'infra' && TAG[t.agent]);
  const byId = new Map(live.map((t) => [t.id, t]));
  const grouped = new Set(GROUPS.flatMap((g) => g.members));

  const entries = [];
  for (const g of GROUPS) {
    const members = g.members.map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) continue;
    const crons = members.map((m) => m.cron).join(';');
    entries.push({ name: g.name, tag: g.tag, crons, title: members.map((m) => m.display_name || m.id).join(', ') });
  }
  for (const t of live) {
    if (grouped.has(t.id)) continue;
    entries.push({ name: NAMES[t.id] || t.display_name || t.name || t.id, tag: TAG[t.agent], crons: t.cron, title: t.description || '' });
  }

  const days = dates.map(() => []);
  for (const e of entries) {
    const pat = dayPattern(e.crons);
    const daily = pat === '0,1,2,3,4,5,6' || pat === WEEKDAYS;
    dates.forEach((d, i) => {
      if (cronFiresOn(e.crons, d)) days[i].push({ name: e.name, tag: e.tag, daily, title: e.title });
    });
  }
  days.forEach((list) => list.sort(byAgentThenName));
  return { dates, days };
}

export function byAgentThenName(a, b) {
  return (AGENT_ORDER.indexOf(a.tag) - AGENT_ORDER.indexOf(b.tag))
    || ((a.daily ? 1 : 0) - (b.daily ? 1 : 0))
    || String(a.name).localeCompare(String(b.name));
}
