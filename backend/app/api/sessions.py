from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from sqlmodel import Session

from app.core.db import get_db
from app.models import CookSession, MealPlan
from app.schemas import EventIn, SessionCreate
from app.services.sessions import SessionEventError, SessionHub, SessionRuntime

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _hub(request: Request) -> SessionHub:
    return request.app.state.hub


def _runtime_or_404(hub: SessionHub, session_id: str, db: Session) -> SessionRuntime:
    runtime = hub.get(session_id, db)
    if runtime is None:
        raise HTTPException(status_code=404, detail="cook session not found")
    return runtime


@router.post("", status_code=201)
def create_session(payload: SessionCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    hub = _hub(request)
    if db.get(MealPlan, payload.plan_id) is None:
        raise HTTPException(status_code=404, detail="plan not found")
    existing = hub.live_session_for_plan(payload.plan_id, db)
    if existing is not None:
        return _runtime_or_404(hub, existing.id, db).snapshot()
    record = CookSession(plan_id=payload.plan_id)
    db.add(record)
    db.commit()
    db.refresh(record)
    return _runtime_or_404(hub, record.id, db).snapshot()


@router.get("/{session_id}")
def get_session(session_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    return _runtime_or_404(_hub(request), session_id, db).snapshot()


@router.post("/{session_id}/events")
async def post_event(
    session_id: str, payload: EventIn, request: Request, db: Session = Depends(get_db)
) -> dict:
    hub = _hub(request)
    runtime = _runtime_or_404(hub, session_id, db)
    try:
        runtime.apply_event(payload.type, payload.step_id, payload.minutes)
    except SessionEventError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    hub.persist(runtime, db)
    snapshot = runtime.snapshot()
    await hub.broadcast(session_id, snapshot)
    return snapshot


@router.websocket("/{session_id}/ws")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    hub: SessionHub = websocket.app.state.hub
    engine = websocket.app.state.engine
    with Session(engine) as db:
        runtime = hub.get(session_id, db)
    if runtime is None:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    hub.connect(session_id, websocket)
    try:
        await websocket.send_json(runtime.snapshot())
        while True:
            message = await websocket.receive_json()
            kind = message.get("type")
            if kind == "sync":
                await websocket.send_json(runtime.snapshot())
                continue
            try:
                runtime.apply_event(kind, message.get("step_id"), int(message.get("minutes", 5)))
            except (SessionEventError, TypeError, ValueError) as error:
                await websocket.send_json({"type": "error", "message": str(error)})
                continue
            with Session(engine) as db:
                hub.persist(runtime, db)
            await hub.broadcast(session_id, runtime.snapshot())
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(session_id, websocket)
