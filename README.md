# KitsunAI

A beautiful, anime-inspired, local-first LLM chat client built from boring web technology: fast streaming, first-class technical Markdown (math, chemistry, code, tables), multiple configurable models, and one-click Obsidian Compatible Markdown export.

Vanilla HTML, CSS and ES modules. No framework, no build step, no runtime dependencies. Everything is stored in your browser (IndexedDB).

## Run it

Requires Node 22 or newer (used only for the local server and tests).

```sh
node tools/serve.js          # → http://localhost:8000
```

Open the page, add a model (the setup screen walks you through it), and start a conversation.

Serve with `tools/serve.js`, not another static server: it also provides the **local relay** that providers without CORS support need (see below). Opening `index.html` from `file://` is not supported.

## Stopping it

In the terminal running `node tools/serve.js`, press **Ctrl+C**. That's a clean shutdown: the server holds no data, since conversations, models and settings all live in your browser, so nothing is lost. Close the KitsunAI tab or leave it open; it picks up where you left off next time you start the server.

Let any response that's still streaming finish first (or press Stop). Stopping the server mid-reply cuts the connection, and the partial reply is saved marked "Stopped".

If the server was started in the background or from a terminal you've closed, find it by port and stop it:

```sh
lsof -i :8000                # shows the node process and its PID
kill <PID>                   # or, in one step:  kill $(lsof -t -i :8000)
```

On Windows, use `netstat -ano | findstr :8000` to find the PID, then `taskkill /PID <PID>`.

The mock server (`node tools/mock-server.js`, port 8090) is stopped the same way.

## Models and providers

KitsunAI streams from three API formats: **Chat Completions** (OpenAI-compatible), **Responses** (OpenAI) and **Anthropic Messages**. Each model stores its format. KitsunAI detects it when you save or test a model, and corrects it automatically if a chat hits the wrong one. You can also set it by hand. Presets fill in the endpoint:

| Preset | Endpoint | Notes |
|---|---|---|
| OpenCode Go | `https://opencode.ai/zen/go/v1` | Needs an API key and the local relay. Models use different API formats (e.g. GPT Luna and Grok use Responses, MiniMax uses Anthropic Messages); Test connection detects each one. KitsunAI sends the per-conversation `x-opencode-session` header OpenCode Go requires. Its docs describe the service as intended for coding-agent traffic. |
| llama.cpp | `http://localhost:8080/v1` | `llama-server` |
| Ollama | `http://localhost:11434/v1` | |
| LM Studio | `http://localhost:1234/v1` | |
| OpenRouter | `https://openrouter.ai/api/v1` | Needs an API key |
| Custom | any | Any OpenAI-compatible server |

**Test connection** sends a one-token completion, which checks the endpoint, key and model identifier together. **Fetch models** lists what the endpoint offers.

A conversation stays with the model it started with. To use another model, start a new chat.

### The local relay

Browsers only let a page call another site if that site sends CORS headers. Some providers (OpenCode Go) don't, so the browser blocks them. For models with **Use local relay** turned on, requests go through `tools/serve.js`, which forwards them and streams the response back.

The relay stores nothing, never logs request bodies or keys, answers only on `localhost`, and refuses requests from other sites. It identifies itself upstream as `KitsunAI/<version>`. Details are in `DevDocs/provider-notes.md` and plan §4a.

## Using it

- **Enter** sends, **Shift+Enter** adds a new line; this can be switched in Settings. **⌘/Ctrl+Enter** always sends. **Esc** stops a response.
- Math renders with KaTeX: `$…$`, `$$…$$`, `\(…\)`, `\[…\]` and ```` ```math ```` blocks. Chemistry works with mhchem: `$\ce{2H2 + O2 -> 2H2O}$`, and units with `$\pu{8.314 J K^-1 mol^-1}$`.
- Each message has **Copy** (formatted, with plain text and TeX math as a fallback), **Copy Markdown** (the exact source) and **Export Markdown**.
- **Export** in the conversation header (or ⤓ in the sidebar) saves the whole conversation as Obsidian-ready Markdown, with optional YAML frontmatter (title, dates, model, provider, tags).
- Settings: theme (System, Dark, Light), your name for exports, default tags, and the send key.

### Privacy

Conversations, models and settings live only in this browser's IndexedDB. **API keys are stored unencrypted**, so anyone with access to this browser profile can read them. Messages are sent only to the endpoints you configure.

## Development

```sh
npm test                               # node:test, pure modules only (no dependencies)
node tools/mock-server.js --tps 200    # fake OpenAI-compatible server on :8090 (no API key needed)
```

Add a **Custom** model with endpoint `http://127.0.0.1:8090/v1` and model `mock-fox`. Mock options:

| Option | Effect |
|---|---|
| `--tps N` | streaming speed, in ~4-character tokens per second |
| `--latency MS` | delay before the first token |
| `--reasoning` | stream reasoning ("Thoughts") before the answer |
| `--repeat N` | repeat the canned answer N times (long replies) |
| `--code-lines N` | answer with one N-line code block |
| `--empty` | answer with no content |
| `--fail http`, `--fail 401`, `--fail 429`, … | fail with that HTTP status |
| `--fail mid` | drop the connection halfway through |
| `--formats chat,responses,messages` | API formats to accept (default: all). Others get OpenCode Go's "not supported" errors, for testing format detection. |

Dev pages:
- `dev/render.html` shows every Markdown construct.
- `dev/mascot.html` shows the mascot states in both themes.
- `dev/spike.html` checks CORS and the relay per provider.

Console hooks for performance work:

```js
const id = await kitsunai.debug.seed(500);  // a 500-message conversation
location.hash = '#/chat/' + id;
kitsunai.debug.startProfile();  /* stream, type, scroll */  kitsunai.debug.stopProfile();
```

### Vendored libraries

markdown-it, highlight.js, KaTeX (with the mhchem extension) and the fonts (Inter, JetBrains Mono, Zen Maru Gothic; all OFL) are pinned in `vendor/`, with versions listed in `vendor/VERSIONS.md`. To update them, change the versions in `scripts/vendor.sh`, run it, and commit `vendor/`.

### Layout

```
index.html            app shell
css/                  tokens (themes), base, layout, components, markdown, chat, motion
js/main.js            boot, hash router
js/data/              IndexedDB-backed conversations, messages, models, settings
js/providers/         API-format adapters (chat, responses, messages), shared HTTP/SSE, transport (direct or relay), format detection
js/chat/session.js    send / stream / stop / retry / persist
js/render/            Markdown pipeline, math plugin, streaming renderer
js/export/            Markdown export (pure) and clipboard/download actions
js/ui/                screens and components
tools/                serve.js (static + relay), mock-server.js
tests/                node:test suites
DevDocs/              project description, development plan, provider and performance notes
```

How streaming stays fast: finished blocks of a reply are rendered once and never touched again. Only the unfinished tail re-renders, once per animation frame, and long replies and history keep off-screen content out of layout. See `DevDocs/perf-notes.md`.

## Known limitations (V1)

- No attachments, search, sync, message editing or branching.
- Code blocks over 32 KB are shown without syntax highlighting.
- A single extremely large reply (about 200 KB, with thousands of formulas) takes about half a second to reopen.
