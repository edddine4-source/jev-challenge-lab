FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UVICORN_HOST=127.0.0.1

WORKDIR /app

COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.lock

COPY backend ./backend
COPY frontend ./frontend
RUN mkdir -p /app/data && chmod 700 /app/data

EXPOSE 8000

# Default bind is loopback (safe for bare `docker run -p`). Compose overrides
# UVICORN_HOST=0.0.0.0 because Docker port publish targets the container eth
# interface, while compose.yaml already publishes only 127.0.0.1 on the host.
# Never combine a non-loopback published port with JEV_ALLOWED_HOSTS.
CMD ["sh", "-c", "uvicorn backend.app:app --host ${UVICORN_HOST:-127.0.0.1} --port 8000"]
