"""Engine, session factory and a small additive migration for SQLite."""

from __future__ import annotations

import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

log = logging.getLogger("zyqra.db")

_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create missing tables, then add any columns older databases lack.

    Only ever adds — existing rows and columns are never changed or dropped,
    so a database created by an earlier Zyqra version upgrades in place.
    """
    from . import models  # noqa: F401  (registers the tables on Base)

    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))
                default = column.default.arg if column.default is not None else None
                if default is not None and not callable(default):
                    conn.execute(
                        text(f'UPDATE "{table.name}" SET "{column.name}" = :value'),
                        {"value": default},
                    )
                log.info("migrated: added %s.%s", table.name, column.name)
