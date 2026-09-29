# KitsunAI — Development Plan (V1)

Companion to [[KitsunAI-Project-Description]]. That document defines *what* and *why*; this one defines *how*. Where they conflict, the project description wins. Raise the conflict before deviating.

## 1. Decisions & Constraints

| Area | Decision |
|---|---|
| Language | Vanilla ES modules. No framework, TypeScript, or build step. |
| Dev tooling | `package.json` with `"type":"module"`, **zero dependencies**, and `"test": "node --test tests/"` |
| Serving | `node tools/serve.js` (zero deps, binds `127.0.0.1:8000`). It serves static files and runs the local **relay** (§4a). `file://` is not supported. |
| Libraries | Vendored and pinned in `vendor/`, loaded as classic `<script defer>` globals before the module entry (no import maps). See the list below. |
| Fonts | Self-hosted OFL woff2 (latin subset, `font-display: swap`, body font preloaded). See the list below. |
| Providers | One adapter: **OpenAI-compatible Chat Completions (SSE)**. *Presets* only prefill the endpoint and label: OpenCode Go, llama.cpp, Ollama, LM Studio, OpenRouter, Custom. |
| Security | See the list below. |
| Tests | `node:test` for pure modules. UI is verified manually against the mock server plus a performance checklist. |

Libraries:
- `markdown-it` 14.3.2 (standalone build; 15.x is ESM-only with bare imports)
- `highlight.js` 11.12.0 (common bundle). Token colors are our own CSS in `markdown.css`, driven by theme tokens; no vendored hljs theme.
- `katex` 0.18.9 (js, css and woff2 fonts)
- Fonts come from `@fontsource` packages (OFL, licenses vendored).
- `scripts/vendor.sh` downloads exact npm tarballs with `curl` + `tar` and writes `vendor/VERSIONS.md`.

Fonts:
- Display: **Zen Maru Gothic**
- UI/body: **Inter**
- Code: **JetBrains Mono**

Security:
- markdown-it `html:false`, `linkify:true`
- Links open in a new tab with `rel="noopener noreferrer"`
- KaTeX `trust:false`, `throwOnError:false`
- API keys are stored in plaintext in IndexedDB, and Settings discloses this.

## 2. File Layout

```
index.html
package.json
css/      tokens.css base.css layout.css components.css markdown.css chat.css motion.css
js/
  main.js                 boot, hash router: #/chat/:id  #/new  #/new/:modelId (draft)  #/models  #/settings
  events.js               tiny pub/sub (emit/on/off) — no store framework
  db.js                   promise wrapper over IndexedDB (~120 lines)
  data/                   conversations.js messages.js models.js settings.js
  providers/              index.js (registry + presets) openai.js sse.js transport.js
  chat/session.js         send / stream / stop / retry / persist
  render/                 markdown.js math-plugin.js blocks.js stream-renderer.js code-blocks.js
  ui/                     sidebar.js conversation-view.js message-view.js composer.js
                          new-chat.js models-screen.js settings-screen.js mascot.js toast.js dom.js
  export/markdown-export.js  (pure formatting)  export-actions.js  (clipboard, downloads)
assets/   kitsune.svg (symbol sprite, one symbol per state) icon.svg favicon.svg
vendor/   markdown-it/ highlight/ katex/ fonts/ VERSIONS.md
scripts/  vendor.sh
tools/    serve.js         zero-dep static server + local relay (§4a)
          mock-server.js   zero-dep Node OpenAI-SSE mock (CORS on, --tps, --latency, --fail, --reasoning)
dev/      spike.html       relay/CORS probe page
dev/      render.html      fixture page exercising every Markdown construct
tests/    serve.test.js sse.test.js math-plugin.test.js blocks.test.js export.test.js openai.test.js
```

Pure modules must not touch `window` or `document`, so `node:test` can import them directly. These are `sse.js`, `math-plugin.js`, `blocks.js`, `markdown-export.js`, and the `openai.js` request/parse logic (with an injected `fetch`).

