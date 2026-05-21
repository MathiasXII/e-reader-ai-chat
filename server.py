"""E-Reader LLM Gateway — minimal FastAPI server that proxies to OpenAI-compatible
endpoints. Serves a static chat UI optimised for e-reader browsers."""

import json
import os
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

PERSIST_SESSIONS = os.environ.get("PERSIST_SESSIONS", "0") == "1"
SESSIONS_FILE = Path(__file__).parent / "sessions.json"
DATA_DIR = os.environ.get("DATA_DIR", "data") or ""

app = FastAPI()

# ── Session store ────────────────────────────────────────────────────────
sessions: dict[str, dict] = {}

if PERSIST_SESSIONS and SESSIONS_FILE.exists():
    sessions = json.loads(SESSIONS_FILE.read_text("utf-8"))

STATIC_DIR = Path(__file__).parent / "static"


def _persist_sessions() -> None:
    """Atomically write sessions to disk when persistence is enabled."""
    if not PERSIST_SESSIONS:
        return
    try:
        fd, tmp_path = tempfile.mkstemp(dir=str(SESSIONS_FILE.parent))
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(sessions, f, ensure_ascii=False)
        os.replace(tmp_path, str(SESSIONS_FILE))
    except OSError:
        pass


# ── Conversation persistence helpers ──────────────────────────────────────

def _conversation_dir(session_id: str) -> Path:
    return Path(DATA_DIR) / session_id / "conversations"


def _conversation_path(session_id: str, conv_id: str) -> Path:
    return _conversation_dir(session_id) / f"{conv_id}.json"


def _read_conversation(session_id: str, conv_id: str) -> dict | None:
    path = _conversation_path(session_id, conv_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write_conversation(session_id: str, conv_id: str, data: dict) -> None:
    conv_dir = _conversation_dir(session_id)
    path = _conversation_path(session_id, conv_id)
    try:
        fd, tmp_path = tempfile.mkstemp(dir=str(conv_dir))
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, str(path))
    except OSError:
        pass


def _ensure_conversation_dir(session_id: str) -> None:
    if not DATA_DIR:
        return
    conv_dir = _conversation_dir(session_id)
    conv_dir.mkdir(parents=True, exist_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────

def _get_session(request: Request) -> tuple[str, dict]:
    sid = request.cookies.get("sid")
    if not sid or sid not in sessions:
        sid = str(uuid.uuid4())
        sessions[sid] = {}
    return sid, sessions[sid]


# ── Routes ───────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    html = (STATIC_DIR / "index.html").read_text("utf-8")
    return HTMLResponse(html)


@app.get("/api/session/config")
async def get_config(request: Request):
    sid, sess = _get_session(request)
    response = JSONResponse({
        "base_url": sess.get("base_url", ""),
        "model": sess.get("model", ""),
        "has_api_key": bool(sess.get("api_key")),
        "display_names": sess.get("display_names", True),
    })
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


@app.post("/api/session/config")
async def set_config(request: Request):
    body = await request.json()
    base_url = (body.get("base_url") or "").rstrip("/")
    model = (body.get("model") or "").strip()
    api_key = (body.get("api_key") or "").strip()
    display_names = body.get("display_names")

    sid, sess = _get_session(request)

    # Partial updates: only overwrite fields that are explicitly provided
    if base_url:
        sess["base_url"] = base_url
    elif "base_url" not in sess:
        raise HTTPException(400, "base_url is required")

    if model:
        sess["model"] = model
    elif "model" not in sess:
        sess["model"] = model

    if api_key:
        sess["api_key"] = api_key
    # empty string = keep existing key (field is always blank on open for security)

    if display_names is not None:
        sess["display_names"] = bool(display_names)

    _persist_sessions()
    if DATA_DIR:
        _ensure_conversation_dir(sid)

    response = JSONResponse({
        "base_url": sess.get("base_url", ""),
        "model": sess.get("model", ""),
        "has_api_key": bool(sess.get("api_key")),
        "display_names": sess.get("display_names", True),
    })
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


@app.get("/api/session/models")
async def list_models(request: Request):
    sid, sess = _get_session(request)
    base_url = sess.get("base_url")
    if not base_url:
        raise HTTPException(400, "Configure base_url first")

    headers = {}
    if sess.get("api_key"):
        headers["Authorization"] = f"Bearer {sess['api_key']}"

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{base_url}/models", headers=headers)
        r.raise_for_status()

    response = JSONResponse(r.json())
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


# ── Conversation CRUD ─────────────────────────────────────────────────────

@app.get("/api/conversations")
async def list_conversations(request: Request):
    sid, sess = _get_session(request)
    if not DATA_DIR:
        return JSONResponse({"conversations": []})

    conv_dir = _conversation_dir(sid)
    if not conv_dir.exists():
        return JSONResponse({"conversations": []})

    conversations = []
    for fname in os.listdir(conv_dir):
        if not fname.endswith(".json"):
            continue
        conv_id = fname[:-5]
        data = _read_conversation(sid, conv_id)
        if data and data.get("session_id") == sid:
            conversations.append({
                "id": data["id"],
                "title": data.get("title", ""),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
            })

    conversations.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    response = JSONResponse({"conversations": conversations})
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


@app.post("/api/conversations")
async def create_conversation(request: Request):
    sid, sess = _get_session(request)
    if not DATA_DIR:
        raise HTTPException(400, "Conversation persistence not enabled")

    body = await request.json()
    title = (body.get("title") or "").strip()

    conv_id = uuid.uuid4().hex[:8]
    now = datetime.now().isoformat(timespec="seconds")
    conversation = {
        "id": conv_id,
        "session_id": sid,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }

    _ensure_conversation_dir(sid)
    _write_conversation(sid, conv_id, conversation)

    response = JSONResponse(conversation)
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str, request: Request):
    sid, sess = _get_session(request)
    if not DATA_DIR:
        raise HTTPException(404, "Conversation not found")

    data = _read_conversation(sid, conv_id)
    if not data or data.get("session_id") != sid:
        raise HTTPException(404, "Conversation not found")

    response = JSONResponse(data)
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


