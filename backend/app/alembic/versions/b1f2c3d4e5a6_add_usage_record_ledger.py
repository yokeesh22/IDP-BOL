"""Add usage_record ledger and backfill from existing usage

Revision ID: b1f2c3d4e5a6
Revises: a7c1d4e2f001
Create Date: 2026-07-19 00:00:00.000000

Introduces a persistent, append-only usage ledger so metering cost survives the
deletion of a document, chat, or user. The table is created (guarded, since the
app also creates it via SQLModel ``create_all`` on startup) and then backfilled
from the token usage already recorded on processed documents and chat messages,
so historical metering totals are preserved.
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy import inspect
from sqlmodel import Session


# revision identifiers, used by Alembic.
revision = "b1f2c3d4e5a6"
down_revision = "a7c1d4e2f001"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    if "usagerecord" not in inspector.get_table_names():
        op.create_table(
            "usagerecord",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("kind", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("label", sqlmodel.sql.sqltypes.AutoString(length=512), nullable=False, server_default=""),
            sa.Column("document_id", sa.Uuid(), nullable=True),
            sa.Column("user_id", sa.Uuid(), nullable=True),
            sa.Column("pages", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_usagerecord_kind"), "usagerecord", ["kind"], unique=False)
        op.create_index(
            op.f("ix_usagerecord_document_id"), "usagerecord", ["document_id"], unique=False
        )
        op.create_index(
            op.f("ix_usagerecord_user_id"), "usagerecord", ["user_id"], unique=False
        )

    # Backfill from pre-existing usage. Idempotent: no-op if the ledger already
    # has rows (e.g. the app already backfilled it on startup).
    from app.core.db import backfill_usage_records

    with Session(bind) as session:
        backfill_usage_records(session)


def downgrade():
    op.drop_index(op.f("ix_usagerecord_user_id"), table_name="usagerecord")
    op.drop_index(op.f("ix_usagerecord_document_id"), table_name="usagerecord")
    op.drop_index(op.f("ix_usagerecord_kind"), table_name="usagerecord")
    op.drop_table("usagerecord")
