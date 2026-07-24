// Vitals bar: reply streak + weekly XP, sourced from data/vitals/vitals-data.json (Task 4.1).
// Small standalone strip, not a tab — mounted at the top of the overview panel. Degrades to a
// muted placeholder (never throws, never blanks the page) when the JSON is missing/malformed.
// No emoji in rendered text per Eddie's rule.

import { esc } from '../util.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);

// int → "1,250" thousands-separated string. Non-finite input → null (caller decides placeholder).
export function fmtInt(n) {
  if (!num(n)) return null;
  return Math.round(n).toLocaleString('en-US');
}

// Pure formatting: vitals-data.json (or null/malformed) → the two label strings this widget shows.
// Exported standalone so it can be sanity-checked without touching the DOM.
// vitals-data.json currently has NO live producer (last written 2026-07-09), so a frozen file
// would otherwise show stale numbers forever. Treat data older than STALE_MS as "no data" — the
// widget degrades to "—" instead of lying with a static streak/XP. Remove once a producer writes
// this file on a cadence again.
const STALE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

export function formatVitals(data) {
  const genAt = data && data.generated_at ? Date.parse(data.generated_at) : NaN;
  const fresh = Number.isFinite(genAt) && (Date.now() - genAt) < STALE_MS;
  const streak = fresh && num(data.reply_streak) ? Math.round(data.reply_streak) : null;
  const xp = fresh && num(data.weekly_xp) ? data.weekly_xp : null;
  return {
    streakText: streak !== null ? `Reply streak: ${streak} day${streak === 1 ? '' : 's'}` : 'Reply streak: —',
    xpText: xp !== null ? `This week: ${fmtInt(xp)} XP` : 'This week: — XP',
  };
}

// ── Vitals bar (mockup pattern: .box.kpi reused at bar scale) ──────────────────
function vitalCard(value, label) {
  return `<div class="box kpi"><div class="big">${esc(value)}</div>`
    + `<div class="lbl">${esc(label)}</div></div>`;
}

export function renderVitals(data, mountEl) {
  const el = mountEl || document.getElementById('vitals-bar');
  if (!el) return;
  if (!data) {
    el.innerHTML = '';
    return;
  }
  const { streakText, xpText } = formatVitals(data);
  el.innerHTML = '<div class="grid cols-2">'
    + vitalCard(streakText, 'Accountability')
    + vitalCard(xpText, 'Weekly XP')
    + '</div>';
}
