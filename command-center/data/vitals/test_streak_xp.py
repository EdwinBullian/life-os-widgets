"""Tests for reply-streak + weekly-XP compute (Task 4.1).

Pure logic + dependency-injection only — no live network, no live sqlite db.
Run from the Agent dir:
    cd "C:/Users/edwin/OneDrive/Desktop/Claude/Agent"
    python -m pytest command-center/data/vitals/test_streak_xp.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from streak_xp import build_payload, monday_of, reply_streak, weekly_xp


# ---------------------------------------------------------------------------
# reply_streak
# ---------------------------------------------------------------------------

def test_reply_streak_today_incomplete_counts_prior_two_days():
    acks = {
        "2026-07-06": {"morning", "evening"},
        "2026-07-07": {"morning", "evening"},
        "2026-07-08": {"morning"},
    }
    assert reply_streak(acks, "2026-07-08") == 2


def test_reply_streak_gap_breaks_streak():
    acks = {
        "2026-07-05": {"morning", "evening"},
        "2026-07-07": {"morning", "evening"},
    }
    # 07-06 missing entirely -> streak is just the 7th
    assert reply_streak(acks, "2026-07-07") == 1


def test_reply_streak_both_today_counts():
    acks = {"2026-07-08": {"morning", "evening"}}
    assert reply_streak(acks, "2026-07-08") == 1


def test_reply_streak_empty_acks_is_zero():
    assert reply_streak({}, "2026-07-08") == 0


def test_reply_streak_longer_run():
    acks = {
        "2026-07-04": {"morning", "evening"},
        "2026-07-05": {"morning", "evening"},
        "2026-07-06": {"morning", "evening"},
        "2026-07-07": {"morning", "evening"},
    }
    assert reply_streak(acks, "2026-07-07") == 4


def test_reply_streak_day_missing_one_kind_breaks():
    acks = {
        "2026-07-06": {"morning"},  # evening missing
        "2026-07-07": {"morning", "evening"},
    }
    assert reply_streak(acks, "2026-07-07") == 1


# ---------------------------------------------------------------------------
# weekly_xp
# ---------------------------------------------------------------------------

def _fake_pages(numbers):
    pages = []
    for n in numbers:
        pages.append({
            "properties": {
                "XP Earned": {"formula": {"number": n}},
            }
        })
    return pages


def test_weekly_xp_sums_and_guards_none():
    captured = {}

    def fake_query(database_id, filter_payload=None):
        captured["database_id"] = database_id
        captured["filter_payload"] = filter_payload
        return _fake_pages([100, 50, None])

    total = weekly_xp(query=fake_query, today="2026-07-08")
    assert total == 150


def test_weekly_xp_filter_payload_shape():
    captured = {}

    def fake_query(database_id, filter_payload=None):
        captured["filter_payload"] = filter_payload
        return _fake_pages([10])

    weekly_xp(query=fake_query, today="2026-07-08")  # Wed -> Monday 2026-07-06

    payload = captured["filter_payload"]
    assert payload is not None
    conditions = payload["and"]

    # Must contain a Status Done condition and a Due on_or_after Monday condition.
    has_status_done = any(
        c.get("property") == "Status"
        and c.get("status", {}).get("equals") == "Done"
        for c in conditions
    )
    has_due_monday = any(
        c.get("property") == "Due"
        and c.get("date", {}).get("on_or_after") == "2026-07-06"
        for c in conditions
    )
    assert has_status_done, f"missing Status Done condition: {conditions}"
    assert has_due_monday, f"missing Due on_or_after Monday condition: {conditions}"


def test_weekly_xp_empty_pages_is_zero():
    total = weekly_xp(query=lambda db, filter_payload=None: [], today="2026-07-08")
    assert total == 0


def test_weekly_xp_missing_formula_key_guarded():
    def fake_query(database_id, filter_payload=None):
        return [{"properties": {}}, {"properties": {"XP Earned": {}}}]

    total = weekly_xp(query=fake_query, today="2026-07-08")
    assert total == 0


def test_monday_of_wednesday():
    assert monday_of("2026-07-08") == "2026-07-06"


def test_monday_of_monday_is_itself():
    assert monday_of("2026-07-06") == "2026-07-06"


def test_monday_of_sunday():
    assert monday_of("2026-07-12") == "2026-07-06"


# ---------------------------------------------------------------------------
# build_payload
# ---------------------------------------------------------------------------

def test_build_payload_shape():
    payload = build_payload(streak=3, xp=250, generated_at="2026-07-08T12:00:00")
    assert payload == {
        "reply_streak": 3,
        "weekly_xp": 250,
        "generated_at": "2026-07-08T12:00:00",
    }
