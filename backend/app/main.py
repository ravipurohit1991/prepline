from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import SQLModel
from starlette.exceptions import HTTPException

from app import __version__
from app.api import api_router
from app.core.config import Settings
from app.core.db import make_engine
from app.seed import seed_demo
from app.services.sessions import SessionHub


class SPAStaticFiles(StaticFiles):
    """Serve the built frontend, falling back to index.html for client routes."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        SQLModel.metadata.create_all(engine)
        if settings.seed_on_empty:
            seed_demo(engine)
        yield

    app = FastAPI(
        title="Prepline API",
        version=__version__,
        description=(
            "The expediter for your home kitchen: compiles recipes into one "
            "resource-aware cooking timeline and replans it live while you cook."
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.hub = SessionHub()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", SPAStaticFiles(directory=dist, html=True), name="spa")

    return app


app = create_app()
