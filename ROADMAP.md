# Roadmap

## Versioning Convention

- **Minor version** (v0.2 → v0.3): New user-facing feature
- **Patch version** (v0.2.1): Bug fixes, internal improvements
- **Major version** (v1.0): All core initiatives complete, API considered stable
- Initiatives are not tied to versions. Assign a version when work begins.

## Conversation Persistence

**Status**: planned

Messages survive page refresh. No new UI — just make the current chat not disappear.

### Backend

- Introduce **SQLite** as the storage backend (`data/db.sqlite3`)
  - Use Python stdlib `sqlite3` — zero new dependencies
  - One file, atomic writes, no corruption risk
- Database schema:

  ```sql
  CREATE TABLE conversations (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE INDEX idx_messages_conv ON messages(conversation_id);
  CREATE INDEX idx_conversations_session ON conversations(session_id);
  ```

- New API endpoints:

  | Method | Path | Description |
  |--------|------|-------------|
  | `GET` | `/api/conversations` | List conversations for the current session |
  | `POST` | `/api/conversations` | Create a new conversation |
  | `GET` | `/api/conversations/{id}` | Get a conversation with its messages |
  | `DELETE` | `/api/conversations/{id}` | Delete a conversation |
  | `PATCH` | `/api/conversations/{id}` | Update conversation (e.g. rename) |

- Modify `/api/chat` to accept `conversation_id` and persist messages into the database
- On page load, fetch the latest conversation and restore `chatHistory[]` on the frontend
- Auto-generate conversation title from the first user message (truncated to ~40 chars)
- Add `DB_PATH` env var (default: `data/db.sqlite3`) to `.env.example`
- Auto-create `data/` directory on startup if it doesn't exist

### Frontend

- On init, fetch the last active conversation instead of starting with empty `chatHistory[]`
- Send `conversation_id` along with chat requests
- When no conversation exists, create one automatically before the first message

### Constraints

- No localStorage — all state remains server-side
- No new CSS or UI elements in this initiative
- Keep backward compatibility: if `DB_PATH` is not set, fall back to in-memory ephemeral mode

---

## Conversation Management UI

**Status**: planned

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

**Status**: planned

Multiple people on the same LAN can use the gateway independently without seeing each other's conversations.

### Approach: Cookie-scoped (implicit multi-user)

Since this is a LAN-only app, explicit authentication is overkill. Each e-reader/browser gets its own `sid` cookie, and conversations are scoped to that session.

- Conversations are already scoped to `session_id` in the database schema
- No login screen needed — the `sid` cookie is the identity
- Each device automatically gets its own conversation space

### Optional: Named sessions

If users want to identify themselves (e.g. shared family device):

- Add an optional **display name** field in the settings panel
- Stored in session config alongside `base_url`, `model`, etc.
- Purely cosmetic — shown in the header, not used for access control
- `POST /api/session/config` accepts a `display_name` field

### Extension: Real authentication

If real authentication is ever needed (public deployment), the schema supports it without rewrite:

- Add a `users` table with `id`, `username`, `password_hash`
- Add `user_id` column to `conversations`
- Add a `/api/auth/login` endpoint
- The `session_id`-based scoping becomes `user_id`-based scoping
- Just an additional column and a migration

---

## Streaming Responses

**Status**: planned

Progressive token rendering so users see the reply as it's generated, instead of waiting for the full response.

### Backend

- Modify `/api/chat` to accept `stream: true` in the request body
- When streaming, proxy the upstream SSE stream to the client
- Use `StreamingResponse` from FastAPI with `text/event-stream` content type
- Each chunk forwarded as `data: {"delta": "token"}\n\n`
- Final chunk: `data: [DONE]\n\n`
- Persist the full message to the database only after the stream completes

### Frontend

- Use `EventSource` or chunked XHR to read the stream
- Append tokens to the current assistant message in real time
- Re-render through `markdownToHTML()` on each chunk (or debounce to every N tokens for performance on slow e-reader engines)
- Graceful fallback: if streaming fails or the browser doesn't support it, fall back to non-streaming (`stream: false`)

### Constraints

- E-reader browsers may have poor SSE support — test on target devices before committing
- XHR-based fallback must remain functional
- Consider a `STREAM_ENABLED` env var (default: `0`) to make this opt-in

---

## Conversation Export

**Status**: planned

Let users download conversations for offline reading or archival.

- `GET /api/conversations/{id}/export?format=markdown` — download as `.md`
- `GET /api/conversations/{id}/export?format=text` — download as `.txt`
- Simple frontend button in the conversation panel

---

## Full-Text Search

**Status**: planned

Find messages across all conversations.

- Use SQLite `FTS5` virtual table for message content search
- `GET /api/search?q=&limit=` — returns matching messages with conversation context
- Add a search input to the conversation panel

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
- Store per-message token counts in the `messages` table (add nullable columns)
- Show a subtle token counter in the UI (total for current conversation)

---

## Theme and Display Options

**Status**: planned

Customize the reading experience per session.

- Dark mode toggle (inverted colors — white text on black background)
- Font size adjustment
- Stored per-session in session config
