# Roadmap

## Versioning Convention

- **Minor version** (v0.2 → v0.3): New user-facing feature
- **Patch version** (v0.2.1): Bug fixes, internal improvements
- **Major version** (v1.0): All core initiatives complete, API considered stable
- Initiatives are not tied to versions. Assign a version when work begins.

## Conversation Persistence

**Status:** done

Messages survive page refresh. No new UI — just make the current chat not disappear.

### Storage: one JSON file per conversation

```
data/
    <session-id>/
        conversations/
            a1b2c3.json
            d4e5f6.json
        ...
```

Each file is a self-contained, human-readable JSON document:

```json
{
  "id": "a1b2c3",
  "title": "How to bake sourdough",
  "created_at": "2026-05-20T10:30:00",
  "updated_at": "2026-05-20T10:45:00",
  "messages": [
    {"role": "user", "content": "How do I make sourdough?", "created_at": "..."},
    {"role": "assistant", "content": "Start with a starter...", "created_at": "..."}
  ]
}
```

### Backend

- New API endpoints:

  | Method | Path | Description |
  |--------|------|-------------|
  | `GET` | `/api/conversations` | List conversations for the current session |
  | `POST` | `/api/conversations` | Create a new conversation |
  | `GET` | `/api/conversations/{id}` | Get a conversation with its messages |
  | `DELETE` | `/api/conversations/{id}` | Delete a conversation |
  | `PATCH` | `/api/conversations/{id}` | Update conversation (e.g. rename) |

- Modify `/api/chat` to accept `conversation_id` and persist messages into the conversation file
- Atomic writes using the same tempfile+rename pattern as `_persist_sessions()`
- List conversations via `os.listdir()`, sorted by file modification time
- On page load, fetch the latest conversation and restore `chatHistory[]` on the frontend
- Auto-generate conversation title from the first user message (truncated to ~40 chars)
- Add `DATA_DIR` env var (default: `data`) to `.env.example`
- Auto-create `data/<session-id>/conversations/` directory on first configuration save if it does not exist.
- Scope conversation files to session: each filename is `{conversation_id}.json`, and `session_id` inside the file is checked on access

### Frontend

- On init, fetch the last active conversation instead of starting with empty `chatHistory[]`
- Send `conversation_id` along with chat requests
- When no conversation exists, create one automatically before the first message

### Constraints

- No localStorage — all state remains server-side
- No new CSS or UI elements in this initiative
- Keep backward compatibility: if `DATA_DIR` is not set, fall back to in-memory ephemeral mode

---

## Conversation Management UI

**Status**: done

Let users browse, switch between, and manage multiple conversations.

### Backend

- Add `GET /api/conversations?limit=&before=` for pagination (cursor-based, by `updated_at`)
- `PATCH /api/conversations/{id}` supports `title` field for manual rename

### Frontend

- Add a **conversation list panel** (slide-in from the left)
  - Toggle button in the header (hamburger or similar)
  - List shows conversation titles + relative timestamps (e.g. "2 hours ago")
  - "New Chat" button at the top
  - Tap a conversation to load it
  - Delete button per conversation (simple confirm: "Delete this chat?")
- **Auto-conversation creation**: When a conversation has no messages and the user sends the first message, the server creates it and returns the `conversation_id`
- Highlight the active conversation in the list
- On "New Chat", clear the message area and start a fresh conversation

### CSS constraints

- No CSS `gap` on flex containers — use `margin` on children
- No CSS features requiring Chrome 84+
- Table-based or flex layouts only, no CSS Grid
- Inline `<style>` only — no build step

---

## Multi-Session Support

**Status**: postponed

> Authentication would add login friction that e-readers handle poorly — form-based login, redirects, and token refresh all fight against devices that lose cookies on sleep or restart. The `?device=` bookmark mechanism already provides stable session recovery, which is what e-readers actually need.
>
> More fundamentally, this is a LAN-only tool. Anyone on the network can reach the server directly, so auth provides a false sense of security without HTTPS. If real isolation is ever needed, running separate instances on different ports per trusted user group is simpler and more honest than bolting auth onto a single instance.

Multiple people on the same LAN can use the gateway independently without seeing each other's conversations.

### Approach: Cookie-scoped (implicit multi-user)

Since this is a LAN-only app, explicit authentication is overkill. Each e-reader/browser gets its own `sid` cookie, and conversations are scoped to that session.

- Conversations are already scoped to `session_id` in each conversation file
- No login screen needed — the `sid` cookie is the identity
- Each device automatically gets its own conversation space

### Optional: Named sessions

If users want to identify themselves (e.g. shared family device):

- Add an optional **display name** field in the settings panel
- Stored in session config alongside `base_url`, `model`, etc.
- Purely cosmetic — shown in the header, not used for access control
- `POST /api/session/config` accepts a `display_name` field

### Extension: Real authentication

**Status**: postponed 

- Add a `users/` directory with JSON profile files (`username.json` containing `password_hash`, etc.)
- Add `user_id` field to conversation files
- Add a `/api/auth/login` endpoint
- The `session_id`-based scoping becomes `user_id`-based scoping
- Just an additional field in the JSON — no migration needed

---

## Status Indicator & Cancel

**Status:** done

While the LLM generates a response, the UI shows status messages (Sending → Thinking → Generating) so the user knows the request is alive. The send button becomes "Cancel" during generation, allowing the user to abort an in-progress request. The full response is rendered in one shot when complete — no progressive text updates that cause screen flashing on e-ink.

### Backend

