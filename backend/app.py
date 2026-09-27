from __future__ import annotations

import os
import json
import logging
import secrets
import sqlite3
import time
from urllib.parse import urlsplit
from uuid import uuid4
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.datastructures import Headers

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
load_dotenv(ROOT / ".env")
JEV_URL = "https://api.typesafe.ai/v1/systemone"
SETTINGS_FILE = Path(os.getenv("JEV_SETTINGS_FILE", ROOT / "data" / "settings.json"))
EXAMPLES_FILE = SETTINGS_FILE.with_name("hidden_examples.json")
HISTORY_DB = Path(os.getenv("JEV_HISTORY_DB", ROOT / "data" / "history.db"))
SERVICE_TOKEN_COOKIE = "jev_service_token"
MAX_DRAFT_JSON_BYTES = 512_000
MAX_CHALLENGE_STATE_BYTES = 256_000
MAX_CRITERIA_VALUE_BYTES = 16_000
MAX_HISTORY_LIST_ROWS = 200
MAX_DRAFT_LIST_ROWS = 200
DEFAULT_HISTORY_LIST_ROWS = 50
logger = logging.getLogger("jev-challenge-lab")


def ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        if path.is_symlink():
            return
        path.chmod(0o700)
    except OSError:
        pass


def write_private_text(path: Path, content: str) -> None:
    """Atomically write text with 0600, refusing to follow a symlink destination."""
    ensure_private_dir(path.parent)
    if path.is_symlink():
        raise OSError(f"Refusing to write through symlink: {path}")
    temporary = path.with_name(f"{path.name}.{os.getpid()}.{secrets.token_hex(8)}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except Exception:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def chmod_private_file(path: Path) -> None:
    """chmod 0600 only for a regular file (never follow a symlink)."""
    try:
        if path.is_symlink() or not path.is_file():
            return
        path.chmod(0o600)
    except OSError:
        pass


def resolve_service_token() -> str:
    """Load JEV_SERVICE_TOKEN, else reuse/create $settings_dir/service.token."""
    token_file = SETTINGS_FILE.with_name("service.token")
    env_token = os.getenv("JEV_SERVICE_TOKEN", "").strip()
    if env_token:
        try:
            existing = ""
            try:
                existing = token_file.read_text(encoding="utf-8").strip()
            except (FileNotFoundError, OSError):
                pass
            if existing != env_token:
                write_private_text(token_file, env_token + "\n")
        except OSError:
            pass
        return env_token
    try:
        existing = token_file.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    except (FileNotFoundError, OSError):
        pass
    token = secrets.token_urlsafe(32)
    write_private_text(token_file, token + "\n")
    return token


def request_has_valid_service_token(headers: Headers, service_token: str) -> bool:
    if not service_token:
        return False
    authorization = headers.get("authorization")
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value and secrets.compare_digest(value, service_token):
            return True
    cookie_header = headers.get("cookie")
    if cookie_header:
        for part in cookie_header.split(";"):
            name, sep, value = part.strip().partition("=")
            if sep and name == SERVICE_TOKEN_COOKIE and value and secrets.compare_digest(value, service_token):
                return True
    return False


def load_api_key_settings() -> tuple[list[dict[str, str]], str | None]:
    try:
        settings = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, ValueError, TypeError):
        return [], None
    if not isinstance(settings, dict):
        return [], None
    profiles = settings.get("api_keys")
    if isinstance(profiles, list):
        keys = [
            {"id": item["id"], "name": item["name"], "api_key": item["api_key"]}
            for item in profiles
            if isinstance(item, dict)
            and all(isinstance(item.get(field), str) and item[field] for field in ("id", "name", "api_key"))
        ]
        active_id = settings.get("active_api_key_id")
        if active_id not in {item["id"] for item in keys}:
            active_id = keys[0]["id"] if keys else None
        return keys, active_id
    legacy_key = settings.get("typesafe_api_key")
    if isinstance(legacy_key, str) and legacy_key.strip():
        return [{"id": "legacy", "name": "Original key", "api_key": legacy_key.strip()}], "legacy"
    return [], None


