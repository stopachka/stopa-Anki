#!/usr/bin/env python3
"""Generate scheduler fixtures with the unmodified official Anki 26.09.4 core.

Run with a Python environment containing `anki==26.09.4`. All collections are
created in an automatically removed temporary directory; user collections are
never opened. ANKI_TEST_MODE disables random fuzz, as in Anki's own Python tests.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
import sys
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

FUZZ_ENABLED = "--fuzz" in sys.argv
if FUZZ_ENABLED:
    os.environ.pop("ANKI_TEST_MODE", None)
else:
    os.environ["ANKI_TEST_MODE"] = "1"
os.environ["TZ"] = "UTC"
if hasattr(time, "tzset"):
    time.tzset()

from anki.collection import Collection
from anki.cards import FSRSMemoryState
from anki.scheduler.v3 import CardAnswer
from google.protobuf.json_format import MessageToDict

REFERENCE_VERSION = "26.09.4"
REFERENCE_COMMIT = "c06370ff4d87cb48d825f90cc83e02b9a4e84ecd"


def iso(seconds: int) -> str:
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def proto(value):
    return MessageToDict(value, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)


def normalized(state):
    normal = state["normal"]
    if "new" in normal:
        return {"state": 0}
    if "relearning" in normal:
        learning = normal["relearning"]["learning"]
        review = normal["relearning"]["review"]
        kind = 3
    else:
        learning = normal.get("learning")
        review = normal.get("review")
        kind = 1 if learning else 2
    memory = (learning or review).get("memory_state")
    result = {
        "state": kind,
        "scheduledDays": (review or {}).get("scheduled_days", 0),
        "lapses": (review or {}).get("lapses", 0),
        "stability": memory["stability"],
        "difficulty": memory["difficulty"],
    }
    if learning:
        result.update(remainingSteps=learning.get("remaining_steps", 0), scheduledSeconds=learning.get("scheduled_secs", 0))
    if review:
        result["easeFactor"] = review.get("ease_factor", 2.5)
    return result


def make_case(name, *, state=0, stability=0.0, difficulty=0.0, elapsed_days=0,
              elapsed_seconds=0, remaining_steps=0, scheduled_seconds=0,
              interval=0, lapses=0, retention=0.9, maximum_interval=36500,
              seed_id=None, reps_override=None):
    with tempfile.TemporaryDirectory(prefix="stopa-anki-oracle-") as directory:
        col = Collection(str(Path(directory) / "collection.anki2"))
        try:
            col.set_config("fsrs", True)
            col.load_balancer_enabled = False
            prefs = col.get_preferences()
            prefs.scheduling.rollover = 4
            prefs.scheduling.learn_ahead_secs = 1200
            col.set_preferences(prefs)
            config = col.decks.get_config(1)
            config["new"]["delays"] = [1, 10]
            config["lapse"]["delays"] = [1]
            config["desiredRetention"] = retention
            config["rev"]["maxIvl"] = maximum_interval
            col.decks.update_config(config)
            note = col.new_note(col.models.by_name("Basic"))
            note["Front"], note["Back"] = name, "reference only"
            col.add_note(note, 1)
            card = note.cards()[0]
            if seed_id is not None:
                col.db.execute("update cards set id=? where id=?", seed_id, card.id)
                card = col.get_card(seed_id)
            now = int(time.time())
            timing = col._backend.sched_timing_today()
            today = timing.days_elapsed
            last_review = now - elapsed_days * 86400 - elapsed_seconds
            card.type = state
            card.queue = 1 if state in (1, 3) else state
            card.reps = 0 if state == 0 else (1 if state == 1 else 8)
            if reps_override is not None:
                card.reps = reps_override
            card.lapses = lapses
            card.ivl = interval
            card.factor = 2500
            card.left = remaining_steps
            if state:
                card.memory_state = FSRSMemoryState(stability=stability, difficulty=difficulty)
                card.last_review_time = last_review
            if state in (1, 3):
                card.due = last_review + scheduled_seconds
            elif state == 2:
                card.due = today + interval - elapsed_days
            col.update_card(card)
            # Anki stores S/D with reduced precision; compare against the state
            # actually read by the Rust scheduler, not the pre-save Python object.
            card = col.get_card(card.id)
            states = col._backend.get_scheduling_states(card.id)
            raw = proto(states)
            memory = card.memory_state
            day_due = today + interval - elapsed_days
            due_timestamp = (timing.next_day_at - 86400 + (day_due - today) * 86400) if state == 2 else card.due
            source_card = {
                "cardId": name, "state": state,
                "stability": float(memory.stability) if memory else 0,
                "difficulty": float(memory.difficulty) if memory else 0,
                "reps": card.reps, "lapses": lapses, "scheduledDays": interval,
                "scheduleStatus": "new" if state == 0 else "review" if state == 2 else "learning",
                "dueAt": iso(now if state == 0 else due_timestamp),
                "lastReviewAt": iso(last_review) if state else None,
                "learningStep": max(0, (1 if state == 3 else 2) - remaining_steps) if state in (1, 3) else 0,
                "anki": {"remainingSteps": remaining_steps, "scheduledSeconds": scheduled_seconds, "easeFactor": 2.5},
            }
            if seed_id is not None:
                source_card["anki"]["seedId"] = seed_id
            output = {
                "name": name, "now": iso(now), "card": source_card,
                "options": {"enableFuzz": FUZZ_ENABLED, "desiredRetention": retention, "maximumInterval": maximum_interval},
                "elapsedFsrsDays": (timing.next_day_at - last_review) // 86400 if state else 0,
                "currentState": raw["current"],
                "expected": {str(index): normalized(raw[label]) for index, label in enumerate(["again", "hard", "good", "easy"], 1)},
                "rawStates": raw,
            }
            if FUZZ_ENABLED and state == 0:
                applied = {}
                for grade, rating in [(1, CardAnswer.AGAIN), (3, CardAnswer.GOOD)]:
                    for attempt in range(3):
                        card.start_timer()
                        answer = col.sched.build_answer(card=card, states=states, rating=rating)
                        before = int(time.time())
                        col.sched.answer_card(answer)
                        after = int(time.time())
                        card.load()
                        seconds = card.due - answer.answered_at_millis // 1000
                        col.undo()
                        card.load()
                        if before == after:
                            applied[str(grade)] = seconds
                            break
                    else:
                        raise RuntimeError("Could not capture a stable-second learning fuzz sample")
                output["appliedLearningSeconds"] = applied
            return output
        finally:
            col.close()


def make_queue_case(name, cards, limit=10):
    with tempfile.TemporaryDirectory(prefix="stopa-anki-queue-oracle-") as directory:
        col = Collection(str(Path(directory) / "collection.anki2"))
        try:
            col.set_config("fsrs", True)
            col.load_balancer_enabled = False
            config = col.decks.get_config(1)
            config["new"]["perDay"] = limit
            config["rev"]["perDay"] = 9999
            config["newMix"] = 1  # NEW_MIX_AFTER_REVIEWS, as in this app.
            col.decks.update_config(config)
            timing = col._backend.sched_timing_today()
            now = int(time.time())
            identifiers = {}
            for index, definition in enumerate(cards):
                note = col.new_note(col.models.by_name("Basic"))
                note["Front"], note["Back"] = definition["wordId"], "reference only"
                col.add_note(note, 1)
                card = note.cards()[0]
                identifiers[card.id] = definition["wordId"]
                state = definition["state"]
                card.type, card.queue = state, state
                if state == 0:
                    card.due = index + 1
                elif state == 1:
                    card.due = now + definition["dueOffsetSeconds"]
                    card.left = 1
                    card.reps = 1
                    card.last_review_time = card.due - 600
                    card.memory_state = FSRSMemoryState(stability=2.3065, difficulty=2.118104)
                else:
                    card.due = timing.days_elapsed + definition.get("dueOffsetDays", 0)
                    card.ivl = 1
                    card.reps = 1
                    card.factor = 2500
                    card.last_review_time = now - 86400
                    card.memory_state = FSRSMemoryState(stability=1, difficulty=5)
                col.update_card(card)
            queued = col.sched.get_queued_cards()
            return {"name": name, "now": iso(now), "cards": cards, "newLimit": limit,
                    "expected": {"nextWordId": identifiers[queued.cards[0].card.id] if queued.cards else None,
                                 "newCount": queued.new_count, "learningCount": queued.learning_count, "reviewCount": queued.review_count}}
        finally:
            col.close()


def make_learning_sequence():
    with tempfile.TemporaryDirectory(prefix="stopa-anki-queue-sequence-") as directory:
        col = Collection(str(Path(directory) / "collection.anki2"))
        try:
            col.set_config("fsrs", True)
            col.load_balancer_enabled = False
            now = int(time.time())
            identifiers = {}
            ids = []
            for name, delay in [("a", 60), ("b", 600)]:
                note = col.new_note(col.models.by_name("Basic"))
                note["Front"], note["Back"] = name, "reference only"
                col.add_note(note, 1)
                card = note.cards()[0]
                ids.append(card.id)
                identifiers[card.id] = name
                card.type = card.queue = 1
                card.left, card.reps = 1, 1
                card.due = now + delay
                card.last_review_time = card.due - 600
                card.memory_state = FSRSMemoryState(stability=2.3065, difficulty=2.118104)
                col.update_card(card)
            order = []
            for grade in [CardAnswer.AGAIN, CardAnswer.GOOD]:
                queued = col.sched.get_queued_cards()
                entry = queued.cards[0]
                order.append(identifiers[entry.card.id])
                card = col.get_card(entry.card.id)
                card.start_timer()
                answer = col.sched.build_answer(card=card, states=entry.states, rating=grade)
                col.sched.answer_card(answer)
            final = col.sched.get_queued_cards()
            order.append(identifiers[final.cards[0].card.id] if final.cards else None)
            a = col.get_card(ids[0])
            return {"name": "learn-ahead-requeue-spacing", "now": iso(now),
                    "cards": [{"wordId": "a", "state": 1, "dueOffsetSeconds": 60}, {"wordId": "b", "state": 1, "dueOffsetSeconds": 600}],
                    "ratings": [1, 3], "expectedOrder": order,
                    "firstCardStoredDelayAfterAgain": a.due - a.last_review_time}
        finally:
            col.close()


def make_interday_sequence():
    with tempfile.TemporaryDirectory(prefix="stopa-anki-interday-sequence-") as directory:
        col = Collection(str(Path(directory) / "collection.anki2"))
        try:
            col.set_config("fsrs", True)
            col.load_balancer_enabled = False
            config = col.decks.get_config(1)
            config["newMix"] = 1
            config["interdayLearningMix"] = 0
            col.decks.update_config(config)
            now = int(time.time())
            timing = col._backend.sched_timing_today()
            identifiers = {}
            definitions = [
                {"wordId": "r1", "state": 2, "dueOffsetDays": -3},
                {"wordId": "r2", "state": 2, "dueOffsetDays": -2},
                {"wordId": "r3", "state": 2, "dueOffsetDays": -1},
                {"wordId": "l1", "state": 1, "dueOffsetDays": -2},
                {"wordId": "l2", "state": 1, "dueOffsetDays": -1},
            ]
            for definition in definitions:
                note = col.new_note(col.models.by_name("Basic"))
                note["Front"], note["Back"] = definition["wordId"], "reference only"
                col.add_note(note, 1)
                card = note.cards()[0]
                identifiers[card.id] = definition["wordId"]
                card.type = definition["state"]
                card.queue = 3 if card.type == 1 else 2
                card.due = timing.days_elapsed + definition["dueOffsetDays"]
                card.ivl = 2 if card.type == 2 else 0
                card.left, card.reps, card.factor = 1, 1, 2500
                card.last_review_time = now - 4 * 86400
                card.memory_state = FSRSMemoryState(stability=2.3065, difficulty=2.118104)
                col.update_card(card)
            order = []
            for _ in range(5):
                queued = col.sched.get_queued_cards()
                entry = queued.cards[0]
                order.append(identifiers[entry.card.id])
                card = col.get_card(entry.card.id)
                card.start_timer()
                col.sched.answer_card(col.sched.build_answer(card=card, states=entry.states, rating=CardAnswer.GOOD))
            return {"name": "interday-learning-mixed-with-reviews", "now": iso(now), "cards": definitions,
                    "ratings": [3, 3, 3, 3, 3], "expectedOrder": order}
        finally:
            col.close()


def make_review_sequence(name, ratings, review_when_due):
    """Apply successive real answers, reloading persisted S/D before each one.

    Rust reads the real clock. For a days-later step, shift only the synthetic
    card's timestamps back by the recorded rebase so its next review is due now.
    Memory, reps, lapses, steps, and prior interval remain those Anki persisted.
    """
    with tempfile.TemporaryDirectory(prefix="stopa-anki-review-sequence-") as directory:
        col = Collection(str(Path(directory) / "collection.anki2"))
        try:
            col.set_config("fsrs", True)
            col.load_balancer_enabled = False
            config = col.decks.get_config(1)
            config["new"]["delays"] = [1, 10]
            config["lapse"]["delays"] = [1]
            config["desiredRetention"] = 0.9
            col.decks.update_config(config)
            note = col.new_note(col.models.by_name("Basic"))
            note["Front"], note["Back"] = name, "reference only"
            col.add_note(note, 1)
            card = note.cards()[0]
            seed_id = 1700000000100
            col.db.execute("update cards set id=? where id=?", seed_id, card.id)
            card = col.get_card(seed_id)
            last_scheduled_seconds = 0

            def stored_card(card, now):
                timing = col._backend.sched_timing_today()
                is_day_queue = card.queue in (2, 3)
                due_timestamp = timing.next_day_at - 86400 + (card.due - timing.days_elapsed) * 86400 if is_day_queue else card.due
                metadata = {"version": 1, "seedId": str(seed_id), "remainingSteps": card.left % 1000,
                            "scheduledSeconds": last_scheduled_seconds, "easeFactor": card.factor / 1000 if card.factor else 2.5}
                if is_day_queue:
                    metadata["dueDay"] = datetime.fromtimestamp(due_timestamp, timezone.utc).strftime("%Y-%m-%d")
                memory = card.memory_state
                return {"cardId": str(seed_id), "state": card.type,
                        "stability": float(memory.stability) if memory else 0,
                        "difficulty": float(memory.difficulty) if memory else 0,
                        "reps": card.reps, "lapses": card.lapses, "scheduledDays": card.ivl,
                        "scheduleStatus": "new" if card.type == 0 else "review" if card.type == 2 else "learning",
                        "dueAt": iso(now if card.type == 0 else due_timestamp),
                        "lastReviewAt": iso(card.last_review_time) if card.last_review_time is not None else None,
                        "learningStep": max(0, (1 if card.type == 3 else 2) - (card.left % 1000)) if card.type in (1, 3) else 0,
                        "anki": metadata}

            initial = stored_card(card, int(time.time()))
            steps = []
            for index, grade in enumerate(ratings):
                now = int(time.time())
                temporal_rebase = {"seconds": 0, "reviewDueDays": 0}
                if index and review_when_due:
                    if card.queue in (2, 3):
                        days = card.due - col._backend.sched_timing_today().days_elapsed
                        shift = now - card.last_review_time - days * 86400
                        card.due -= days
                        temporal_rebase = {"seconds": shift, "reviewDueDays": -days}
                    else:
                        shift = now - card.due
                        card.due += shift
                        temporal_rebase["seconds"] = shift
                    card.last_review_time += shift
                    col.update_card(card)
                    card = col.get_card(seed_id)
                input_card = stored_card(card, now)
                states = col._backend.get_scheduling_states(card.id)
                chosen = proto(states)[["again", "hard", "good", "easy"][grade - 1]]
                normalized_chosen = normalized(chosen)
                last_scheduled_seconds = normalized_chosen.get("scheduledSeconds", 0)
                card.start_timer()
                answer = col.sched.build_answer(card=card, states=states, rating=grade - 1)
                # CardAnswer enum values are zero-based, unlike the public 1-4 buttons.
                col.sched.answer_card(answer)
                card = col.get_card(seed_id)
                steps.append({"now": iso(now), "rating": grade, "temporalRebase": temporal_rebase,
                              "inputCard": input_card, "expectedState": normalized_chosen,
                              "expectedCard": stored_card(card, now), "rawStates": proto(states)})
            return {"name": name, "options": {"enableFuzz": False, "desiredRetention": 0.9},
                    "initialCard": initial, "steps": steps}
        finally:
            col.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fuzz", action="store_true", help="Generate production RNG vectors with canonical card IDs")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if version("anki") != REFERENCE_VERSION:
        raise SystemExit(f"Expected anki=={REFERENCE_VERSION}; found {version('anki')}")
    if args.output is None:
        args.output = Path(__file__).resolve().parents[1] / "src/lib/__fixtures__" / ("anki-fuzz-reference.json" if args.fuzz else "anki-reference.json")
    cases = [] if args.fuzz else [
        make_case("new"),
        make_case("learning-first-step-due", state=1, stability=.212, difficulty=6.4133, elapsed_seconds=60, remaining_steps=2, scheduled_seconds=60),
        make_case("learning-first-step-early", state=1, stability=.212, difficulty=6.4133, elapsed_seconds=10, remaining_steps=2, scheduled_seconds=60),
        make_case("learning-second-step-due", state=1, stability=2.3065, difficulty=2.118104, elapsed_seconds=600, remaining_steps=1, scheduled_seconds=600),
        make_case("learning-second-step-early", state=1, stability=2.3065, difficulty=2.118104, elapsed_seconds=0, remaining_steps=1, scheduled_seconds=600),
        make_case("learning-second-step-next-day", state=1, stability=2.3065, difficulty=2.118104, elapsed_days=1, elapsed_seconds=600, remaining_steps=1, scheduled_seconds=600),
        make_case("review-on-time", state=2, stability=30, difficulty=5, elapsed_days=30, interval=30),
        make_case("review-early", state=2, stability=30, difficulty=5, elapsed_days=10, interval=30),
        make_case("review-overdue", state=2, stability=30, difficulty=5, elapsed_days=45, interval=30),
        make_case("review-near-maximum", state=2, stability=10000, difficulty=3, elapsed_days=10000, interval=10000),
        make_case("review-maximum-three-days", state=2, stability=30, difficulty=5, elapsed_days=30, interval=30, maximum_interval=3),
        make_case("relearning-due", state=3, stability=2.5, difficulty=7, elapsed_seconds=60, remaining_steps=1, scheduled_seconds=60, interval=3, lapses=2),
        make_case("relearning-next-day", state=3, stability=2.5, difficulty=7, elapsed_days=1, elapsed_seconds=60, remaining_steps=1, scheduled_seconds=60, interval=3, lapses=2),
    ]
    if args.fuzz:
        for seed_id in [1700000000001, 1700000000002]:
            for reps in [0, 1, 7]:
                cases.append(make_case(f"fuzz-new-{seed_id}-reps{reps}", seed_id=seed_id, reps_override=reps))
                cases.append(make_case(f"fuzz-review-{seed_id}-reps{reps}", state=2, stability=30, difficulty=5, elapsed_days=30, interval=30, seed_id=seed_id, reps_override=reps))
    else:
        for retention in [.9, .95]:
            for elapsed in [0, 1, 10, 365]:
                cases.append(make_case(f"memory-s10-d5-elapsed{elapsed}-retention{retention}", state=2, stability=10, difficulty=5, elapsed_days=elapsed, interval=10, retention=retention))
    output = {
        "source": {"package": f"anki=={REFERENCE_VERSION}", "commit": REFERENCE_COMMIT,
                   "url": f"https://github.com/ankitects/anki/tree/{REFERENCE_COMMIT}",
                   "fuzz": "production StdRng with canonical card IDs" if args.fuzz else "disabled with ANKI_TEST_MODE=1 (Anki's own Python test mode)",
                   "loadBalancerEnabled": False, "timezone": "UTC", "rolloverHour": 4,
                   "learningStepsMinutes": [1, 10], "relearningStepsMinutes": [1]},
        "cases": cases,
    }
    if not args.fuzz:
        new = {"wordId": "new", "state": 0}
        review = {"wordId": "review", "state": 2, "dueOffsetDays": 0}
        learning = {"wordId": "learning", "state": 1, "dueOffsetSeconds": 600}
        due_learning = {**learning, "dueOffsetSeconds": -60}
        output["queueCases"] = [
            make_queue_case("due-learning-before-new", [new, due_learning]),
            make_queue_case("due-learning-before-review", [review, due_learning]),
            make_queue_case("new-before-ahead-learning", [learning, new]),
            make_queue_case("review-before-ahead-learning", [learning, review]),
            make_queue_case("learn-ahead-when-alone", [learning]),
            make_queue_case("beyond-learn-ahead", [{**learning, "dueOffsetSeconds": 1260}]),
            make_queue_case("future-review-is-not-learn-ahead", [{**review, "dueOffsetDays": 1}]),
            make_queue_case("exhausted-new-limit-still-learns-ahead", [new, learning], limit=0),
            make_queue_case("review-before-new", [new, review]),
        ]
        output["queueSequenceCases"] = [make_learning_sequence(), make_interday_sequence()]
        output["reviewSequenceCases"] = [
            make_review_sequence("repeated-learning-with-persisted-memory", [1, 2, 3, 3, 1, 3, 4], False),
            make_review_sequence("due-review-lapse-and-relearning", [3, 3, 3, 1, 2, 3, 3, 4], True),
        ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(cases)} Anki reference cases ({len(cases) * 4} rating outcomes) to {args.output}")


if __name__ == "__main__":
    main()
