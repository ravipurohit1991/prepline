from fastapi import APIRouter

from app.api import plans, recipes, sessions

api_router = APIRouter(prefix="/api")
api_router.include_router(recipes.router)
api_router.include_router(plans.router)
api_router.include_router(sessions.router)


@api_router.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok"}
