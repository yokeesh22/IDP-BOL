FROM python:3.10-bookworm

ENV PYTHONUNBUFFERED=1

# Install the Microsoft ODBC Driver 18 for SQL Server (required by pyodbc to
# connect to Azure SQL) plus the unixODBC dev headers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg2 apt-transport-https \
    && mkdir -p /usr/share/keyrings \
    && curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && curl -sSL https://packages.microsoft.com/config/debian/12/prod.list > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 unixodbc-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install uv
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#installing-uv
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/

# Compile bytecode
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#compiling-bytecode
ENV UV_COMPILE_BYTECODE=1

# uv Cache
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#caching
ENV UV_LINK_MODE=copy

WORKDIR /app/backend/

# Place executables in the environment at the front of the path
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#using-the-environment
ENV PATH="/app/backend/.venv/bin:$PATH"

# Install dependencies.
# NOTE: plain COPY (not `RUN --mount=...`) so the image builds on the classic
# Docker builder too — Azure Container Registry quick builds do not enable
# BuildKit, which the --mount syntax requires.
COPY ./backend/uv.lock ./backend/pyproject.toml /app/backend/
RUN uv sync --frozen --no-install-project

COPY ./backend/scripts /app/backend/scripts

# Defensive: strip CRLF from the shell scripts in case the build context was
# checked out on a machine with core.autocrlf=true. Linux bash cannot run
# scripts with trailing '\r' ("$'\r': command not found"), which would break
# prestart (schema creation + superuser seed). Belt-and-suspenders alongside
# the repo .gitattributes.
RUN sed -i 's/\r$//' /app/backend/scripts/*.sh

COPY ./backend/alembic.ini /app/backend/

COPY ./backend/app /app/backend/app

# Sync the project (installs the app package now that its sources exist).
RUN uv sync --frozen

# Number of uvicorn worker processes. Overridable at deploy time via the
# FASTAPI_WORKERS env var. NOTE: each worker is a full copy of the app (memory)
# and runs its own in-process document worker, so this also multiplies
# background processing concurrency. Default tuned for a 4 vCPU / 8 GiB backend:
# one worker per core, which 8 GiB comfortably holds.
ENV FASTAPI_WORKERS=4

# Background-processing concurrency PER worker for a 4 vCPU / 8 GiB backend:
# FASTAPI_WORKERS × PROCESSOR_CONCURRENCY = 4 × 2 = 8 concurrent document
# pipelines. The pipeline is I/O-heavy (Azure Form Recognizer + LLM calls), so
# oversubscribing the 4 cores hides that wait and improves throughput; short
# CPU bursts (PDF→image render) still fill the cores. Overridable via env
# (a compose .env or the Azure portal value takes precedence over this default).
ENV PROCESSOR_CONCURRENCY=2

# Run schema creation + superuser seed exactly once (single process) before
# starting the server, then launch the workers. Keeping prestart here — rather
# than in the app lifespan — avoids every worker/replica racing on create_all
# and the seed insert. Uses the shell form so ${FASTAPI_WORKERS} is expanded.
CMD ["sh", "-c", "bash scripts/prestart.sh && fastapi run --workers ${FASTAPI_WORKERS:-4} app/main.py"]
