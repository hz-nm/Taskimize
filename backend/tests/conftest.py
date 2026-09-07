"""Shared pytest fixtures — a throwaway SQLite DB per test, via a fresh TestClient."""

import os
import tempfile

import pytest

# Point the app at a throwaway DB before any app module is imported.
_tmpdir = tempfile.mkdtemp()
os.environ["DATABASE_PATH"] = os.path.join(_tmpdir, "test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