@app.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str, request: Request):
    sid, sess = _get_session(request)
    if not DATA_DIR:
        raise HTTPException(404, "Conversation not found")

    data = _read_conversation(sid, conv_id)
    if not data or data.get("session_id") != sid:
        raise HTTPException(404, "Conversation not found")

    path = _conversation_path(sid, conv_id)
    try:
        path.unlink()
    except OSError:
        pass

    response = JSONResponse({"ok": True})
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


@app.patch("/api/conversations/{conv_id}")
async def update_conversation(conv_id: str, request: Request):
    sid, sess = _get_session(request)
    if not DATA_DIR:
        raise HTTPException(404, "Conversation not found")

    data = _read_conversation(sid, conv_id)
    if not data or data.get("session_id") != sid:
        raise HTTPException(404, "Conversation not found")

    body = await request.json()
    new_title = body.get("title")
    if new_title is not None:
        data["title"] = new_title
    data["updated_at"] = datetime.now().isoformat(timespec="seconds")

    _write_conversation(sid, conv_id, data)

    response = JSONResponse(data)
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    sid, sess = _get_session(request)

    base_url = sess.get("base_url")
    model = sess.get("model")
    if not base_url:
        raise HTTPException(400, "Configure base_url first")

    # Build OpenAI-compatible payload
    messages = body.get("messages")
    if not messages:
        user_msg = body.get("message", "").strip()
        if not user_msg:
            raise HTTPException(400, "message is required")
        messages = [{"role": "user", "content": user_msg}]

    payload = {
        "model": model or body.get("model", ""),
        "messages": messages,
        "stream": False,
    }
    if not payload["model"]:
        raise HTTPException(400, "model is required (set in session config or request)")

    # Conversation persistence: load and verify if conversation_id provided
    conversation_id = body.get("conversation_id")
    conversation = None
    if conversation_id and DATA_DIR:
        conversation = _read_conversation(sid, conversation_id)
        if not conversation or conversation.get("session_id") != sid:
            raise HTTPException(404, "Conversation not found")

    # Persist user message before sending to LLM
    if conversation is not None:
        now = datetime.now().isoformat(timespec="seconds")
        user_content = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_content = m.get("content", "")
                break
        conversation["messages"].append({
            "role": "user",
            "content": user_content,
            "created_at": now,
        })
        # Auto-generate title from first user message if title is empty
        if not conversation.get("title") and user_content:
            conversation["title"] = user_content.replace("\n", " ")[:40]
        conversation["updated_at"] = now
        _write_conversation(sid, conversation_id, conversation)

    headers = {"Content-Type": "application/json"}
    if sess.get("api_key"):
        headers["Authorization"] = f"Bearer {sess['api_key']}"

    url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(url, json=payload, headers=headers)

    if r.status_code != 200:
        try:
            detail = r.json()
        except Exception:
            detail = r.text[:500]
        raise HTTPException(r.status_code, detail)

    data = r.json()
    content = ""
    choices = data.get("choices") or []
    if choices:
        content = choices[0].get("message", {}).get("content", "")

    # Persist assistant message after receiving LLM response
    if conversation is not None:
        now = datetime.now().isoformat(timespec="seconds")
        conversation["messages"].append({
            "role": "assistant",
            "content": content,
            "created_at": now,
        })
        conversation["updated_at"] = now
        _write_conversation(sid, conversation_id, conversation)

    result = {"reply": content, "model": payload["model"]}
    if conversation_id and DATA_DIR:
        result["conversation_id"] = conversation_id

    response = JSONResponse(result)
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


# ── Static files (app.js etc.) served last so /api routes take priority ──
app.mount("/", StaticFiles(directory=str(STATIC_DIR)), name="static")
