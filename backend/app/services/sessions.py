"""Live cook sessions: apply kitchen events, replan, broadcast to every device."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import WebSocket
from sqlmodel import Session, select

from app.core.timeutil import iso_utc, parse_utc, utcnow
from app.models import CookSession, MealPlan
from app.scheduler import PlanStep, Resources, StepProgress, replan
from app.services.planning import plan_resources, plan_steps


class SessionEventError(ValueError):
    """The event does not apply to the current session state."""


class SessionRuntime:
    """In-memory state of one cook session.

    ``progress`` maps step id -> {"status", "started_at", "finished_at",
    "extra_min"} with ISO-UTC timestamps, and is persisted verbatim on the
    session row after every event.
    """

    def __init__(
        self,
        session_id: str,
        plan: MealPlan,
        steps: list[PlanStep],
        resources: Resources,
        status: str,
        started_at: datetime,
        progress: dict[str, dict],
    ) -> None:
        self.session_id = session_id
        self.plan_id = plan.id
        self.plan_name = plan.name
        self.serve_at = plan.serve_at
        self.steps = steps
        self.steps_by_id = {s.id: s for s in steps}
        self.resources = resources
        self.status = status
        self.started_at = started_at
        self.progress = {k: dict(v) for k, v in progress.items()}

    def _offset(self, moment: datetime) -> int:
        return round((moment - self.serve_at).total_seconds() / 60)

    def apply_event(
        self,
        type: str,
        step_id: str | None = None,
        minutes: int = 5,
        now: datetime | None = None,
    ) -> None:
        now = now or utcnow()
        if self.status != "live":
            raise SessionEventError("this cook session is already finished")
        if type == "finish":
            self.status = "done"
            return

        if step_id is None or step_id not in self.steps_by_id:
            raise SessionEventError("unknown step for this session")
        state = self.progress.get(step_id, {"status": "pending"})
        status = state.get("status", "pending")

        if type == "start_step":
            if status != "pending":
                raise SessionEventError("this step has already been started")
            self.progress[step_id] = {
                "status": "running",
                "started_at": iso_utc(now),
                "extra_min": 0,
            }
        elif type == "complete_step":
            if status == "done":
                raise SessionEventError("this step is already done")
            started = state.get("started_at", iso_utc(now))
            self.progress[step_id] = {
                "status": "done",
                "started_at": started,
                "finished_at": iso_utc(now),
                "extra_min": state.get("extra_min", 0),
            }
        elif type == "delay_step":
            if status != "running":
                raise SessionEventError("only a running step can be given more time")
            # "It needs N more minutes" — from right now, not from the plan.
            step = self.steps_by_id[step_id]
            elapsed = self._offset(now) - self._offset(parse_utc(state["started_at"]))
            state["extra_min"] = elapsed + minutes - step.duration
            self.progress[step_id] = state
        elif type == "reset_step":
            if status == "done":
                state["status"] = "running"
                state.pop("finished_at", None)
                self.progress[step_id] = state
            elif status == "running":
                self.progress.pop(step_id, None)
            else:
                raise SessionEventError("this step has not been started yet")
        else:
            raise SessionEventError(f"unknown event type {type!r}")

        if all(self.progress.get(s.id, {}).get("status") == "done" for s in self.steps):
            self.status = "done"

    def _progress_offsets(self, now: datetime) -> dict[str, StepProgress]:
        now_off = self._offset(now)
        offsets: dict[str, StepProgress] = {}
        for step_id, state in self.progress.items():
            step = self.steps_by_id.get(step_id)
            if step is None:
                continue
            if state.get("status") == "done":
                start = self._offset(parse_utc(state["started_at"]))
                end = self._offset(parse_utc(state["finished_at"]))
                offsets[step_id] = StepProgress(status="done", start=start, end=end)
            elif state.get("status") == "running":
                start = self._offset(parse_utc(state["started_at"]))
                remaining = max(1, step.duration + state.get("extra_min", 0) - (now_off - start))
                offsets[step_id] = StepProgress(
                    status="running", start=start, end=now_off + remaining
                )
        return offsets

    def snapshot(self, now: datetime | None = None) -> dict:
        now = now or utcnow()
        schedule = replan(
            self.steps, self.resources, self._progress_offsets(now), self._offset(now)
        )
        steps_payload = []
        for placement in schedule.placements:
            step = placement.step
            state = self.progress.get(step.id, {})
            steps_payload.append(
                {
                    "step_id": step.id,
                    "recipe_id": step.recipe_id,
                    "recipe_name": step.recipe_name,
                    "name": step.name,
                    "instruction": step.instruction,
                    "attention": step.attention.value,
                    "equipment": [{"kind": e.kind, "temp_c": e.temp_c} for e in step.equipment],
                    "duration_min": step.duration,
                    "hold_max_min": step.hold_max,
                    "status": state.get("status", "pending"),
                    "planned_start": iso_utc(self.serve_at + timedelta(minutes=placement.start)),
                    "planned_end": iso_utc(self.serve_at + timedelta(minutes=placement.end)),
                    "actual_start": state.get("started_at"),
                    "actual_end": state.get("finished_at"),
                }
            )
        return {
            "type": "state",
            "session_id": self.session_id,
            "plan_id": self.plan_id,
            "plan_name": self.plan_name,
            "status": self.status,
            "now": iso_utc(now),
            "serve_at": iso_utc(self.serve_at),
            "serve_eta": iso_utc(self.serve_at + timedelta(minutes=schedule.serve_push)),
            "serve_push_min": schedule.serve_push,
            "steps": steps_payload,
            "warnings": [
                {"code": w.code, "message": w.message, "step_id": w.step_id}
                for w in schedule.warnings
            ],
        }


class SessionHub:
    """Runtime cache plus WebSocket fan-out, one room per session."""

    def __init__(self) -> None:
        self._runtimes: dict[str, SessionRuntime] = {}
        self._sockets: dict[str, set[WebSocket]] = defaultdict(set)

    def get(self, session_id: str, db: Session) -> SessionRuntime | None:
        runtime = self._runtimes.get(session_id)
        if runtime is not None:
            return runtime
        record = db.get(CookSession, session_id)
        if record is None:
            return None
        plan = db.get(MealPlan, record.plan_id)
        if plan is None:
            return None
        steps, _, _ = plan_steps(db, plan)
        runtime = SessionRuntime(
            session_id=record.id,
            plan=plan,
            steps=steps,
            resources=plan_resources(plan),
            status=record.status,
            started_at=record.started_at,
            progress=record.progress or {},
        )
        self._runtimes[session_id] = runtime
        return runtime

    def live_session_for_plan(self, plan_id: str, db: Session) -> CookSession | None:
        return db.exec(
            select(CookSession).where(CookSession.plan_id == plan_id, CookSession.status == "live")
        ).first()

    def persist(self, runtime: SessionRuntime, db: Session) -> None:
        record = db.get(CookSession, runtime.session_id)
        if record is None:
            return
        record.progress = {k: dict(v) for k, v in runtime.progress.items()}
        record.status = runtime.status
        db.add(record)
        db.commit()

    def connect(self, session_id: str, socket: WebSocket) -> None:
        self._sockets[session_id].add(socket)

    def disconnect(self, session_id: str, socket: WebSocket) -> None:
        self._sockets[session_id].discard(socket)

    async def broadcast(self, session_id: str, payload: dict) -> None:
        dead = []
        for socket in self._sockets[session_id]:
            try:
                await socket.send_json(payload)
            except Exception:
                dead.append(socket)
        for socket in dead:
            self._sockets[session_id].discard(socket)
