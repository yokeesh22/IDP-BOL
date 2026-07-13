import secrets
import warnings
from typing import Annotated, Any, Literal

from pydantic import (
    AnyUrl,
    BeforeValidator,
    EmailStr,
    HttpUrl,
    computed_field,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL
from typing_extensions import Self


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    FRONTEND_HOST: str = "http://localhost:5173"
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"

    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        return [str(origin).rstrip("/") for origin in self.BACKEND_CORS_ORIGINS] + [
            self.FRONTEND_HOST
        ]

    PROJECT_NAME: str
    SENTRY_DSN: HttpUrl | None = None

    # Azure SQL Database (SQL Server) connection settings.
    AZURE_SQL_SERVER: str
    AZURE_SQL_DATABASE: str
    AZURE_SQL_USER: str
    AZURE_SQL_PASSWORD: str
    AZURE_SQL_PORT: int = 1433
    # ODBC driver installed on the host / in the backend image.
    AZURE_SQL_ODBC_DRIVER: str = "ODBC Driver 18 for SQL Server"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        # URL.create handles URL-encoding of special characters in the
        # password (e.g. `#`, `[`, `]`, `:`) so we never hand-escape it.
        return URL.create(
            "mssql+pyodbc",
            username=self.AZURE_SQL_USER,
            password=self.AZURE_SQL_PASSWORD,
            host=self.AZURE_SQL_SERVER,
            port=self.AZURE_SQL_PORT,
            database=self.AZURE_SQL_DATABASE,
            query={
                "driver": self.AZURE_SQL_ODBC_DRIVER,
                "Encrypt": "yes",
                "TrustServerCertificate": "no",
                "Connection Timeout": "30",
            },
        ).render_as_string(hide_password=False)

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAILS_FROM_EMAIL: EmailStr | None = None
    EMAILS_FROM_NAME: str | None = None

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48

    @computed_field  # type: ignore[prop-decorator]
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.EMAILS_FROM_EMAIL)

    EMAIL_TEST_USER: EmailStr = "test@example.com"
    FIRST_SUPERUSER: EmailStr
    FIRST_SUPERUSER_PASSWORD: str

    # Azure Form Recognizer / Document Intelligence
    FR_ENDPOINT: str = ""
    FR_KEY: str = ""
    FR_MODEL_ID: str = "prebuilt-document"

    # Azure OpenAI (for DB chat)
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_DEPLOYMENT: str = "gpt-4o"
    AZURE_OPENAI_API_VERSION: str = "2024-08-01-preview"

    # Local storage (used as a fallback when Azure Blob Storage is not configured)
    UPLOAD_DIR: str = "uploads"
    PDF_RENDER_DPI: int = 144  # 2x of 72 DPI; matches Form Recognizer inch coords
    PROCESSOR_CONCURRENCY: int = 3

    # Azure Blob Storage. When both values are set, uploaded PDFs and rendered
    # page images are stored in the blob container instead of the local disk.
    # AZURE_STORAGE_CONTAINER_URL is the container URL without any query string,
    # e.g. https://<account>.blob.core.windows.net/<container>
    # AZURE_STORAGE_SAS_TOKEN is the SAS query string (with or without a leading "?").
    AZURE_STORAGE_CONTAINER_URL: str = ""
    AZURE_STORAGE_SAS_TOKEN: str = ""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def use_blob_storage(self) -> bool:
        return bool(self.AZURE_STORAGE_CONTAINER_URL and self.AZURE_STORAGE_SAS_TOKEN)

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "local":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
        self._check_default_secret(
            "FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD
        )

        return self


settings = Settings()  # type: ignore
