import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        seed_on_empty=False,
    )
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def seeded_client(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'seeded.db').as_posix()}",
        seed_on_empty=True,
    )
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client