## 3. Data Model — IndexedDB `kitsunai` v1

| Store | keyPath | Indexes | Fields |
|---|---|---|---|
| `conversations` | `id` | `updatedAt` | `id, title, modelId, modelName, createdAt, updatedAt` |
| `messages` | `id` | `byConversation: [conversationId, createdAt]` | `id, conversationId, role, markdown, createdAt, metadata` |
| `models` | `id` | — | `id, name, provider, preset, endpoint, model, credentials, useProxy, systemPrompt, parameters` |
| `settings` | `key` | — | `{key, value}` rows |

Fields:
- `modelName` is a snapshot, so exports and orphaned conversations still name the model.
- `role` is `user` or `assistant`.
- `metadata` holds `{status:'complete'|'stopped', reasoning?, usage?, finishReason?}`.
- `provider` is `'openai-compatible'`.
- `credentials` is `{apiKey}`.
- `useProxy` (bool) routes the model's requests through the local relay. Presets set the default (OpenCode Go: on, local servers: off).
- `parameters` is `{temperature?, top_p?, max_tokens?, extra?}`, where `extra` is raw JSON merged into the request body.

Settings keys and defaults:
- `displayName` = "User"
- `theme` = `system`, `dark` or `light`
- `exportFrontmatter` = true
- `defaultTags` = `["llm-chat"]`
- `sendOnEnter` = true

Rules:
- IDs are `crypto.randomUUID()`. Timestamps are epoch ms and are converted to ISO only on export.
- **The model lock:** New Chat creates an in-memory *draft* conversation, which is persisted on first send. `data/conversations.js` exposes no way to change `modelId`. `update()` whitelists only `title` and `updatedAt`.
- Persistence:
  - The user message is persisted on send.
  - The assistant message is persisted on done or stop.
  - A mid-stream error with partial text is persisted as `stopped`.
  - An error with no text persists nothing.
- Deleting a model is allowed after a confirmation. Its conversations stay readable, and the composer shows "This conversation's model was removed."
- Title: the first non-empty line of the first user message, stripped of Markdown markers, max 60 chars. It can be renamed from the sidebar.
- Deleting a conversation also deletes its messages in the same transaction.

## 4. Provider Abstraction

```js
// providers/index.js
export const adapters = { 'openai-compatible': openai };
export const presets = [ { id, label, endpoint, needsKey } ... ];

// adapter contract
{
  id, label,
  async *stream({ model, messages, signal }), // yields {type:'text',text} | {type:'reasoning',text}
                                              //        {type:'usage',usage} | {type:'done',finishReason}
  async listModels(model),                    // GET {endpoint}/models → string[]
  async test(model),                          // 1-token completion (proves endpoint + key + model); throws on failure
}
```

`sse.js` exports `createSSEParser(onEvent)`, which returns a `push(chunk)` function. It handles:
- lines split across chunks
- `\r\n` line endings
- multi-line `data:`
- `:` comments
- `[DONE]`

`openai.js`:
- POSTs to `{endpoint}/chat/completions` with `{model, messages, stream:true, stream_options:{include_usage:true}, ...parameters, ...extra}`.
- Adds `Authorization: Bearer` only when a key is set, and prepends `systemPrompt` as a `system` message.
- Maps `choices[0].delta.content` to `text`, and `delta.reasoning_content` or `delta.reasoning` to `reasoning`.
- A non-2xx response throws `ProviderError(status, bodyText)`.
- A pre-aborted or aborted signal ends the stream cleanly, without throwing.

Model status (● Ready / ○ Unverified / ✕ Error) is in memory only and is set by **Test connection**. The model form offers **Fetch models**, which fills a `<datalist>` for the identifier.

Adding a future provider means one adapter file plus a registry entry, with no changes to chat code.

## 4a. Local Relay — `tools/serve.js`

