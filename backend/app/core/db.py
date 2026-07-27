from sqlalchemy import event
from sqlmodel import Session, SQLModel, col, create_engine, func, select

from app import crud
from app.core.config import settings
from app.models import (
    ChatMessage,
    ChatSession,
    Document,
    DocumentStatus,
    UsageKind,
    UsageRecord,
    User,
    UserCreate,
)

if settings.use_azure_sql:
    # `pool_pre_ping` transparently recycles connections that Azure SQL has
    # closed after an idle period; `pool_recycle` proactively refreshes them
    # well before the server-side timeout.
    engine = create_engine(
        settings.SQLALCHEMY_DATABASE_URI,
        pool_pre_ping=True,
        pool_recycle=1800,
    )
else:
    # Local SQLite fallback. `check_same_thread=False` lets the connection be
    # shared across FastAPI's worker threads.
    engine = create_engine(
        settings.SQLALCHEMY_DATABASE_URI,
        connect_args={"check_same_thread": False},
    )

    # SQLite doesn't enforce foreign keys unless asked to per-connection; enable
    # it so ON DELETE CASCADE / SET NULL behave like they do on Azure SQL.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_fks(dbapi_connection, connection_record):  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def init_db(session: Session) -> None:
    # Create all tables defined on imported SQLModel subclasses. `create_all`
    # is a no-op for tables that already exist, so it is safe to run on every
    # startup. The Azure SQL database itself must already exist.
    SQLModel.metadata.create_all(engine)

    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    if not user:
        user_in = UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=True,
        )
        user = crud.create_user(session=session, user_create=user_in)

    backfill_usage_records(session)


def backfill_usage_records(session: Session) -> None:
    """Seed the usage ledger from pre-existing document/chat token usage.

    Runs once: if the ledger already has any rows we assume the migration is
    done and return immediately, so this is safe to call on every startup. This
    preserves historical metering totals when upgrading to the ledger-based
    metering (previously computed live off the document/chat tables).
    """
    already = session.exec(select(func.count()).select_from(UsageRecord)).one()
    if already:
        return

    docs = session.exec(
        select(Document)
        .where(Document.status == DocumentStatus.PROCESSED)
        .where(col(Document.ai_input_tokens).is_not(None))
    ).all()
    for d in docs:
        session.add(
            UsageRecord(
                kind=UsageKind.DOCUMENT,
                label=d.original_filename,
                document_id=d.id,
                user_id=d.owner_id,
                pages=d.page_count or 0,
                input_tokens=d.ai_input_tokens or 0,
                output_tokens=d.ai_output_tokens or 0,
                created_at=d.processed_at or d.created_at,
            )
        )

    chat_rows = session.exec(
        select(ChatMessage, ChatSession)
        .join(ChatSession, col(ChatMessage.session_id) == col(ChatSession.id))
        .where(col(ChatMessage.ai_input_tokens).is_not(None))
    ).all()
    for msg, chat_session in chat_rows:
        session.add(
            UsageRecord(
                kind=UsageKind.CHAT,
                label=chat_session.title or "Untitled chat",
                document_id=chat_session.document_id,
                user_id=chat_session.user_id,
                pages=0,
                input_tokens=msg.ai_input_tokens or 0,
                output_tokens=msg.ai_output_tokens or 0,
                created_at=msg.created_at,
            )
        )

    session.commit()