def save_api_key_settings(keys: list[dict[str, str]], active_id: str | None) -> None:
    write_private_text(SETTINGS_FILE, json.dumps({"api_keys": keys, "active_api_key_id": active_id}))


def active_api_key() -> str:
    active_id = app.state.active_api_key_id
    for profile in app.state.api_keys:
        if profile["id"] == active_id:
            return profile["api_key"]
    return os.getenv("TYPESAFE_API_KEY", "").strip()


def public_api_keys() -> dict[str, Any]:
    return {
        "keys": [
            {"id": item["id"], "name": item["name"], "masked_key": "••••••••", "active": item["id"] == app.state.active_api_key_id}
            for item in app.state.api_keys
        ],
        "active_id": app.state.active_api_key_id,
        "jev_connected": bool(active_api_key()),
    }


def hidden_examples() -> list[str]:
    try:
        data = json.loads(EXAMPLES_FILE.read_text(encoding="utf-8"))
        return [name for name in data if isinstance(name, str)] if isinstance(data, list) else []
    except (FileNotFoundError, OSError, ValueError, TypeError):
        return []


def save_hidden_examples(names: list[str]) -> None:
    write_private_text(EXAMPLES_FILE, json.dumps(names))


def history_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(HISTORY_DB, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_history() -> None:
    ensure_private_dir(HISTORY_DB.parent)
    with history_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS challenge_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                model TEXT NOT NULL,
                question_count INTEGER NOT NULL,
                request_json TEXT NOT NULL,
                response_json TEXT NOT NULL,
                interpretation_json TEXT NOT NULL,
                memo TEXT NOT NULL DEFAULT ''
            )
        """)
        if "memo" not in {row["name"] for row in connection.execute("PRAGMA table_info(challenge_history)")}:
            connection.execute("ALTER TABLE challenge_history ADD COLUMN memo TEXT NOT NULL DEFAULT ''")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_challenge_history_created_at ON challenge_history(created_at DESC)")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS challenge_drafts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_complete INTEGER NOT NULL,
                draft_json TEXT NOT NULL
            )
        """)
        connection.execute("CREATE INDEX IF NOT EXISTS idx_challenge_drafts_updated_at ON challenge_drafts(updated_at DESC)")
    chmod_private_file(HISTORY_DB)


def challenge_title(request_json: dict[str, Any]) -> str:
    questions = request_json.get("questions", {})
    first = next(iter(questions.values()), {})
    instructions = first.get("instructions", "")
    if isinstance(instructions, dict):
        instructions = instructions.get("task", "")
    if not isinstance(instructions, str) or not instructions.strip():
        instructions = next(iter(questions), "Jev challenge").replace("_", " ")
    title = " ".join(instructions.split())
    return title[:77] + "..." if len(title) > 80 else title


