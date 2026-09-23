from __future__ import annotations

import os
import json
import sqlite3
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
HISTORY_DB = Path(os.getenv("JEV_HISTORY_DB", ROOT / "data" / "history.db"))


def load_saved_api_key() -> str:
    try:
        settings = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return str(settings.get("typesafe_api_key", "")).strip()
    except (FileNotFoundError, OSError, ValueError, TypeError):
        return ""


def save_api_key(api_key: str) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = SETTINGS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps({"typesafe_api_key": api_key}), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(SETTINGS_FILE)


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
                interpretation_json TEXT NOT NULL
            )
        """)
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


def store_challenge_history(request_json: dict[str, Any], response_json: dict[str, Any], interpretation: list[dict[str, Any]]) -> tuple[int, str]:
    title = challenge_title(request_json)
    created_at = datetime.now(timezone.utc).isoformat()
    with history_connection() as connection:
        cursor = connection.execute(
            """INSERT INTO challenge_history
               (title, created_at, model, question_count, request_json, response_json, interpretation_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                title,
                created_at,
                str(response_json.get("model") or request_json.get("model") or "jev-latest"),
                len(request_json.get("questions", {})),
                json.dumps(request_json, ensure_ascii=False),
                json.dumps(response_json, ensure_ascii=False),
                json.dumps(interpretation, ensure_ascii=False),
            ),
        )
    return int(cursor.lastrowid), title

app = FastAPI(title="Jev Challenge Lab", version="2.0.0")
app.state.jev_api_key = load_saved_api_key() or os.getenv("TYPESAFE_API_KEY", "").strip()
initialize_history()


class JevChallengeRequest(BaseModel):
    state: Any
    model: str = Field(default="jev-latest", min_length=1, max_length=80)
    questions: dict[str, dict[str, Any]] = Field(min_length=1, max_length=50)


class ApiKeySettings(BaseModel):
    api_key: str = Field(min_length=16, max_length=512)


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
    return {"status": "ok", "jev_connected": bool(app.state.jev_api_key)}


@app.post("/api/settings/api-key")
def update_api_key(settings: ApiKeySettings) -> dict[str, Any]:
    api_key = settings.api_key.strip()
    if len(api_key) < 16 or any(character.isspace() for character in api_key):
        raise HTTPException(status_code=422, detail="Enter a valid TypeSafe API key without spaces.")
    try:
        save_api_key(api_key)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The API key could not be saved on this server.") from exc
    app.state.jev_api_key = api_key
    return {"saved": True, "jev_connected": True}


@app.get("/api/history")
def list_history(limit: int = 0) -> dict[str, Any]:
    with history_connection() as connection:
        if limit > 0:
            safe_limit = min(limit, 5000)
            rows = connection.execute(
                "SELECT id, title, created_at, model, question_count FROM challenge_history ORDER BY id DESC LIMIT ?",
                (safe_limit,),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT id, title, created_at, model, question_count FROM challenge_history ORDER BY id DESC"
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
            "SELECT id, title, created_at, updated_at, is_complete FROM challenge_drafts ORDER BY updated_at DESC, id DESC"
        ).fetchall()
    items = [dict(row) for row in rows]
    for item in items:
        item["is_complete"] = bool(item["is_complete"])
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
    api_key = app.state.jev_api_key
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
    history_id, title = store_challenge_history(request_json, data, interpretation)
    return {"request": request_json, "response": data, "interpretation": interpretation, "history_id": history_id, "history_title": title}


app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


@app.get("/{path:path}")
def frontend(path: str = "") -> FileResponse:
    return FileResponse(FRONTEND / "index.html")