Some providers (OpenCode Go) send no CORS headers, so the browser cannot call them. A native process can, which is how OpenCode, Codex and similar tools reach them. `serve.js` supplies that process. It's a transport detail, not an application server: no state, no storage, no format translation.

- `POST /relay` with header `x-kitsunai-upstream: <absolute http(s) URL>` forwards the request and streams the response back unbuffered.
  - Forwards: method, body, and all request headers except hop-by-hop headers, `host`, `origin`, `referer`, `cookie`, `sec-*` and `x-kitsunai-*`.
  - Returns: status, `content-type`, and the streamed body.
  - A client disconnect aborts the upstream request.
- Safety:
  - binds `127.0.0.1` only
  - rejects a `Host` other than `localhost`/`127.0.0.1` (DNS rebinding)
  - rejects any `Origin` other than its own, and `Sec-Fetch-Site` values other than `same-origin`
  - sends no CORS headers
  - never logs request bodies or `Authorization`
- Browser side: `providers/transport.js` exports `providerFetch(model, url, init, fetchImpl)`. When `model.useProxy` is set, it rewrites the call to `/relay` with the upstream header. Adapters always call it, never `fetch` directly.
- A future Tauri or Electron shell can replace the relay by swapping `providerFetch`. Nothing else changes.

## 5. Markdown Pipeline

- `render/markdown.js` exports `renderMarkdown(src, {highlight=true})`. It uses one markdown-it instance with GFM tables and strikethrough (built in) and linkify.
  - `highlight` calls `hljs.highlight(code,{language})` for known languages and escapes the text otherwise.
  - The `fence` renderer override wraps output in `<div class="code-block"><header><span class="lang">…</span><button data-copy>Copy</button></header><pre>…</pre></div>`.
- `render/code-blocks.js` sets up one delegated click listener on the conversation root. Clicking a copy button copies that code block's text.
- `render/math-plugin.js` (own code, about 100 lines, fully tested):
  - Block rule: `$$…$$` (single or multi-line) and `\[…\]`.
  - Inline rule: `$…$` and `\(…\)`. `$$…$$` on a single line is rendered as display math.
  - Pandoc `$` rules:
    - the opener is not followed by whitespace
    - the closer is not preceded by whitespace
    - the closer is not followed by a digit
    - `\$` is a literal dollar sign
  - This keeps "costs $5 and $10" as text.
  - Math inside code spans and fences is never touched (markdown-it handles this for free).
  - KaTeX output is cached in a `Map`, keyed as `(display?'D':'I')+src`, capped at about 2000 entries (clear oldest).
  - `\[…\]` is treated as math, not as escaped brackets, because LLMs commonly write display math that way.
  - ```` ```math ```` fences (GitHub style) render as display math.
- Code uses no programming ligatures, so `=>` never renders as `⇒`. highlight.js adds latex, matlab, julia, verilog, vhdl, fortran and dockerfile to its common bundle.
- User and assistant messages use the same `renderMarkdown`.

## 6. Streaming Renderer (core performance work)

`render/stream-renderer.js` exports `createStreamRenderer(el)` and returns `{push, finish, destroy}`. The element `el` contains `.frozen` (append-only) and `.live`.

1. `push(text)` appends to the buffer and sets dirty. It does no DOM work.
2. A single `requestAnimationFrame` loop runs only while dirty. On each frame:
   - `b = findStableBoundary(buffer, frozenUpTo)`. This pure function in `blocks.js` returns the offset just after the last blank line that is **outside** an open ```` ``` ````/`~~~` fence or `$$`/`\[` block, or `frozenUpTo` if there is none.
   - If `b > frozenUpTo`, render `buffer.slice(frozenUpTo, b)` **with** highlighting once, append the resulting nodes to `.frozen`, and set `frozenUpTo = b`. Frozen nodes are never touched again.
   - Render `buffer.slice(frozenUpTo)` **without** highlighting into `.live.innerHTML`.
