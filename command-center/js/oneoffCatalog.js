// Job types a one-off can be placed as, per agent. Mirrors agent_framework/presets.yaml — the
// runner validates against that file, so a type listed here but missing there would be refused.
// test_oneoff_catalog_parity.py fails the build if the two drift.
// `available:false` agents are switched off in presets.yaml; they're listed (greyed) so the
// menu matches the roster, but the runner would refuse them.
export const ONEOFF_CATALOG = /*CATALOG-JSON*/{
  "finance": { "label": "Finance", "tag": "finance", "available": true, "job_types": {
    "thesis": "Investment Thesis", "dcf": "DCF Valuation", "market-scan": "Market Scan",
    "screen": "Company Screen", "free": "Custom" } },
  "research": { "label": "Research", "tag": "research", "available": true, "job_types": {
    "light": "Light Research", "medium": "Medium Research", "heavy": "Heavy Research" } },
  "health": { "label": "Health", "tag": "health", "available": false, "job_types": {
    "schedule": "Schedule Workouts", "recovery": "Recovery Review", "recipe": "Find Recipe",
    "deload": "Plan a Deload" } },
  "assistant": { "label": "Assistant", "tag": "assistant", "available": false, "job_types": {
    "focus": "Focus List", "planning": "Week Planning", "triage": "Inbox Triage" } },
  "career": { "label": "Career", "tag": "career", "available": false, "job_types": {
    "targets": "Target Firms", "outreach": "Outreach Drafts", "content": "LinkedIn Content" } },
  "tech": { "label": "Programming", "tag": "programming", "available": false, "job_types": {
    "audit": "Fleet Audit", "dependencies": "Dependency Check" } },
  "business": { "label": "Business", "tag": "business", "available": false, "job_types": {
    "social-brief": "Social Brief" } },
  "marketing": { "label": "Marketing", "tag": "marketing", "available": false, "job_types": {
    "content-plan": "Content Plan" } }
}/*END-CATALOG-JSON*/;
