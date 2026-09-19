"""Regenerate fsrs-golden-vectors.json from py-fsrs, the FSRS reference implementation.

The C# port (server/LinguaReadApi/Services/Srs) is checked against these vectors by
FsrsGoldenVectorTests. Regenerate only when deliberately moving to a new py-fsrs
release, and review the diff:

    python -m venv .venv
    .venv/Scripts/pip install fsrs==6.3.2      # .venv/bin/pip on Linux/macOS
    .venv/Scripts/python generate.py

Sequence timestamps are chosen so py-fsrs's elapsed days (floor of 24h spans) equal
calendar-day differences, which is what the C# scheduler counts with UTC offset 0 and
a midnight day start.
"""
import json
from datetime import datetime, timedelta, timezone
from importlib.metadata import version
from pathlib import Path

from fsrs import Card, Rating, Scheduler, State
from fsrs.scheduler import DEFAULT_PARAMETERS

START = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def formulas():
    s = Scheduler(enable_fuzzing=False)
    out = {"initial": [], "next_difficulty": [], "retrievability": [],
           "next_stability": [], "short_term_stability": [], "next_interval": []}

    for r in Rating:
        out["initial"].append({
            "rating": int(r),
            "stability": s._initial_stability(rating=r),
            "difficulty": s._initial_difficulty(rating=r, clamp=True),
        })

    for d in (1.0, 2.5, 5.0, 7.3, 10.0):
        for r in Rating:
            out["next_difficulty"].append({
                "difficulty": d, "rating": int(r),
                "expected": s._next_difficulty(difficulty=d, rating=r)})

    for stability in (0.3, 1.0, 7.5, 60.0):
        for elapsed in (0, 1, 3, 10, 45, 400):
            card = Card(state=State.Review, stability=stability, difficulty=5.0,
                        last_review=START, due=START)
            out["retrievability"].append({
                "stability": stability, "elapsed_days": elapsed,
                "expected": s.get_card_retrievability(card, START + timedelta(days=elapsed))})

    for d in (1.0, 5.0, 9.2):
        for stability in (0.5, 3.0, 20.0, 150.0):
            for retr in (0.5, 0.8, 0.95):
                for r in Rating:
                    out["next_stability"].append({
                        "difficulty": d, "stability": stability, "retrievability": retr,
                        "rating": int(r),
                        "expected": s._next_stability(difficulty=d, stability=stability,
                                                      retrievability=retr, rating=r)})

    for stability in (0.2, 1.0, 5.0, 40.0):
        for r in Rating:
            out["short_term_stability"].append({
                "stability": stability, "rating": int(r),
                "expected": s._short_term_stability(stability=stability, rating=r)})

    for retention in (0.7, 0.8, 0.9, 0.95, 0.97):
        for maximum in (36500, 30):
            sched = Scheduler(desired_retention=retention, maximum_interval=maximum, enable_fuzzing=False)
            for stability in (0.1, 1.0, 3.7, 12.0, 100.0, 1000.0):
                out["next_interval"].append({
                    "stability": stability, "desired_retention": retention, "maximum_interval": maximum,
                    "expected": sched._next_interval(stability=stability)})
    return out