3. `finish()` renders the full buffer once and replaces the contents only if the HTML differs. This corrects cross-block constructs such as loose lists and reference links. It then marks the message complete.
4. Autoscroll:
   - Stick to the bottom only if the user was within 40px of it before the frame.
   - Read layout first, then write, once per frame.
   - When the user scrolls up, stop sticking and show a "↓ Latest" pill.

Blank lines inside indented list continuations can split a list. `finish()` repairs that, and a brief visual approximation mid-stream is acceptable.

History:
- Completed messages get `content-visibility:auto; contain-intrinsic-size:auto 200px`.
- Opening a conversation renders the **last 30** messages. An `IntersectionObserver` sentinel at the top loads older messages in pages of 30, and the scroll position is preserved using a scrollHeight delta.
- An in-memory `Map<messageId, html>` caches rendered HTML. Markdown stays canonical, and HTML is never persisted.

**Budgets.** These are measured with the mock server at 200 tok/s in small chunks, with a 500-message conversation open:
- no long tasks over 50 ms during streaming
- p95 scripting and render work per frame under 8 ms
- typing in the composer and scrolling stay smooth
- opening a 500-message conversation reaches first paint in under 200 ms

## 7. Chat Flow — `chat/session.js`

1. **Send.** Validate the input. If the conversation is a draft, persist it. Persist and render the user message.
2. Build `messages` from the full stored history (`role` plus `markdown` as `content`). Create the renderer and iterate `adapter.stream`.
3. **Indicator.**
   - The kitsune foxfire (mascot `thinking`) shows from send until the first token.
   - It then becomes a small inline flame after the live block.
   - It is removed on finish.
4. **Stop.** The button, or Esc while streaming, calls `AbortController.abort()`. The partial message is persisted as `stopped`.
5. **Done.** Persist the assistant message with usage and finishReason, and bump `conversation.updatedAt`.
6. **Error.**
   - Show an inline error card: mascot `error`, a short friendly line, the provider status and body in `<details>`, and **Retry**.
   - Retry re-streams from the existing history and doesn't duplicate the user message.
7. **Reasoning.** Reasoning tokens stream into a collapsed `<details class="thoughts"><summary>Thoughts</summary>`, rendered as plain text and stored in `metadata.reasoning`.
8. Only one stream may be active at a time. The composer stays editable, but Send is disabled while a stream is running.

## 8. Copy & Export — `export/markdown-export.js` (pure)

Message actions appear on hover or focus under each message:
- **Copy** writes a `ClipboardItem` with `text/html` (the rendered message minus code-block headers) and readable `text/plain`: each KaTeX formula is replaced by its TeX source in `$…$` / `$$…$$`, because KaTeX's hidden MathML duplicates every glyph in `innerText`.
- **Copy Markdown** writes the raw `message.markdown`.
- **Export Markdown** downloads the message as `.md`.

Conversation export (sidebar menu and conversation header):
```
---                      # only if exportFrontmatter
title: "<escaped>"
date: YYYY-MM-DD
created: <ISO>
updated: <ISO>
model: "<modelName>"
provider: "<preset label>"
tags:
  - llm-chat
  - …defaultTags
---

# <title>

## <displayName>

<user markdown, verbatim>

## <modelName>

<assistant markdown, verbatim>
```
- YAML strings are double-quoted, with `\` and `"` escaped and newlines removed.
- Filename: `YYYY-MM-DD-<slug>.md`. The slug is lowercase ASCII with hyphens, max 60 chars, and falls back to `conversation`.
- The download uses `Blob`, `URL.createObjectURL` and a temporary `<a download>`, and revokes the URL afterwards.
- Message bodies are **never** transformed.

## 9. Visual Identity

Tokens live in `css/tokens.css`:
- `:root` holds the dark defaults.
- `[data-theme="light"]` overrides them.
- `main.js` sets `data-theme` from settings, or from `prefers-color-scheme` when the setting is `system`, and listens for changes.

