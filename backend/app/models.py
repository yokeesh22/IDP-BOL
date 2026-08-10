import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import EmailStr
from sqlalchemy import JSON, Column, DateTime
from sqlmodel import Field, Relationship, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(timezone.utc)


class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


class UserUpdate(UserBase):
    email: EmailStr | None = Field(default=None, max_length=255)  # type: ignore[assignment]
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    documents: list["Document"] = Relationship(
        back_populates="owner", cascade_delete=True
    )


class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


class DocumentStatus:
    PENDING = "pending"
    PROCESSING = "processing"
    PROCESSED = "processed"
    ERROR = "error"


class ReviewStatus:
    APPROVED = "approved"
    REJECTED = "rejected"


class DocumentBase(SQLModel):
    original_filename: str = Field(max_length=512)


class Document(DocumentBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version: int = Field(default=1, nullable=False)
    filename: str = Field(max_length=512)
    file_size: int = Field(default=0)
    status: str = Field(default=DocumentStatus.PENDING, index=True, max_length=32)
    page_count: int = Field(default=0)
    key_value_pairs: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False, server_default="[]")
    )
    tables: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False, server_default="[]")
    )
    bol_kv_fields: list[dict[str, Any]] | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    bol_line_items: list[dict[str, Any]] | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    error_message: str | None = Field(default=None, max_length=2048)
    # AI token usage for the document-extraction LLM passes. Null = not tracked
    # (e.g. document processed before metering existed, or extraction failed).
    ai_input_tokens: int | None = Field(default=None)
    ai_output_tokens: int | None = Field(default=None)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    processed_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)  # type: ignore
    )
    review_status: str | None = Field(default=None, index=True, max_length=32)
    review_comment: str | None = Field(default=None, max_length=4096)
    reviewed_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)  # type: ignore
    )
    # No DB-level ON DELETE CASCADE here: SQL Server forbids "multiple cascade
    # paths" and a user already reaches `chatsession` via `chatsession.user_id`.
    # Deleting a user's documents is handled by the ORM (`cascade_delete=True`
    # on `User.documents`) plus an explicit bulk delete in the delete-user route.
    owner_id: uuid.UUID = Field(foreign_key="user.id", nullable=False)
    owner: User | None = Relationship(back_populates="documents")


class DocumentMeta(SQLModel):
    id: uuid.UUID
    version: int
    filename: str
    original_filename: str
    file_size: int
    status: str
    page_count: int
    key_value_pairs: list[dict[str, Any]]
    tables: list[dict[str, Any]]
    bol_kv_fields: list[dict[str, Any]] | None = None
    bol_line_items: list[dict[str, Any]] | None = None
    error_message: str | None
    created_at: datetime | None
    processed_at: datetime | None
    review_status: str | None = None
    review_comment: str | None = None
    reviewed_at: datetime | None = None
    # Who uploaded the document. Populated from the `owner` relationship so the
    # UI can show the real owner (important for superusers, who see everyone's
    # documents) instead of assuming the current viewer.
    owner_id: uuid.UUID | None = None
    owner_name: str | None = None
    owner_email: str | None = None


class DocumentDetail(DocumentMeta):
    page_images: list[str] = []


class DocumentsPublic(SQLModel):
    data: list[DocumentMeta]
    count: int


class ChatSession(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE")
    document_id: uuid.UUID | None = Field(default=None, foreign_key="document.id", ondelete="SET NULL")
    title: str | None = Field(default=None, max_length=255)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    messages: list["ChatMessage"] = Relationship(
        back_populates="session", cascade_delete=True
    )


class ChatMessage(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    session_id: uuid.UUID = Field(foreign_key="chatsession.id", ondelete="CASCADE")
    role: str = Field(max_length=32)
    content: str
    # AI token usage for assistant replies (null for user messages / untracked).
    ai_input_tokens: int | None = Field(default=None)
    ai_output_tokens: int | None = Field(default=None)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    session: Optional["ChatSession"] = Relationship(back_populates="messages")


class ChatSessionPublic(SQLModel):
    id: uuid.UUID
    document_id: uuid.UUID | None
    title: str | None
    created_at: datetime | None


class ChatMessagePublic(SQLModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    created_at: datetime | None


class UsageKind:
    DOCUMENT = "document"
    CHAT = "chat"


class UsageRecord(SQLModel, table=True):
    """Persistent, append-only ledger of billable usage events.

    Each processed document and each assistant chat reply writes one row here at
    the moment the cost is incurred. Metering reads *only* from this table, so
    deleting a document (or a user) never erases historical cost — the spend
    already happened and stays on the books.

    ``document_id`` / ``user_id`` are intentionally plain UUID columns with *no*
    foreign key. This keeps the ledger fully decoupled from the source rows:
    deletes can't cascade into it and can't be blocked by it, and the
    denormalized ``label`` snapshot means reports stay readable even after the
    original document is gone.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    kind: str = Field(index=True, max_length=32)  # UsageKind.DOCUMENT | CHAT
    label: str = Field(default="", max_length=512)
    document_id: uuid.UUID | None = Field(default=None, index=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    pages: int = Field(default=0)
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class Message(SQLModel):
    message: str


class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)