def store_challenge_history(request_json: dict[str, Any], response_json: dict[str, Any], interpretation: list[dict[str, Any]], memo: str = "") -> tuple[int, str]:
    title = challenge_title(request_json)
    created_at = datetime.now(timezone.utc).isoformat()
    with history_connection() as connection:
        cursor = connection.execute(
            """INSERT INTO challenge_history
               (title, created_at, model, question_count, request_json, response_json, interpretation_json, memo)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                title,
                created_at,
                str(response_json.get("model") or request_json.get("model") or "jev-latest"),
                len(request_json.get("questions", {})),
                json.dumps(request_json, ensure_ascii=False),
                json.dumps(response_json, ensure_ascii=False),
                json.dumps(interpretation, ensure_ascii=False),
                memo,
            ),
        )
    return int(cursor.lastrowid), title

app = FastAPI(title="Jev Challenge Lab", version="2.0.0", docs_url=None, redoc_url=None, openapi_url=None)
app.state.api_keys, app.state.active_api_key_id = load_api_key_settings()
initialize_history()
SERVICE_TOKEN = resolve_service_token()
app.state.service_token = SERVICE_TOKEN


def allowed_request_host(host: str) -> bool:
    """Reject rebinding hostnames, even when they resolve to loopback."""
    try:
        parsed = urlsplit(f"//{host}")
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return False
    if not hostname or parsed.username is not None or parsed.password is not None or parsed.path or parsed.query or parsed.fragment:
        return False
    if port is not None and not 1 <= port <= 65535:
        return False
    allowed = {"127.0.0.1", "localhost", "::1"}
    allowed.update(name.strip().lower() for name in os.getenv("JEV_ALLOWED_HOSTS", "").split(",") if name.strip())
    return hostname.lower() in allowed


class LocalRequestBoundary:
    def __init__(self, wrapped_app, service_token: str | None = None):
        self.wrapped_app = wrapped_app
        self.service_token = service_token if service_token is not None else SERVICE_TOKEN

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.wrapped_app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        hosts = headers.getlist("host")
        reason = None
        status_code = 403
        if len(hosts) != 1 or not allowed_request_host(hosts[0]):
            reason = "Untrusted request host."
        else:
            origin = headers.get("origin")
            expected_origin = f"{scope['scheme']}://{hosts[0]}"
            # QML may use a null Origin. Browsers cannot send this non-simple
            # header cross-origin without a preflight, which this guard denies.
            widget_request = headers.get("x-jev-widget") == "1"

            def _widget_shell_origin(value: str | None) -> bool:
                # Quickshell loads LabPanel from disk/qrc; XHR may send Origin/Referer
                # as file://, qrc://, or the string "null" rather than http://127.0.0.1.
                if value is None:
                    return True
                if value in {"", "null"}:
                    return True
                return value.startswith("file:") or value.startswith("qrc:")

            if origin and origin != expected_origin and not (widget_request and _widget_shell_origin(origin)):
                reason = "Untrusted request origin."
            referer = headers.get("referer")
            if referer and not referer.startswith(expected_origin + "/") and not (
                widget_request and _widget_shell_origin(referer)
            ):
                reason = "Untrusted request origin."
            fetch_site = headers.get("sec-fetch-site")
            # Quickshell may label widget XHR as cross-site; the service token
            # still authenticates those callers. Keep Host/Origin/token checks.
            if (
                fetch_site
                and fetch_site not in {"same-origin", "none"}
                and not widget_request
            ):
                reason = "Cross-site requests are not allowed."
            path = scope.get("path") or ""
            if reason is None and path.startswith("/api/") and not request_has_valid_service_token(headers, self.service_token):
                reason = "Authentication required."
                status_code = 401

        if reason:
            await JSONResponse(
                {"detail": reason},
                status_code=status_code,
                headers={"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY"},
            )(scope, receive, send)
            return

        async def send_with_security_headers(message):
            if message["type"] == "http.response.start":
                raw_headers = list(message.get("headers", []))
                header_names = {k.lower() for k, _ in raw_headers}
                if b"x-content-type-options" not in header_names:
                    raw_headers.append((b"x-content-type-options", b"nosniff"))
                if b"x-frame-options" not in header_names:
                    raw_headers.append((b"x-frame-options", b"DENY"))
                message["headers"] = raw_headers
            await send(message)

        await self.wrapped_app(scope, receive, send_with_security_headers)


app.add_middleware(LocalRequestBoundary)


class JevChallengeRequest(BaseModel):
    state: Any
    model: str = Field(default="jev-latest", min_length=1, max_length=80)
    questions: dict[str, dict[str, Any]] = Field(min_length=1, max_length=50)
    memo: str = Field(default="", max_length=5000)


class ApiKeySettings(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    api_key: str = Field(min_length=16, max_length=512)


class ApiKeyRename(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class HistoryRename(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class DraftCreate(BaseModel):
    draft: dict[str, Any]
    is_complete: bool = False
    title: str | None = Field(default=None, max_length=120)


class DraftUpdate(BaseModel):
    draft: dict[str, Any] | None = None
    is_complete: bool | None = None
    title: str | None = Field(default=None, max_length=120)


def draft_title(draft: dict[str, Any]) -> str:
    questions = draft.get("questions")
    if isinstance(questions, list) and questions:
        instructions = questions[0].get("instructions", "") if isinstance(questions[0], dict) else ""
        if isinstance(instructions, str) and instructions.strip():
            title = " ".join(instructions.split())
            return title[:77] + "..." if len(title) > 80 else title
    state = draft.get("state", "")
    if isinstance(state, str) and state.strip():
        title = " ".join(state.split())
        return title[:77] + "..." if len(title) > 80 else title
    return "Untitled Jev draft"


def enforce_draft_size(draft: dict[str, Any]) -> str:
    serialized = json.dumps(draft, ensure_ascii=False)
    if len(serialized.encode("utf-8")) > MAX_DRAFT_JSON_BYTES:
        raise HTTPException(status_code=413, detail="This draft is too large to save.")
    return serialized


def _utf8_size(value: Any) -> int:
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def validate_challenge(payload: JevChallengeRequest) -> dict[str, Any]:
    if not isinstance(payload.state, (str, dict, list)):
        raise HTTPException(status_code=422, detail="The scenario must be text, a JSON object, or a JSON list.")
    if isinstance(payload.state, str) and not payload.state.strip():
        raise HTTPException(status_code=422, detail="Enter a scenario for Jev to evaluate.")
    if _utf8_size(payload.state) > MAX_CHALLENGE_STATE_BYTES:
        raise HTTPException(status_code=413, detail="The scenario is too large.")

    clean_questions: dict[str, dict[str, Any]] = {}
    for raw_name, question in payload.questions.items():
        name = raw_name.strip()
        if not name or len(name) > 80:
            raise HTTPException(status_code=422, detail="Every question needs a name of 1 to 80 characters.")
        if name in clean_questions:
            raise HTTPException(status_code=422, detail=f"Question name '{name}' is duplicated.")
        question_type = question.get("type")
        instructions = question.get("instructions")
        if question_type not in {"choice", "score", "noul"}:
            raise HTTPException(status_code=422, detail=f"'{name}' has an unsupported question type.")
        if instructions is not None and not isinstance(instructions, (str, dict, list)):
            raise HTTPException(status_code=422, detail=f"'{name}' has invalid instructions.")
        if instructions not in (None, "") and _utf8_size(instructions) > MAX_CRITERIA_VALUE_BYTES:
            raise HTTPException(status_code=413, detail=f"Instructions for '{name}' are too large.")

        clean: dict[str, Any] = {"type": question_type}
        if instructions not in (None, ""):
            clean["instructions"] = instructions
        criteria = question.get("criteria")
        if question_type == "choice":
            if not isinstance(criteria, dict) or not criteria:
                raise HTTPException(status_code=422, detail=f"Choice question '{name}' needs at least one option.")
            if len(criteria) > 255:
                raise HTTPException(status_code=422, detail=f"Choice question '{name}' can have at most 255 options.")
            for option_name, option_value in criteria.items():
                if _utf8_size(option_name) > 80 or _utf8_size(option_value) > MAX_CRITERIA_VALUE_BYTES:
                    raise HTTPException(status_code=413, detail=f"An option in '{name}' is too large.")
            clean["criteria"] = criteria
        elif question_type == "score":
            if not isinstance(criteria, list) or not criteria:
                raise HTTPException(status_code=422, detail=f"Score question '{name}' needs at least one ordered level.")
            if len(criteria) > 10:
                raise HTTPException(status_code=422, detail=f"Score question '{name}' can have at most 10 levels.")
            for level in criteria:
                if _utf8_size(level) > MAX_CRITERIA_VALUE_BYTES:
                    raise HTTPException(status_code=413, detail=f"A score level in '{name}' is too large.")
            clean["criteria"] = criteria
        elif criteria is not None:
            if not isinstance(criteria, dict) or any(key not in {"true", "false"} for key in criteria):
                raise HTTPException(status_code=422, detail=f"Noul criteria for '{name}' must define true and/or false.")
            for option_value in criteria.values():
                if _utf8_size(option_value) > MAX_CRITERIA_VALUE_BYTES:
                    raise HTTPException(status_code=413, detail=f"Noul criteria for '{name}' are too large.")
            clean["criteria"] = criteria
        clean_questions[name] = clean
    return {"model": payload.model.strip(), "state": payload.state, "questions": clean_questions}


def explain_jev_answers(data: dict[str, Any]) -> list[dict[str, Any]]:
    explanations = []
    for name, answer in data.get("answers", {}).items():
        answer_type = answer.get("type")
        if answer_type == "choice":
            choice = str(answer.get("choice", "unknown"))
            confidence = float(answer.get("confidence", 0))
            text = f"Jev chose {choice.replace('_', ' ')} with {confidence:.0%} confidence."
            details = sorted(answer.get("probabilities", {}).items(), key=lambda item: item[1], reverse=True)
        elif answer_type == "score":
            score = float(answer.get("score", 0))
            confidence = float(answer.get("confidence", 0))
            nearest = answer.get("legend", {}).get(str(round(score)), "the nearest level")
            text = f"Jev rated this {score:.2f}, closest to “{nearest}”, with {confidence:.0%} confidence."
            details = sorted(answer.get("probabilities", {}).items(), key=lambda item: float(item[0]))
        elif answer_type == "noul":
            probability = float(answer.get("noul", 0))
            verdict = "likely yes" if probability >= 0.5 else "likely no"
            text = f"The answer is {verdict}: Jev gives yes a {probability:.0%} probability."
            details = [["yes", probability], ["no", 1 - probability]]
        else:
            text, details = "Jev returned an unfamiliar answer type.", []
        explanations.append({"name": name, "type": answer_type, "text": text, "details": details})
    return explanations


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "jev_connected": bool(active_api_key())}


@app.get("/api/settings/api-keys")
def list_api_keys() -> dict[str, Any]:
    return public_api_keys()


@app.get("/api/settings/api-key")
def retired_key_reveal() -> None:
    raise HTTPException(status_code=410, detail="API keys cannot be revealed.")


@app.post("/api/settings/api-keys")
def add_api_key(settings: ApiKeySettings) -> dict[str, Any]:
    api_key = settings.api_key.strip()
    name = settings.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Give this API key a name.")
    if len(api_key) < 16 or any(character.isspace() for character in api_key):
        raise HTTPException(status_code=422, detail="Enter a valid TypeSafe API key without spaces.")
    profile = {"id": uuid4().hex, "name": name, "api_key": api_key}
    keys = app.state.api_keys + [profile]
    try:
        save_api_key_settings(keys, profile["id"])
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The API key could not be saved on this server.") from exc
    app.state.api_keys = keys
    app.state.active_api_key_id = profile["id"]
    return public_api_keys()


@app.put("/api/settings/api-keys/{key_id}/activate")
def activate_api_key(key_id: str) -> dict[str, Any]:
    if key_id not in {item["id"] for item in app.state.api_keys}:
        raise HTTPException(status_code=404, detail="API key not found.")
    try:
        save_api_key_settings(app.state.api_keys, key_id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The active API key could not be saved.") from exc
    app.state.active_api_key_id = key_id
    return public_api_keys()


@app.patch("/api/settings/api-keys/{key_id}")
def rename_api_key(key_id: str, settings: ApiKeyRename) -> dict[str, Any]:
    name = settings.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Give this API key a name.")
    if key_id not in {item["id"] for item in app.state.api_keys}:
        raise HTTPException(status_code=404, detail="API key not found.")
    keys = [{**item, "name": name} if item["id"] == key_id else item for item in app.state.api_keys]
    try:
        save_api_key_settings(keys, app.state.active_api_key_id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The API key name could not be saved.") from exc
    app.state.api_keys = keys
    return public_api_keys()


@app.delete("/api/settings/api-keys/{key_id}")
def delete_api_key(key_id: str) -> dict[str, Any]:
    keys = [item for item in app.state.api_keys if item["id"] != key_id]
    if len(keys) == len(app.state.api_keys):
        raise HTTPException(status_code=404, detail="API key not found.")
    active_id = app.state.active_api_key_id
    if active_id == key_id:
        active_id = keys[0]["id"] if keys else None
    try:
        save_api_key_settings(keys, active_id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The saved API key could not be deleted.") from exc
    app.state.api_keys = keys
    app.state.active_api_key_id = active_id
    return public_api_keys()


@app.get("/api/settings/examples")
def list_hidden_examples() -> dict[str, Any]:
    return {"hidden": hidden_examples()}


@app.delete("/api/settings/examples/{name}")
def hide_example(name: str) -> dict[str, Any]:
    if not name.isascii() or not name.replace("_", "").isalnum() or len(name) > 80:
        raise HTTPException(status_code=422, detail="Invalid example name.")
    names = hidden_examples()
    if name not in names:
        names.append(name)
    save_hidden_examples(names)
    return {"hidden": names}


@app.delete("/api/settings/examples")
def restore_examples() -> dict[str, Any]:
    save_hidden_examples([])
    return {"hidden": []}


@app.get("/api/history")
def list_history(limit: int = DEFAULT_HISTORY_LIST_ROWS, offset: int = 0) -> dict[str, Any]:
    safe_limit = DEFAULT_HISTORY_LIST_ROWS if limit <= 0 else min(limit, MAX_HISTORY_LIST_ROWS)
    safe_offset = max(0, offset)
    with history_connection() as connection:
        rows = connection.execute(
            "SELECT id, title, created_at, model, question_count, memo FROM challenge_history ORDER BY id DESC LIMIT ? OFFSET ?",
            (safe_limit, safe_offset),
        ).fetchall()
        total = connection.execute("SELECT COUNT(*) FROM challenge_history").fetchone()[0]
    return {"items": [dict(row) for row in rows], "total": total, "limit": safe_limit, "offset": safe_offset}


@app.get("/api/history/{history_id}")
def history_detail(history_id: int) -> dict[str, Any]:
    with history_connection() as connection:
        row = connection.execute("SELECT * FROM challenge_history WHERE id = ?", (history_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="This saved challenge no longer exists.")
    return {
        "id": row["id"],
        "title": row["title"],
        "created_at": row["created_at"],
        "model": row["model"],
        "question_count": row["question_count"],
        "memo": row["memo"],
        "request": json.loads(row["request_json"]),
        "response": json.loads(row["response_json"]),
        "interpretation": json.loads(row["interpretation_json"]),
    }


@app.patch("/api/history/{history_id}")
def rename_history(history_id: int, update: HistoryRename) -> dict[str, Any]:
    title = " ".join(update.title.split())
    if not title:
        raise HTTPException(status_code=422, detail="Enter a name for this challenge.")
    with history_connection() as connection:
        cursor = connection.execute("UPDATE challenge_history SET title = ? WHERE id = ?", (title, history_id))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="This saved challenge no longer exists.")
    return {"id": history_id, "title": title}


@app.delete("/api/history/{history_id}")
def delete_history(history_id: int) -> dict[str, Any]:
    with history_connection() as connection:
        cursor = connection.execute("DELETE FROM challenge_history WHERE id = ?", (history_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="This saved challenge no longer exists.")
    return {"deleted": True, "id": history_id}


@app.get("/api/drafts")
def list_drafts(limit: int = MAX_DRAFT_LIST_ROWS, offset: int = 0) -> dict[str, Any]:
    safe_limit = MAX_DRAFT_LIST_ROWS if limit <= 0 else min(limit, MAX_DRAFT_LIST_ROWS)
    safe_offset = max(0, offset)
    with history_connection() as connection:
        total = connection.execute("SELECT COUNT(*) FROM challenge_drafts").fetchone()[0]
        rows = connection.execute(
            "SELECT id, title, created_at, updated_at, is_complete, draft_json FROM challenge_drafts ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
            (safe_limit, safe_offset),
        ).fetchall()
    items = []
    for row in rows:
        item = {
            "id": row["id"],
            "title": row["title"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "is_complete": bool(row["is_complete"]),
        }
        try:
            draft = json.loads(row["draft_json"])
        except (TypeError, ValueError):
            draft = {}
        widget = draft.get("_widget") if isinstance(draft, dict) else None
        item["memo"] = str(
            (draft.get("memo") if isinstance(draft, dict) else None)
            or (widget.get("memo") if isinstance(widget, dict) else "")
            or ""
        )
        items.append(item)
    return {"items": items, "total": total, "limit": safe_limit, "offset": safe_offset}


@app.get("/api/drafts/{draft_id}")
def draft_detail(draft_id: int) -> dict[str, Any]:
    with history_connection() as connection:
        row = connection.execute("SELECT * FROM challenge_drafts WHERE id = ?", (draft_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="This draft no longer exists.")
    return {
        "id": row["id"],
        "title": row["title"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "is_complete": bool(row["is_complete"]),
        "draft": json.loads(row["draft_json"]),
    }


@app.post("/api/drafts")
def create_draft(payload: DraftCreate) -> dict[str, Any]:
    title = " ".join(payload.title.split()) if payload.title else draft_title(payload.draft)
    if not title:
        title = "Untitled Jev draft"
    draft_json = enforce_draft_size(payload.draft)
    now = datetime.now(timezone.utc).isoformat()
    with history_connection() as connection:
        cursor = connection.execute(
            """INSERT INTO challenge_drafts (title, created_at, updated_at, is_complete, draft_json)
               VALUES (?, ?, ?, ?, ?)""",
            (title, now, now, int(payload.is_complete), draft_json),
        )
    return {"id": int(cursor.lastrowid), "title": title, "is_complete": payload.is_complete, "updated_at": now}


@app.patch("/api/drafts/{draft_id}")
def update_draft(draft_id: int, payload: DraftUpdate) -> dict[str, Any]:
    with history_connection() as connection:
        current = connection.execute("SELECT * FROM challenge_drafts WHERE id = ?", (draft_id,)).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="This draft no longer exists.")
        title = current["title"]
        if payload.title is not None:
            title = " ".join(payload.title.split())
            if not title:
                raise HTTPException(status_code=422, detail="Enter a name for this draft.")
        draft_json = current["draft_json"] if payload.draft is None else enforce_draft_size(payload.draft)
        is_complete = current["is_complete"] if payload.is_complete is None else int(payload.is_complete)
        updated_at = datetime.now(timezone.utc).isoformat()
        connection.execute(
            "UPDATE challenge_drafts SET title = ?, updated_at = ?, is_complete = ?, draft_json = ? WHERE id = ?",
            (title, updated_at, is_complete, draft_json, draft_id),
        )
    return {"id": draft_id, "title": title, "is_complete": bool(is_complete), "updated_at": updated_at}


@app.delete("/api/drafts/{draft_id}")
def delete_draft(draft_id: int) -> dict[str, Any]:
    with history_connection() as connection:
        cursor = connection.execute("DELETE FROM challenge_drafts WHERE id = ?", (draft_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="This draft no longer exists.")
    return {"deleted": True, "id": draft_id}


@app.post("/api/jev/challenge")
async def jev_challenge(payload: JevChallengeRequest) -> dict[str, Any]:
    api_key = active_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="Add your TypeSafe API key before challenging Jev.")
    request_json = validate_challenge(payload)
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            response = await client.post(JEV_URL, headers={"Authorization": f"Bearer {api_key}"}, json=request_json)
        if response.is_error:
            try:
                provider_detail = response.json().get("detail")
            except Exception:
                provider_detail = None
            logger.warning("Jev provider error HTTP %s: %s", response.status_code, provider_detail)
            raise HTTPException(
                status_code=502 if response.status_code >= 500 else 400,
                detail=f"Jev rejected the request (HTTP {response.status_code}).",
            )
        data = response.json()
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Jev took too long to answer. Please try again.") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Could not get a valid answer from Jev.") from exc
    interpretation = explain_jev_answers(data)
    history_id, title = store_challenge_history(request_json, data, interpretation, payload.memo.strip())
    return {"request": request_json, "response": data, "interpretation": interpretation, "history_id": history_id, "history_title": title, "memo": payload.memo.strip()}


app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


def _set_service_token_cookie(response) -> None:
    response.set_cookie(
        key=SERVICE_TOKEN_COOKIE,
        value=SERVICE_TOKEN,
        httponly=True,
        samesite="strict",
        path="/",
        max_age=365 * 24 * 60 * 60,
    )


@app.post("/api/session/cookie")
def issue_session_cookie() -> JSONResponse:
    """Exchange a valid Bearer token for an HttpOnly cookie (same-origin browser UI)."""
    response = JSONResponse({"ok": True})
    _set_service_token_cookie(response)
    return response


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


@app.get("/{path:path}")
def frontend(path: str = "") -> FileResponse:
    return FileResponse(FRONTEND / "index.html")
