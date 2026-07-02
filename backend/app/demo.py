"""Put the seeded demo plan mid-service for screenshots and development.

``python -m app.demo --minutes-to-serve 40`` moves the demo plan's serve
time to now + N minutes, recomputes the schedule, marks every step that
would already have happened as done (or running), and opens a live cook
session — as if you had been cooking along the whole time.
"""

import argparse
from datetime import timedelta

from sqlmodel import Session, SQLModel, select

from app.core.config import Settings
from app.core.db import make_engine
from app.core.timeutil import iso_utc, utcnow
from app.models import CookSession, MealPlan
from app.scheduler import compute_schedule
from app.seed import DEMO_PLAN_NAME
from app.services.planning import plan_resources, plan_steps


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--minutes-to-serve",
        type=int,
        default=40,
        help="how far from serving the session should look (default 40)",
    )
    args = parser.parse_args()

    settings = Settings()
    engine = make_engine(settings.database_url)
    SQLModel.metadata.create_all(engine)

    with Session(engine) as db:
        plan = db.exec(select(MealPlan).where(MealPlan.name == DEMO_PLAN_NAME)).first()
        if plan is None:
            raise SystemExit("Demo plan not found — run `python -m app.seed` first.")

        now = utcnow().replace(second=0, microsecond=0)
        plan.serve_at = now + timedelta(minutes=args.minutes_to_serve)
        db.add(plan)

        steps, _, _ = plan_steps(db, plan)
        schedule = compute_schedule(steps, plan_resources(plan))

        progress: dict[str, dict] = {}
        for placement in schedule.placements:
            start = plan.serve_at + timedelta(minutes=placement.start)
            end = plan.serve_at + timedelta(minutes=placement.end)
            if end <= now:
                progress[placement.step.id] = {
                    "status": "done",
                    "started_at": iso_utc(start),
                    "finished_at": iso_utc(end),
                    "extra_min": 0,
                }
            elif start <= now:
                progress[placement.step.id] = {
                    "status": "running",
                    "started_at": iso_utc(start),
                    "extra_min": 0,
                }

        for stale in db.exec(select(CookSession).where(CookSession.plan_id == plan.id)).all():
            db.delete(stale)
        session = CookSession(plan_id=plan.id, progress=progress)
        db.add(session)
        db.commit()
        db.refresh(session)

        done = sum(1 for p in progress.values() if p["status"] == "done")
        running = sum(1 for p in progress.values() if p["status"] == "running")
        print(f"Session {session.id}: {done} steps done, {running} running.")
        print(f"Open http://localhost:8000/cook/{session.id}")


if __name__ == "__main__":
    main()