| Token | Dark (ink) | Light (washi) |
|---|---|---|
| `--bg` / `--surface` / `--raised` | `#0D0F1A` / `#151829` / `#1E2238` | `#F7F2E8` / `#EFE7D8` / `#FFFBF3` |
| `--text` / `--muted` | `#EDE8DC` / `#9AA0B8` | `#1B1D2A` / `#5E6275` |
| `--foxfire` (primary accent, text-safe) | `#4CC9F0` | `#0F6C8E` (5.3:1) |
| `--ember` (sparing: stop, warnings) | `#FF8A3D` | `#A64A0C` (5.2:1) |
| `--foxfire-deco` / `--ember-deco` (glows, flames, mascot; non-text) | `#4CC9F0` / `#FF8A3D` | `#1C8FB8` / `#E0661A` |
| `--glow` | `0 0 0 1px color-mix(in oklab, var(--foxfire) 35%, transparent), 0 0 18px color-mix(in oklab, var(--foxfire) 25%, transparent)` | same formula |

JRPG menu language:
- Cards have a 16px radius with **one clipped corner notch** and a 1px luminous border. The shape lives on a `::before` layer: `clip-path` cuts the corner, a hard-stop gradient continues the border along the cut, and the selection glow is a `drop-shadow` filter, because `clip-path` clips `box-shadow`.
- The selected or focused item gets `--glow`.
- Pickers show a ✦ marker and a ▶ cursor on the focused item.
- Restrained gradients only: a subtle vertical wash on the sidebar, no purple SaaS gradients.

Typography:
- Zen Maru Gothic for display text only (screen titles, empty states, picker headings).
- Inter for UI and prose at 16px / 1.65.
- JetBrains Mono for code at 0.9em.

Motion:
- Animate only `transform` and `opacity`, for 120–220 ms with `cubic-bezier(.2,.8,.2,1)`.
- Screen transitions use a 6px rise plus a fade.
- `@media (prefers-reduced-motion: reduce)` disables all of it.

Mascot:
- One simple geometric SVG kitsune (not Pokémon-derived) with states `idle`, `thinking` (foxfire flicker via opacity and scale), `error` (ears down), and `happy`.
- It appears only in: the empty state, first-run setup, the generation indicator, errors, setup completion, and the app icon.

Copy tone:
- "What are we exploring today?" for an empty chat.
- "✦ New Adventure ✦ / Choose your companion" for the model picker.
- "All set — your companion is ready." when setup completes.
- Normal controls keep normal names: Settings, Models, Export, Delete.

Layout:
- A left sidebar, 280px wide, containing: New chat, a conversation list sorted by `updatedAt` (with rename and delete), and Models and Settings at the bottom.
- The main pane has a centered column with max-width 46rem.
- Below 800px a top bar with a menu button appears and the sidebar becomes an off-canvas drawer. The closed drawer is `inert`, Esc and the backdrop close it, and focus moves in on open and back to the menu button on close.

