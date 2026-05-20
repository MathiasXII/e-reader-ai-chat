# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kindle LLM is a gateway web app that lets a Kindle Scribe browser chat with an OpenAI-compatible LLM endpoint. The Kindle browser only talks to the gateway (same-origin, plain HTTP on LAN), and the gateway proxies requests to the configured base URL (restricted to private/LAN addresses only).

Target deployment: LAN-only, plain HTTP, running on a PC accessible to the Kindle on the same network.

## Architecture

```
Kindle Browser ──HTTP──▸ Gateway (FastAPI) ──HTTP──▸ OpenAI-compatible endpoint
                           │
                           ├─ Serves static/ (index.html, app.js)
                           ├─ /api/session/config  — per-session base_url, model, api_key
                           ├─ /api/session/models   — proxy: GET {base_url}/models
                           └─ /api/chat             — proxy: POST {base_url}/chat/completions
```

- **server.py** — Single-file FastAPI backend. Session state is in-memory (dict keyed by cookie `sid`). All LLM traffic is proxied server-side so the Kindle never hits CORS or mixed-content issues. The `_is_private_url()` function enforces that only RFC1918/localhost/.local/bare-hostname base URLs are allowed.
- **static/index.html** — Kindle-friendly chat UI. No frameworks. Minimal CSS (black-on-white, large touch targets, Georgia serif font).
- **static/app.js** — Plain ES5-ish JS. No build step. Uses `fetch()` for same-origin API calls. Sends full chat history on each request. Settings panel opens automatically if no `base_url` is configured.

## Commands

```powershell
# Install dependencies
pip install -r requirements.txt

# Start server (foreground, Ctrl+C to stop, auto-kills existing on same port)
.\start.ps1                    # default: port 8000, host 0.0.0.0
.\start.ps1 -Port 9000         # custom port

# Stop a running/background server by port
.\stop.ps1                     # default: port 8000
.\stop.ps1 -Port 9000          # custom port

# Alternative: run directly
python -m uvicorn server:app --host 0.0.0.0 --port 8000
```

## Key Constraints

- **LAN-only base URLs**: The `_is_private_url()` function in server.py rejects any base URL that isn't a private IP, localhost, `.local`, or a bare hostname. Do not weaken this check without understanding the SSRF implications.
- **Session state is in-memory**: Restarting the server clears all sessions. The frontend re-reads config from `/api/session/config` on load, so users just need to re-enter settings.
- **No JS frameworks**: The frontend must stay compatible with the Kindle Scribe's limited browser. No React/Vue/TypeScript bundlers. Use plain JS compatible with older engines.
- **Chat is non-streaming**: Both the gateway and frontend currently use `stream: false`. The entire response is returned at once. Streaming (SSE) could be added later as an enhancement.
- **No localStorage**: Session config lives server-side in cookies (`sid`). The frontend does not use localStorage or sessionStorage.

## Unsupported CSS (Kindle Scribe browser)

The Kindle Scribe runs an older Chromium engine. Avoid CSS features from these specifications:

- **CSS Box Alignment Module Level 3** — `gap` on flex containers does not work. Use `margin` on flex children instead.
- **Unknown baseline** — When in doubt, stick to CSS features supported in Chrome ≤70. If a property is only in a Working Draft or requires Chrome 84+, assume the Kindle does not support it.