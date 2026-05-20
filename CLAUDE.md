# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

E-Reader LLM is a gateway web app that lets an e-reader browser chat with an OpenAI-compatible LLM endpoint. The e-reader browser only talks to the gateway (same-origin, plain HTTP on LAN), and the gateway proxies requests to the configured base URL.

Target deployment: LAN-only, plain HTTP, running on a PC accessible to the e-reader on the same network.

## Architecture

```
E-Reader Browser ──HTTP──▸ Gateway (FastAPI) ──HTTP──▸ OpenAI-compatible endpoint
                           │
                           ├─ Serves static/ (index.html, app.js)
                           ├─ /api/session/config  — per-session base_url, model, api_key
                           ├─ /api/session/models   — proxy: GET {base_url}/models
                           └─ /api/chat             — proxy: POST {base_url}/chat/completions
```

- **server.py** — Single-file FastAPI backend. Session state is in-memory (dict keyed by cookie `sid`). All LLM traffic is proxied server-side so the e-reader never hits CORS or mixed-content issues.
- **static/index.html** — E-reader-friendly chat UI. No frameworks. Minimal CSS (black-on-white, large touch targets, Georgia serif font).
- **static/app.js** — Plain ES5-ish JS. No build step. Uses `fetch()` for same-origin API calls. Sends full chat history on each request. Settings panel opens automatically if no `base_url` is configured.

## Commands

```powershell
# Install dependencies
pip install -r requirements.txt

# Start server (foreground, Ctrl+C to stop, auto-kills existing on same port)
.\start.ps1                    # default: port 8000, host 0.0.0.0
.\start.ps1 -Port 9000         # custom port
```

## Key Constraints

- **Session state**: By default, sessions are in-memory and lost on restart. Set `PERSIST_SESSIONS=1` in `.env` to save session config (base_url, model, api_key) to `sessions.json` so it survives restarts.
- **No JS frameworks**: The frontend must stay compatible with e-reader browsers (limited engine support). No React/Vue/TypeScript bundlers. Use plain JS compatible with older engines.
- **Chat is non-streaming**: Both the gateway and frontend currently use `stream: false`. The entire response is returned at once. Streaming (SSE) could be added later as an enhancement.
- **No localStorage**: Session config lives server-side in cookies (`sid`). The frontend does not use localStorage or sessionStorage.
- **`.env.example` must stay in sync**: Whenever a new env var is added to the project, update both `.env.example` and the documentation. `.env.example` serves as the template; users copy it to `.env` and fill in their values.

## Unsupported CSS (E-Reader browser)

E-readers typically run older Chromium engines. Avoid CSS features from these specifications:

- **CSS Box Alignment Module Level 3** — `gap` on flex containers does not work. Use `margin` on flex children instead.
- **Unknown baseline** — When in doubt, stick to CSS features supported in Chrome ≤70. If a property is only in a Working Draft or requires Chrome 84+, assume the e-reader does not support it.
