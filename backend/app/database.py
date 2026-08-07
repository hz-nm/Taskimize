"""Database engine/session wiring.

The SQLite file lives at ``DATABASE_PATH`` (default ``/data/tasks.db``), which in
Docker is a mounted volume so the data survives container restarts and redeploys.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_PATH = Path(os.getenv("DATABASE_PATH", "/data/tasks.db"))
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DATABASE_PATH}",
    # SQLite + FastAPI's threadpool: sessions may be touched from worker threads.
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _enable_sqlite_pragmas(dbapi_connection, _connection_record):
    """Enforce FK constraints (off by default in SQLite) and use WAL for durability."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401  (registers mappers before create_all)

    Base.metadata.create_all(bind=engine)
    _migrate()


# Columns added after the first release. `create_all` only creates missing
# *tables*, so an existing volume needs these bolted on explicitly. Each entry is
# (table, column, DDL) and is applied only if the column is absent, which keeps
# this safe to run on every startup.
_ADDED_COLUMNS = [
    ("tasks", "project_id", "ALTER TABLE tasks ADD COLUMN project_id VARCHAR(36) REFERENCES projects(id)"),
    ("tasks", "description", "ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''"),
]


def _migrate() -> None:
    with engine.begin() as conn:
        for table, column, ddl in _ADDED_COLUMNS:
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if existing and column not in existing:
                conn.exec_driver_sql(ddl)