Markdown CSS:
- Tables scroll horizontally, with zebra rows. (No sticky header: the horizontal scroll wrapper becomes the sticky container, so it can't stick to the page.)
- `.katex-display` gets `overflow-x:auto`.
- Code blocks have a header chip with a Copy button.
- Blockquotes are styled like callouts.
- User messages sit on a slightly raised surface, and assistant messages are full-width prose.

## 10. Milestones

Each milestone ends in a runnable state with `npm test` green and **one commit**.

**0. Scaffold, provider spike & relay**
- `index.html`, the CSS token skeleton, `scripts/vendor.sh` (run it and commit `vendor/`), fonts, `package.json`, `tools/mock-server.js`, `tools/serve.js`.
- **Spike (done):** OpenCode Go sends no CORS headers, so browser-direct calls fail. Findings are in `DevDocs/provider-notes.md`.
- `dev/spike.html` checks direct and relayed calls against the mock server and OpenCode Go.
- Tests: `serve.test.js` (relay streaming, header filtering, cross-origin rejection).

**1. Storage + Models**
- `db.js`, the `data/*` modules, and `events.js`.
- Models screen: list, add, edit, delete, preset picker, Test connection, Fetch models.
- First-run flow: with no models, show the mascot and "Let's set up your first companion" leading to the model form, then the setup-complete state.

**2. Markdown pipeline**
- `markdown.js`, `math-plugin.js`, highlight.js, code-copy, and `markdown.css`.
- `dev/render.html` shows every construct in the project description (tables, lists, fences, inline and display math, links).
- Tests: `math-plugin.test.js`.

**3. Chat core**
- Sidebar, New Chat picker, conversation view, and composer:
  - auto-growing textarea, max 40vh
  - Enter sends and Shift+Enter adds a newline, or the reverse if `sendOnEnter` is false
  - Cmd/Ctrl+Enter always sends
- `sse.js`, `openai.js`, and `session.js` with a **naive** renderer (full re-render per frame).
- Stop, Retry, persistence, and reload survival.
- Tests: `sse.test.js` and `openai.test.js`.

**4. Streaming renderer & history**
- `blocks.js`, `stream-renderer.js`, autoscroll plus the Latest pill, lazy history, and `content-visibility`.
- `window.kitsunai.debug.seed(n)` generates a conversation of n messages with mixed math and code.
- Profile against the §6 budgets and record the results in `DevDocs/perf-notes.md`.
- Tests: `blocks.test.js`.

**5. Copy/Export + Settings**
- Message actions and conversation export.
- Settings screen: display name, theme, export frontmatter toggle, default tags, send key, and the API-key storage disclosure.
- Tests: `export.test.js`.

**6. Visual pass**
- Finish the tokens for both themes, add the mascot SVG and its states, motion, empty and error states, the picker glow and cursor, the icon, and the favicon.
- Review every screen in both themes at 1440px and 390px wide.

**7. Hardening**
Accessibility:
- visible focus rings
- keyboard navigation of the sidebar and pickers
- an `aria-live="polite"` region announcing "Response complete" (never individual tokens)
- labelled icon buttons
- a contrast check of ≥ 4.5:1 for text

Edge cases:
- empty or invalid endpoint
- 401 or 429 responses
- network drop mid-stream
- a 5k-line code block
- a 200 KB message
- unmatched `$`
- IndexedDB being unavailable (shows a friendly error)

Finally, write a `README.md` covering how to run it, the vendor script, the mock server, and tests.

## 11. Verification

- **Unit:** `npm test` covers:
  - SSE chunk splitting and edge cases
  - math delimiters, including the currency false-positive cases
  - `findStableBoundary` with fences, tildes, `$$`, `\[`, and nested lists
  - YAML escaping and filename slugs in export
  - the OpenAI adapter against a stubbed `fetch` (errors, abort, reasoning, usage)
- **End-to-end (manual):**
  1. Run `node tools/mock-server.js --tps 200` and `node tools/serve.js`.
  2. Add the mock as a model. Check the first-run flow, chat, stop mid-stream, retry after `--fail`, all three copy actions, both exports, rename, delete, and that everything survives a reload.
  3. Check the model lock: no UI path can change a conversation's model.
- **Performance:** follow §6. Record a Chrome DevTools Performance trace while streaming into `seed(500)`, and scroll and type during the stream.
- **Real providers:** repeat the chat flow against llama.cpp (local) and OpenCode Go.
- **Obsidian:** open an exported conversation in a vault and confirm the frontmatter properties, math, code highlighting and tables render.

## 12. Out of Scope for V1

Anything not listed below that seems necessary should be proposed first.

- Model switching within a conversation
- Non-OpenAI API formats
- Attachments and images
- Search
- Sync
- PWA/Tauri packaging
- LLM-generated titles
- Message editing and branching
- Vault-aware export
