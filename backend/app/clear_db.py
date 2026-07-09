"""Drop ALL tables in the configured database.

Unlike `app.reset_db` (which only touches the app's own tables), this wipes
every table in the database, dropping foreign keys first. It does NOT recreate
anything — start the backend afterwards and `init_db` rebuilds the app schema.

Usage (from the backend/ directory):
    uv run python -m app.clear_db
"""

import logging

from sqlalchemy import text

from app.core.db import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DROP_ALL_SQL = """
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name)
             + ' DROP CONSTRAINT ' + QUOTENAME(fk.name) + ';' + CHAR(10)
FROM sys.foreign_keys fk
JOIN sys.tables t ON fk.parent_object_id = t.object_id;
EXEC sp_executesql @sql;

SET @sql = N'';
SELECT @sql += N'DROP TABLE ' + QUOTENAME(SCHEMA_NAME(schema_id)) + '.' + QUOTENAME(name) + ';' + CHAR(10)
FROM sys.tables;
EXEC sp_executesql @sql;
"""


def main() -> None:
    logger.info("Dropping ALL tables in the database...")
    with engine.begin() as conn:
        conn.execute(text(DROP_ALL_SQL))
    logger.info("All tables dropped.")


if __name__ == "__main__":
    main()
