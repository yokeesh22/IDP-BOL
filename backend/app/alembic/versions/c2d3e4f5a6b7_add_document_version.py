"""Add optimistic-concurrency version to documents.

Revision ID: c2d3e4f5a6b7
Revises: b1f2c3d4e5a6
Create Date: 2026-08-10 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "c2d3e4f5a6b7"
down_revision = "b1f2c3d4e5a6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "document",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade():
    op.drop_column("document", "version")
