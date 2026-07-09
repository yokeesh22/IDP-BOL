"""Replace item table with document table

Revision ID: a7c1d4e2f001
Revises: fe56fa70289e
Create Date: 2026-05-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = "a7c1d4e2f001"
down_revision = "fe56fa70289e"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("DROP TABLE IF EXISTS item CASCADE")

    op.create_table(
        "document",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("original_filename", sqlmodel.sql.sqltypes.AutoString(length=512), nullable=False),
        sa.Column("filename", sqlmodel.sql.sqltypes.AutoString(length=512), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False, server_default="pending"),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("key_value_pairs", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("tables", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("error_message", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_document_status", "document", ["status"], unique=False)


def downgrade():
    op.drop_index("ix_document_status", table_name="document")
    op.drop_table("document")
    op.create_table(
        "item",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