# Each step is (rating, when) where `when` is one of:
#   ("min", n)    n minutes after the previous review (same calendar day)
#   ("day", n)    exactly n days after the previous review (same time of day)
#   ("due", f)    after the scheduled interval x f (days for Review cards, minutes on a step)
SCENARIOS = [
    {"name": "default_happy_path", "config": {},
     "steps": [("Good", None), ("Good", ("due", 1)), ("Good", ("due", 1)), ("Good", ("due", 1)),
               ("Hard", ("due", 1)), ("Easy", ("due", 1)), ("Again", ("due", 1)), ("Good", ("due", 1)),
               ("Good", ("due", 1)), ("Good", ("due", 1))]},
    {"name": "easy_from_new", "config": {},
     "steps": [("Easy", None), ("Easy", ("due", 1)), ("Good", ("due", 2)), ("Hard", ("due", 0.5))]},
    {"name": "struggling_learner", "config": {},
     "steps": [("Again", None), ("Hard", ("min", 1)), ("Again", ("min", 6)), ("Good", ("min", 1)),
               ("Good", ("min", 10)), ("Hard", ("due", 1)), ("Again", ("due", 1)), ("Again", ("min", 10)),
               ("Hard", ("min", 10)), ("Good", ("min", 15)), ("Good", ("due", 1)), ("Again", ("due", 3))]},
    {"name": "no_steps", "config": {"learning_steps": [], "relearning_steps": []},
     "steps": [("Good", None), ("Again", ("due", 1)), ("Good", ("due", 1)), ("Hard", ("due", 1)),
               ("Easy", ("due", 1))]},
    {"name": "single_steps", "config": {"learning_steps": [10], "relearning_steps": [5]},
     "steps": [("Hard", None), ("Hard", ("min", 15)), ("Good", ("min", 15)), ("Again", ("due", 1)),
               ("Hard", ("min", 7)), ("Good", ("min", 8)), ("Good", ("due", 1))]},
    {"name": "three_learning_steps", "config": {"learning_steps": [1, 10, 60], "relearning_steps": [10, 30]},
     "steps": [("Good", None), ("Hard", ("min", 1)), ("Good", ("min", 10)), ("Good", ("min", 60)),
               ("Again", ("due", 1)), ("Hard", ("min", 10)), ("Good", ("min", 20)), ("Good", ("min", 30)),
               ("Good", ("due", 1))]},
    {"name": "retention_80_max_30", "config": {"desired_retention": 0.8, "maximum_interval": 30},
     "steps": [("Good", None), ("Good", ("due", 1)), ("Good", ("due", 1)), ("Good", ("due", 1)),
               ("Good", ("due", 1)), ("Good", ("due", 1)), ("Easy", ("due", 1)), ("Good", ("due", 1))]},
    {"name": "retention_97", "config": {"desired_retention": 0.97},
     "steps": [("Good", None), ("Good", ("due", 1)), ("Good", ("due", 1)), ("Good", ("due", 1)),
               ("Hard", ("due", 1)), ("Good", ("due", 1))]},
    {"name": "early_and_late_reviews", "config": {},
     "steps": [("Good", None), ("Good", ("due", 1)), ("Good", ("due", 1)), ("Good", ("due", 0.4)),
               ("Good", ("due", 3)), ("Good", ("day", 1)), ("Again", ("day", 200)), ("Good", ("min", 10)),
               ("Good", ("due", 1))]},
    {"name": "same_day_review_state", "config": {},
     "steps": [("Easy", None), ("Good", ("min", 120)), ("Again", ("min", 60)), ("Good", ("min", 10)),
               ("Hard", ("min", 30)), ("Good", ("due", 1))]},
]


def scheduler_for(config):
    return Scheduler(
        learning_steps=tuple(timedelta(minutes=m) for m in config.get("learning_steps", [1, 10])),
        relearning_steps=tuple(timedelta(minutes=m) for m in config.get("relearning_steps", [10])),
        desired_retention=config.get("desired_retention", 0.9),
        maximum_interval=config.get("maximum_interval", 36500),
        enable_fuzzing=False,
    )


def run_scenario(scenario):
    sched = scheduler_for(scenario["config"])
    card = Card()
    now = START
    last_interval = None
    reviews = []
    for rating_name, when in scenario["steps"]:
        if when is not None:
            kind, amount = when
            if kind == "min":
                now = now + timedelta(minutes=amount)
            elif kind == "day":
                now = now + timedelta(days=amount)
            elif last_interval >= timedelta(days=1):
                now = now + timedelta(days=max(1, round(last_interval.days * amount)))
            else:
                now = now + last_interval * amount
        if card.last_review is not None:
            floor_days = (now - card.last_review).days
            calendar_days = (now.date() - card.last_review.date()).days
            assert floor_days == calendar_days, (scenario["name"], now, card.last_review)
        card, _ = sched.review_card(card, Rating[rating_name], now)
        last_interval = card.due - now
        reviews.append({
            "rating": int(Rating[rating_name]),
            "reviewed_at": now.isoformat().replace("+00:00", "Z"),
            "state": card.state.name,
            "step": card.step,
            "stability": card.stability,
            "difficulty": card.difficulty,
            "interval_seconds": last_interval.total_seconds(),
        })
    return {"name": scenario["name"], "config": {
        "learning_steps": scenario["config"].get("learning_steps", [1, 10]),
        "relearning_steps": scenario["config"].get("relearning_steps", [10]),
        "desired_retention": scenario["config"].get("desired_retention", 0.9),
        "maximum_interval": scenario["config"].get("maximum_interval", 36500),
    }, "reviews": reviews}


def main():
    data = {
        "generator": f"py-fsrs {version('fsrs')}",
        "parameters": list(DEFAULT_PARAMETERS),
        "formulas": formulas(),
        "sequences": [run_scenario(s) for s in SCENARIOS],
    }
    target = Path(__file__).with_name("fsrs-golden-vectors.json")
    target.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
