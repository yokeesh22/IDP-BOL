"""One-off utility to reset this app's database tables.

Drops every table defined by the app's SQLModel models and recreates them,
then re-seeds the superuser. It only touches the app's own tables
(user, document, chatsession, chatmessage) and leaves any other objects in
the database untouched.

Usage (from the backend/ directory):
    uv run python -m app.reset_db
"""

import logging

from sqlmodel import Session, SQLModel

import app.models  # noqa: F401  (imported so all tables register on metadata)
from app.core.db import engine, init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    logger.info("Dropping app tables: %s", list(SQLModel.metadata.tables))
    SQLModel.metadata.drop_all(engine)
    logger.info("Recreating tables and seeding the superuser...")
    with Session(engine) as session:
        init_db(session)
    logger.info("Database reset complete.")


if __name__ == "__main__":
    main()
