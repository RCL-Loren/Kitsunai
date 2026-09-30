# Provider Notes (Milestone 0 spike, 2026-09-29)

## OpenCode Go — browser CORS: **BLOCKED**

- Base URL: `https://opencode.ai/zen/go/v1` ([docs](https://opencode.ai/docs/go/))
- Chat Completions: `POST {base}/chat/completions`, `Authorization: Bearer <key>`
- Model list: `GET {base}/models` (public, no key)

Probe results with `Origin: http://localhost:8000`:

| Request | Status | CORS headers |
|---|---|---|
| `OPTIONS /chat/completions` (preflight) | 404 | none |
| `OPTIONS /messages`, `OPTIONS /zen/v1/chat/completions` | 404 | none |
| `GET /models` | 200 | none (no `Access-Control-Allow-Origin`) |
| `POST /chat/completions`, no key or bad key | 401 | none |

Any request with `Authorization` plus a JSON `Content-Type` needs a preflight. The preflight gets a 404 with no CORS headers, so **every browser-direct call from KitsunAI fails**. Even the public `GET /models` is unreadable from a page.

### API format split

OpenCode Go does not serve every model through Chat Completions:

| Format | Endpoint | Model families |
|---|---|---|
| OpenAI Chat Completions | `/chat/completions` | GLM, Kimi, LongCat, DeepSeek, Hy (and likely MiMo) |
| Anthropic Messages | `/messages` | Qwen, MiniMax |
| OpenAI Responses | `/responses` | Grok, GPT Luna, Muse Spark |

With the V1 decision of "OpenAI-compatible only", the Qwen, MiniMax, Grok and GPT models are unreachable, even once CORS is solved.

Current model IDs: minimax-m3, minimax-m2.7, minimax-m2.5, kimi-k3, kimi-k2.7-code, kimi-k2.6, kimi-k2.5, longcat-2.0, longcat-2.5-preview-free, glm-5.3, glm-5.3-flash, glm-5.2, glm-5.1, glm-5, deepseek-v4-pro, deepseek-v4-flash, deepseek-v4.1-flash, deepseek-flash, deepseek-v4-flash-vision-exp, qwen3.8-max, qwen3.8-flash, qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3.5-plus, mimo-v2.6-pro, mimo-v2.6-flash, mimo-v2.5-pro, mimo-v2.5, mimo-v2-pro, mimo-v2-omni, hy4-preview, hy3, hy3-preview, gpt-6-luna, gpt-5.6-luna, grok-4.7, grok-4.6, grok-4.5, muse-spark-1.3-contributor, muse-spark-1.2-contributor, omen-alpha, space-bunny-free.

## llama.cpp (`llama-server`) — not installed here, unverified

- Base URL: `http://localhost:8080/v1`
- Its documentation says it sends permissive CORS headers by default, so it is expected to work browser-direct. Verify when a server is available.

## Ollama — not installed here, unverified

- Base URL: `http://localhost:11434/v1`
- By default it allows `localhost` and `127.0.0.1` origins on any port, which is fine for KitsunAI served from localhost. Other origins need `OLLAMA_ORIGINS`.

## Library pins chosen

- markdown-it **14.3.2**, using the official standalone build (`dist/markdown-it.min.js`). Version 15 ships only ES modules that import other packages by name, which doesn't work without a build step.
- highlight.js **11.12.0**, from `@highlightjs/cdn-assets`.
- KaTeX **0.18.9**, newer than the plan's 0.16. Its standalone and ESM builds are self-contained.

## Browser verification (Chrome, `dev/spike.html`)

| Check | Direct | Via relay |
|---|---|---|
| Mock `/models` | 200 | — |
| Mock stream | 200 | 200, streams incrementally (first chunk at the mock's 400 ms latency, 75 chunks) |
| OpenCode Go `/models` | **Failed to fetch** (CORS) | 200 |
| OpenCode Go chat (invalid key) | **Failed to fetch** (CORS) | 401 JSON, readable |

A chat with a real key is still to be checked: enter a key in `dev/spike.html` (it's never stored).

## Decision (2026-09-29)

The app stays a JavaScript browser app. `tools/serve.js` replaces `python3 -m http.server`: it serves the app and relays requests for models with `useProxy` enabled (see plan §4a). V1 keeps the single OpenAI-compatible adapter. An Anthropic Messages adapter is the next candidate if the Qwen or MiniMax models are wanted.

## OpenCode Go request requirements (found 2026-09-29)

Without a session ID, requests fail with `400 MissingSessionID` ("Request is missing x-opencode-session and cannot be routed efficiently"). Per <https://opencode.ai/docs/go/#where-can-i-use-it>, clients should:
- Send a stable session ID in `x-opencode-session` for each conversation, used for routing and prompt caching. KitsunAI sends the conversation ID; Test connection uses a random one.
- Identify with their own user agent. The relay sends `KitsunAI/<version>` instead of forwarding the browser's.
- Send "typical coding agent traffic". KitsunAI is a general chat client, so whether this use fits OpenCode Go's terms is the user's call.

The session header is only sent for the OpenCode Go preset. A custom header on direct browser calls would trigger CORS preflights that other providers may reject.

## API formats per model (2026-09-30)

- GPT Luna fails on Chat Completions with `400: Model does not support this protocol.` The authoritative per-model mapping is models.dev (`https://models.dev/api.json`, provider `opencode-go`): a model's `provider.npm` of `@ai-sdk/openai` means Responses, `@ai-sdk/anthropic` means Anthropic Messages, and no override means Chat Completions. Family names don't predict it (qwen3.8-max uses Chat Completions, qwen3.8-flash uses Messages).
- Mismatch wording: Chat Completions says "Model does not support this protocol." Responses says "Model X is not supported for format openai" (a `ModelError`, sometimes returned before the key check).
- `/messages` requires `x-api-key`; a Bearer header is reported as "Missing API key."
- KitsunAI detects the format with test requests (plan §4b) rather than downloading models.dev, which is 5 MB, can lag new models, and only covers catalogued providers.
