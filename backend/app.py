from __future__ import annotations

import os
import json
import sqlite3
from uuid import uuid4
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
load_dotenv(ROOT / ".env")
JEV_URL = "https://api.typesafe.ai/v1/systemone"
SETTINGS_FILE = Path(os.getenv("JEV_SETTINGS_FILE", ROOT / "data" / "settings.json"))
EXAMPLES_FILE = SETTINGS_FILE.with_name("hidden_examples.json")
HISTORY_DB = Path(os.getenv("JEV_HISTORY_DB", ROOT / "data" / "history.db"))


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
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = SETTINGS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps({"api_keys": keys, "active_api_key_id": active_id}), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(SETTINGS_FILE)


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
    EXAMPLES_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = EXAMPLES_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(names), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(EXAMPLES_FILE)


def history_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(HISTORY_DB, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_history() -> None:
    HISTORY_DB.parent.mkdir(parents=True, exist_ok=True)
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
    HISTORY_DB.chmod(0o600)


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

app = FastAPI(title="Jev Challenge Lab", version="2.0.0")
app.state.api_keys, app.state.active_api_key_id = load_api_key_settings()
initialize_history()


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


def validate_challenge(payload: JevChallengeRequest) -> dict[str, Any]:
    if not isinstance(payload.state, (str, dict, list)):
        raise HTTPException(status_code=422, detail="The scenario must be text, a JSON object, or a JSON list.")
    if isinstance(payload.state, str) and not payload.state.strip():
        raise HTTPException(status_code=422, detail="Enter a scenario for Jev to evaluate.")

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

        clean: dict[str, Any] = {"type": question_type}
        if instructions not in (None, ""):
            clean["instructions"] = instructions
        criteria = question.get("criteria")
        if question_type == "choice":
            if not isinstance(criteria, dict) or not criteria:
                raise HTTPException(status_code=422, detail=f"Choice question '{name}' needs at least one option.")
            if len(criteria) > 255:
                raise HTTPException(status_code=422, detail=f"Choice question '{name}' can have at most 255 options.")
            clean["criteria"] = criteria
        elif question_type == "score":
            if not isinstance(criteria, list) or not criteria:
                raise HTTPException(status_code=422, detail=f"Score question '{name}' needs at least one ordered level.")
            if len(criteria) > 10:
                raise HTTPException(status_code=422, detail=f"Score question '{name}' can have at most 10 levels.")
            clean["criteria"] = criteria
        elif criteria is not None:
            if not isinstance(criteria, dict) or any(key not in {"true", "false"} for key in criteria):
                raise HTTPException(status_code=422, detail=f"Noul criteria for '{name}' must define true and/or false.")
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
def list_history(limit: int = 0) -> dict[str, Any]:
    with history_connection() as connection:
        if limit > 0:
            safe_limit = min(limit, 5000)
            rows = connection.execute(
                "SELECT id, title, created_at, model, question_count, memo FROM challenge_history ORDER BY id DESC LIMIT ?",
                (safe_limit,),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT id, title, created_at, model, question_count, memo FROM challenge_history ORDER BY id DESC"
            ).fetchall()
        total = connection.execute("SELECT COUNT(*) FROM challenge_history").fetchone()[0]
    return {"items": [dict(row) for row in rows], "total": total}


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
def list_drafts() -> dict[str, Any]:
    with history_connection() as connection:
        rows = connection.execute(
            "SELECT id, title, created_at, updated_at, is_complete, draft_json FROM challenge_drafts ORDER BY updated_at DESC, id DESC"
        ).fetchall()
    items = [dict(row) for row in rows]
    for item in items:
        item["is_complete"] = bool(item["is_complete"])
        draft = json.loads(item.pop("draft_json"))
        widget = draft.get("_widget")
        item["memo"] = str(draft.get("memo") or (widget.get("memo") if isinstance(widget, dict) else "") or "")
    return {"items": items, "total": len(items)}


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
    now = datetime.now(timezone.utc).isoformat()
    with history_connection() as connection:
        cursor = connection.execute(
            """INSERT INTO challenge_drafts (title, created_at, updated_at, is_complete, draft_json)
               VALUES (?, ?, ?, ?, ?)""",
            (title, now, now, int(payload.is_complete), json.dumps(payload.draft, ensure_ascii=False)),
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
        draft_json = current["draft_json"] if payload.draft is None else json.dumps(payload.draft, ensure_ascii=False)
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
            raise HTTPException(status_code=response.status_code, detail=provider_detail or f"Jev rejected the request (HTTP {response.status_code}).")
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


@app.get("/{path:path}")
def frontend(path: str = "") -> FileResponse:
    return FileResponse(FRONTEND / "index.html")
