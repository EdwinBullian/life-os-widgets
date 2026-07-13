"""Reply-streak + weekly-XP compute -> vitals-data.json (Task 4.1).

Two data sources:
  - reply_streak: consecutive fully-acked days from the bridge daemon's SQLite
    `ack` table (day TEXT, kind TEXT 'morning'|'evening', ts REAL,
    UNIQUE(day, kind)). Live DB: C:\\ProgramData\\phone_link_bridge\\bridge.db
    (per-machine, outside any repo).
  - weekly_xp: sum of the Notion Task-Manager `XP Earned` formula field for
    tasks Done with Due >= the Monday of the current week.

This script only computes + writes a LOCAL vitals-data.json. It does not
push to GitHub — that is a separate operator step (see command-center's
publish tooling / sync-to-deploy.ps1).
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable

import sys

AGENT_DIR = Path(__file__).resolve().parents[3]  # .../Agent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

TASK_MANAGER_DB_ID = "c87931c9-3b5f-4721-bd2f-946204b76d25"
DEFAULT_ACK_DB_PATH = Path(r"C:\ProgramData\phone_link_bridge\bridge.db")

QueryFn = Callable[..., list[dict]]


# ---------------------------------------------------------------------------
# reply_streak
# ---------------------------------------------------------------------------

def reply_streak(acks: dict[str, set], today: str) -> int:
    """Count consecutive fully-acked days walking backwards from `today`.

    A day counts only if it has BOTH 'morning' and 'evening' in its ack set.
    `today` itself only counts if complete; the very first incomplete/missing
    day (including an incomplete `today`) stops the walk without counting.
    """
    streak = 0
    cursor = datetime.strptime(today, "%Y-%m-%d").date()

    today_kinds = acks.get(cursor.isoformat(), set())
    if "morning" not in today_kinds or "evening" not in today_kinds:
        # Incomplete (or missing) today doesn't break the streak, it's just
        # not counted — start walking from yesterday instead.
        cursor -= timedelta(days=1)

    while True:
        day_str = cursor.isoformat()
        kinds = acks.get(day_str, set())
        if "morning" in kinds and "evening" in kinds:
            streak += 1
            cursor -= timedelta(days=1)
        else:
            break
    return streak


def _read_acks(db_path=DEFAULT_ACK_DB_PATH, *, days: int = 60) -> dict[str, set]:
    """Thin read-only SQLite read of the bridge daemon's `ack` table.

    Returns {day (YYYY-MM-DD): {kind, ...}}. Not unit-tested live — DI seam
    for callers is the `acks` dict itself, not this function.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        return {}

    cutoff = (date.today() - timedelta(days=days)).isoformat()
    uri = f"file:{db_path.as_posix()}?mode=ro"
    acks: dict[str, set] = {}
    conn = sqlite3.connect(uri, uri=True)
    try:
        cur = conn.execute(
            "SELECT day, kind FROM ack WHERE day >= ?", (cutoff,)
        )
        for day, kind in cur.fetchall():
            acks.setdefault(day, set()).add(kind)
    finally:
        conn.close()
    return acks


# ---------------------------------------------------------------------------
# weekly_xp
# ---------------------------------------------------------------------------

def monday_of(today: str) -> str:
    """Monday (YYYY-MM-DD) of the ISO week containing `today` (YYYY-MM-DD)."""
    d = datetime.strptime(today, "%Y-%m-%d").date()
    monday = d - timedelta(days=d.weekday())  # Monday == weekday() 0
    return monday.isoformat()


def _default_query(database_id: str, filter_payload: dict | None = None) -> list[dict]:
    from agent_framework.integrations.notion_client import NotionClient

    client = NotionClient()
    return client.query_database(database_id, filter_payload=filter_payload)


def weekly_xp(*, query: QueryFn | None = None, today: str | None = None) -> int:
    """Sum `XP Earned` (formula.number) for tasks Done with Due >= this Monday.

    `query` is a DI seam: callable(database_id, filter_payload=None) -> list[pages].
    Defaults to the real NotionClient.query_database against the Task Manager DB.
    """
    if today is None:
        today = date.today().isoformat()
    if query is None:
        query = _default_query

    monday = monday_of(today)
    filter_payload = {
        "and": [
            {"property": "Status", "status": {"equals": "Done"}},
            {"property": "Due", "date": {"on_or_after": monday}},
        ]
    }

    pages = query(TASK_MANAGER_DB_ID, filter_payload=filter_payload)

    total = 0
    for page in pages or []:
        formula = (
            (page.get("properties") or {})
            .get("XP Earned", {})
            .get("formula", {})
        )
        number = formula.get("number")
        if isinstance(number, (int, float)):
            total += number
    return int(total)


# ---------------------------------------------------------------------------
# payload
# ---------------------------------------------------------------------------

def build_payload(*, streak: int, xp: int, generated_at: str) -> dict:
    return {"reply_streak": streak, "weekly_xp": xp, "generated_at": generated_at}


def write_vitals_json(payload: dict, path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# script entry point
# ---------------------------------------------------------------------------

def main() -> None:
    today = date.today().isoformat()
    acks = _read_acks()
    streak = reply_streak(acks, today)
    xp = weekly_xp(today=today)
    generated_at = datetime.now().isoformat()

    payload = build_payload(streak=streak, xp=xp, generated_at=generated_at)
    out_path = Path(__file__).resolve().parent / "vitals-data.json"
    write_vitals_json(payload, out_path)
    print(f"wrote {out_path}: {payload}")


if __name__ == "__main__":
    main()
