"""Kindle LLM Gateway — minimal FastAPI server that proxies to OpenAI-compatible
endpoints on private/LAN addresses only. Serves a static chat UI optimised for
the Kindle Scribe browser."""

import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# ── In-memory session store (resets on server restart) ────────────────────
sessions: dict[str, dict] = {}

STATIC_DIR = Path(__file__).parent / "static"


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
    })
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


@app.post("/api/session/config")
async def set_config(request: Request):
    body = await request.json()
    base_url = (body.get("base_url") or "").rstrip("/")
    model = (body.get("model") or "").strip()
    api_key = (body.get("api_key") or "").strip()

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

    response = JSONResponse({
        "base_url": sess.get("base_url", ""),
        "model": sess.get("model", ""),
        "has_api_key": bool(sess.get("api_key")),
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

    response = JSONResponse({"reply": content, "model": payload["model"]})
    response.set_cookie("sid", sid, httponly=True, max_age=86400 * 30)
    return response


# ── Static files (app.js etc.) served last so /api routes take priority ──
app.mount("/", StaticFiles(directory=str(STATIC_DIR)), name="static")