- `/api/chat` now uses `stream: True` when calling the upstream LLM, enabling cancellation and status tracking
- Returns a `StreamingResponse` with newline-delimited JSON (`application/x-ndjson`)
- Status events emitted during generation: `{"type":"status","message":"Sending..."}`, `{"type":"status","message":"Thinking..."}`, `{"type":"status","message":"Generating..."}`
- Final event: `{"type":"done","content":"full text","model":"...","conversation_id":"..."}`
- Error event: `{"type":"error","message":"..."}`
- Cancelled event: `{"type":"cancelled","content":"partial text"}`
- Assistant message is persisted to the conversation file only after the stream completes successfully
- `POST /api/chat/cancel` endpoint aborts the current in-progress request for the session
  - Tracks active requests per session using an in-memory dict of `asyncio.Event`

### Frontend

- Uses `XMLHttpRequest` with `onprogress` (not `EventSource` — poor support on old WebKit) to read the NDJSON stream
- Parses newline-delimited JSON chunks from `xhr.responseText`
- Shows status text in the assistant message placeholder (`<span class="msg-status">`)
- **Cancel button**: the send button text changes to "Cancel" during generation
  - Calls `POST /api/chat/cancel`
  - Aborts the XHR request
  - Leaves the partial response (if any) visible in the chat, removes the message div if no partial content
- No progressive text rendering — the full response replaces the status indicator once complete

---

## Streaming Responses

**Status**: planned

Sentence-batched streaming so users see the reply progressively instead of waiting for the full response. Controlled per-session because e-reader display refresh behaviour varies by device.

### Why sentence-batching, not per-token

Per-token streaming (like ChatGPT on LCD) would cause hundreds of screen refreshes per response. On e-ink, each DOM change triggers a display controller refresh — on Kobo devices this is a full-screen flash, making per-token streaming unusable.

Sentence-batching buffers tokens server-side until a sentence boundary (`.`, `?`, `!` + whitespace or newline), then sends the complete sentence as one chunk. This limits screen refreshes to ~5-15 per response — the same as turning a few pages — instead of hundreds.

### Session option

- New `streaming` field in session config (default: `1`)
- When ON: server sends sentence-batched chunks; client renders incrementally
- When OFF: server buffers the full response internally, returns a single NDJSON `done` event — identical to current behaviour
- Toggle in the settings panel so Kobo users (full-screen flash on every DOM change) can turn it off
- Both modes support the cancel button (already implemented)

### Transport vs. rendering split

The server already streams from the upstream LLM (`stream: True`) and sends NDJSON to the client. This initiative adds sentence-batched chunk events between the existing status events and the final `done` event.

| Layer | Behaviour | Controlled by |
|---|---|---|
| **Transport** (server ↔ LLM) | Always streaming | Server-side, always on (✅ implemented) |
| **Rendering** (server → e-reader) | Sentence-batched chunks or single response | Per-session `streaming` option (❌ not yet implemented) |

### Backend

- When session `streaming` is ON:
  - Buffer tokens until a sentence boundary, then emit a chunk event: `{"type":"chunk","content":"..."}`
  - Final line remains: `{"type":"done","content":"full text","model":"...","conversation_id":"..."}`
  - Error line remains: `{"type":"error","message":"..."}`
- When session `streaming` is OFF:
  - Current behaviour — buffer full response, emit only status events and a final `done` event
  - Cancel still works via the existing `asyncio.Event` mechanism

### Frontend

- Add a **streaming toggle** (checkbox) to the settings panel
- When streaming ON:
  - On each `{"type":"chunk"}` event, append the sentence to the assistant message element (update innerHTML, not create new elements)
  - Re-render through `markdownToHTML()` on the full accumulated text per chunk (not delta) — ensures consistent formatting
- When streaming OFF:
  - Current behaviour — status indicator followed by the final rendered response
- Both modes already support the cancel button (implemented)

### Constraints

- No `EventSource` — use XHR `onprogress` for WebKit 533 compatibility
- No CSS changes — reuse the existing send button and status indicator
- Sentence boundary detection: `.`, `?`, `!`, `。`, `？`, `！` followed by whitespace or newline. Must not split on decimal points (`3.14`) or abbreviations (`e.g.`) — use a simple lookahead rule
- E-reader browsers may have poor streaming support — test on target devices before considering this stable

---

## Conversation Export

**Status**: planned

Let users download conversations for offline reading or archival.

- `GET /api/conversations/{id}/export?format=markdown` — download as `.md`
- `GET /api/conversations/{id}/export?format=text` — download as `.txt`
- Simple frontend button in the conversation panel
- Trivial to implement: conversation files are already JSON, just transform the format

---

## Full-Text Search

**Status**: planned

Find messages across all conversations.

- Server-side: iterate conversation files and match against query string
- `GET /api/search?q=&limit=` — returns matching messages with conversation context
- Add a search input to the conversation panel
- For small scale (LAN use), file iteration is fast enough
- If scale demands it later, an optional SQLite FTS5 index can be added on top of the files without replacing them

---

## LLM-Generated Titles

**Status**: planned

Auto-generate descriptive conversation titles instead of truncating the first message.

- After the first exchange, make a lightweight LLM call to generate a 3-5 word title
- `POST /api/conversations/{id}/generate-title` — returns and persists the generated title
- Controlled by a `AUTO_GENERATE_TITLES` env var (default: `0`)
- Uses the same model/endpoint configured for chat

---

## Token Usage Tracking

**Status**: planned

Show how many tokens each conversation consumes.

- Track `usage` from OpenAI API responses (prompt_tokens, completion_tokens)
- Add optional `token_usage` field to each message in the conversation JSON
- Show a subtle token counter in the UI (total for current conversation)

---

## Theme and Display Options

**Status**: planned

Customize the reading experience per session.

- Dark mode toggle (inverted colors — white text on black background)
- Font size adjustment
- Stored per-session in session config
