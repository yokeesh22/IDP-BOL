from sqlmodel import Session, SQLModel, create_engine, select

from app import crud
from app.core.config import settings
from app.models import User, UserCreate

# `pool_pre_ping` transparently recycles connections that Azure SQL has closed
# after an idle period; `pool_recycle` proactively refreshes them well before
# the server-side timeout.
engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    pool_pre_ping=True,
    pool_recycle=1800,
)


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
