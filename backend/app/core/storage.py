"""File storage abstraction.

Provides a single interface used by the document upload / processing / serving
code, backed either by the local filesystem (``UPLOAD_DIR``) or an Azure Blob
Storage container. The Azure backend is used automatically when
``AZURE_STORAGE_CONTAINER_URL`` and ``AZURE_STORAGE_SAS_TOKEN`` are configured.

Blob "names" mirror the previous on-disk layout, e.g.::

    <uuid>_<token>.pdf                  # original PDF
    doc_<document_id>_pages/page_1.png  # rendered page images
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit, urlunsplit

from app.core.config import settings

logger = logging.getLogger(__name__)


class Storage(Protocol):
    def save_bytes(
        self, name: str, data: bytes, content_type: str | None = None
    ) -> None: ...

    def read_bytes(self, name: str) -> bytes: ...

    def exists(self, name: str) -> bool: ...

    def delete(self, name: str) -> None: ...

    def delete_prefix(self, prefix: str) -> None: ...

    def url_for(self, name: str) -> str: ...


class LocalStorage:
    """Stores files under ``UPLOAD_DIR`` and serves them via the ``/uploads`` mount."""

    def __init__(self, base_dir: str) -> None:
        self.base = Path(base_dir)
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, name: str) -> Path:
        p = self.base / name
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def save_bytes(
        self, name: str, data: bytes, content_type: str | None = None
    ) -> None:
        self._path(name).write_bytes(data)

    def read_bytes(self, name: str) -> bytes:
        return (self.base / name).read_bytes()

    def exists(self, name: str) -> bool:
        return (self.base / name).exists()

    def delete(self, name: str) -> None:
        (self.base / name).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> None:
        target = self.base / prefix.rstrip("/")
        if not target.is_dir():
            return
        for child in target.iterdir():
            child.unlink(missing_ok=True)
        target.rmdir()

    def url_for(self, name: str) -> str:
        return f"/uploads/{name}"


class BlobStorage:
    """Stores files in an Azure Blob Storage container using a container SAS URL."""

    def __init__(self, container_url: str, sas_token: str) -> None:
        parts = urlsplit(container_url)
        # Container URL without any query string (in case it was pasted whole).
        self._container_url = urlunsplit(
            (parts.scheme, parts.netloc, parts.path, "", "")
        ).rstrip("/")
        # Prefer an explicit SAS token; otherwise fall back to one embedded in
        # the container URL query string.
        self._sas = (sas_token or parts.query).lstrip("?")

        from azure.storage.blob import ContainerClient

        self._client = ContainerClient.from_container_url(
            f"{self._container_url}?{self._sas}"
        )

    def save_bytes(
        self, name: str, data: bytes, content_type: str | None = None
    ) -> None:
        from azure.storage.blob import ContentSettings

        content_settings = (
            ContentSettings(content_type=content_type) if content_type else None
        )
        self._client.upload_blob(
            name, data, overwrite=True, content_settings=content_settings
        )

    def read_bytes(self, name: str) -> bytes:
        return self._client.download_blob(name).readall()

    def exists(self, name: str) -> bool:
        return self._client.get_blob_client(name).exists()

    def delete(self, name: str) -> None:
        try:
            self._client.delete_blob(name)
        except Exception:
            logger.debug("Blob delete skipped (missing?): %s", name)

    def delete_prefix(self, prefix: str) -> None:
        for blob in self._client.list_blobs(name_starts_with=prefix):
            try:
                self._client.delete_blob(blob.name)
            except Exception:
                logger.debug("Blob delete skipped (missing?): %s", blob.name)

    def url_for(self, name: str) -> str:
        return f"{self._container_url}/{name}?{self._sas}"


@lru_cache(maxsize=1)
def get_storage() -> Storage:
    if settings.use_blob_storage:
        logger.info("Using Azure Blob Storage backend for document files")
        return BlobStorage(
            settings.AZURE_STORAGE_CONTAINER_URL,
            settings.AZURE_STORAGE_SAS_TOKEN,
        )
    logger.info("Using local filesystem backend (%s) for document files", settings.UPLOAD_DIR)
    return LocalStorage(settings.UPLOAD_DIR)
