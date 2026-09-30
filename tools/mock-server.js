#!/usr/bin/env node
// Zero-dependency mock of an OpenAI-compatible Chat Completions server.
// Streams canned technical Markdown as SSE so KitsunAI can be developed and
// profiled without API keys.
//
//   node tools/mock-server.js [--port 8090] [--tps 60] [--latency 400]
//                             [--fail http|mid|<status>] [--reasoning] [--repeat 1]
//                             [--empty] [--code-lines N] [--formats chat,responses,messages] [--no-vision]
//
// --tps         tokens per second (a "token" here is ~4 characters)
// --latency     ms before the first token
// --fail http   every completion returns HTTP 500
// --fail 429    every completion returns that HTTP status (401, 429, 503, …)
// --fail mid    every completion drops the connection halfway through
// --reasoning   emit delta.reasoning_content before the answer
// --repeat      repeat the canned response N times (for long-message tests)
// --empty       stream a response with no content
// --code-lines  answer with one fenced code block of N lines (large-block tests)
// --no-vision   reject requests containing images (as a text-only model would)
// --formats     API formats to accept (default all). Others get OpenCode Go's
//               "not supported" errors, for testing format detection. Paths:
//               /v1/chat/completions, /v1/responses, /v1/messages

import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const RESPONSES = [
  String.raw`## Damped oscillator

The transfer function of a second-order system is

$$
H(s)=\frac{\omega_0^2}{s^2+2\zeta\omega_0 s+\omega_0^2}
$$

where $\zeta$ is the damping ratio and $\omega_0$ the natural frequency.

| Regime | Condition | Poles |
|---|---|---|
| Underdamped | $\zeta < 1$ | complex pair |
| Critical | $\zeta = 1$ | repeated real |
| Overdamped | $\zeta > 1$ | two real |

A quick step-response sketch:

` + '```python' + String.raw`
import numpy as np
from scipy import signal

w0, zeta = 2 * np.pi, 0.3
sys = signal.TransferFunction([w0**2], [1, 2 * zeta * w0, w0**2])
t, y = signal.step(sys)
print(f"overshoot: {y.max() - 1:.3f}")
` + '```' + String.raw`

1. Poles sit at $s = -\zeta\omega_0 \pm j\omega_0\sqrt{1-\zeta^2}$.
2. Overshoot depends only on $\zeta$.
   - Lower damping means more ringing.
3. Settling time scales as $4/(\zeta\omega_0)$.

> Costs are **$5 and $10** — dollar signs that are *not* math.
`,
  String.raw`For an electron moving perpendicular to a magnetic field, the Larmor radius is

$$
r_L = \frac{m_e v_\perp}{eB}
$$

and the cyclotron frequency is $\omega_c = eB/m_e$, independent of speed.

- ` + '`B = 0.1 T`' + String.raw` gives $f_c \approx 2.8\,\text{GHz}$.
- Doubling $B$ halves $r_L$.

` + '```js' + String.raw`
const larmorRadius = (v, B) => (9.109e-31 * v) / (1.602e-19 * B);
console.log(larmorRadius(1e6, 0.1)); // ≈ 5.7e-5 m
` + '```' + String.raw`

That's the whole story for the non-relativistic case.
`,
];

export function codeBlock(lines) {
  const body = Array.from({ length: lines }, (_, i) => `    total += step(${i}, rate=${(i % 7) / 10}, label="line ${i}")  # accumulate`).join('\n');
  return `Here is the generated module:\n\n\`\`\`python\ndef run(step):\n    total = 0\n${body}\n    return total\n\`\`\`\n\nThat's all ${lines} lines.\n`;
}

const REASONING =
  'Let me recall the standard second-order form, then check the pole locations and the regime table before answering.';

function parseArgs(argv) {
  const opts = { port: 8090, tps: 60, latency: 400, fail: null, reasoning: false, repeat: 1, empty: false, 'code-lines': 0, formats: 'chat,responses,messages', 'no-vision': false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'reasoning' || key === 'empty' || key === 'no-vision') opts[key] = true;
    else if (key in opts) opts[key] = isNaN(+argv[i + 1]) ? argv[++i] : +argv[++i];
  }
  return opts;
}

// Split text into ~4-character pieces, the way real servers emit tiny deltas.
export function tokenize(text) {
  return text.match(/[\s\S]{1,4}/g) ?? [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-api-key, anthropic-version',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

// Pure: images in a request, in any format: [{ mime, bytes }] (bytes of the base64 payload).
export function requestImages(format, body) {
  const turns = format === 'responses' ? (Array.isArray(body.input) ? body.input : []) : (body.messages ?? []);
  const images = [];
  const fromDataUrl = (url) => {
    const [, mime = '?', data = ''] = /^data:([^;,]+);base64,(.*)$/s.exec(url ?? '') ?? [];
    images.push({ mime, bytes: Math.floor(data.length * 3 / 4) });
  };
  for (const turn of turns) {
    if (!Array.isArray(turn.content)) continue;
    for (const part of turn.content) {
      if (part.type === 'image_url') fromDataUrl(part.image_url?.url);
      else if (part.type === 'input_image') fromDataUrl(part.image_url);
      else if (part.type === 'image') images.push({ mime: part.source?.media_type ?? '?', bytes: Math.floor((part.source?.data?.length ?? 0) * 3 / 4) });
    }
  }
  return images;
}

// API formats the mock can speak, by path. OpenCode Go's own mismatch errors are
// returned for formats left out of --formats (to exercise format detection).
const ROUTES = { '/v1/chat/completions': 'chat', '/v1/responses': 'responses', '/v1/messages': 'messages' };
const MISMATCH = {
  chat: () => 'Model does not support this protocol.',
  responses: (model) => `Model ${model} is not supported for format openai`,
  messages: (model) => `Model ${model} is not supported for format anthropic`,
};

// Per-format SSE writers: start, reasoning(t), text(t), end(outputTokens), and a
// one-shot JSON body for non-streaming requests.
function writerFor(format, res, body, counter) {
  const sse = (obj, event) => res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(obj)}\n\n`);
  const model = body.model ?? 'mock-fox';
  if (format === 'responses') {
    const typed = (type, extra) => sse({ type, ...extra }, type);
    return {
      start: () => typed('response.created', { response: { id: `resp_mock_${counter}`, status: 'in_progress' } }),
      reasoning: (t) => typed('response.reasoning_summary_text.delta', { delta: t }),
      text: (t) => typed('response.output_text.delta', { delta: t }),
      end: (n) => { typed('response.completed', { response: { status: 'completed', usage: { input_tokens: 42, output_tokens: n, total_tokens: 42 + n } } }); res.end(); },
      json: (answer) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] }], usage: { input_tokens: 42, output_tokens: 1 } }),
    };
  }
  if (format === 'messages') {
    const typed = (type, extra) => sse({ type, ...extra }, type);
    let block = -1;
    let open = null;
    const blockOf = (kind) => {
      if (open === kind) return;
      if (open) typed('content_block_stop', { index: block });
      open = kind;
      typed('content_block_start', { index: ++block, content_block: kind === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' } });
    };
    return {
      start: () => typed('message_start', { message: { id: `msg_mock_${counter}`, role: 'assistant', model, usage: { input_tokens: 42, output_tokens: 1 } } }),
      reasoning: (t) => { blockOf('thinking'); typed('content_block_delta', { index: block, delta: { type: 'thinking_delta', thinking: t } }); },
      text: (t) => { blockOf('text'); typed('content_block_delta', { index: block, delta: { type: 'text_delta', text: t } }); },
      end: (n) => {
        if (open) typed('content_block_stop', { index: block });
        typed('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: n } });
        typed('message_stop', {});
        res.end();
      },
      json: (answer) => ({ role: 'assistant', content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', usage: { input_tokens: 42, output_tokens: 1 } }),
    };
  }
  const base = { id: `chatcmpl-mock-${counter}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
  const delta = (d, finish = null) => sse({ ...base, choices: [{ index: 0, delta: d, finish_reason: finish }] });
  return {
    start: () => delta({ role: 'assistant', content: '' }),
    reasoning: (t) => delta({ reasoning_content: t }),
    text: (t) => delta({ content: t }),
    end: (n) => {
      delta({}, 'stop');
      if (body.stream_options?.include_usage) sse({ ...base, choices: [], usage: { prompt_tokens: 42, completion_tokens: n, total_tokens: 42 + n } });
      res.end('data: [DONE]\n\n');
    },
    json: (answer) => ({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] }),
  };
}

export function createMockServer(options = {}) {
  const opts = { port: 8090, tps: 60, latency: 400, fail: null, reasoning: false, repeat: 1, empty: false, 'code-lines': 0, formats: 'chat,responses,messages', 'no-vision': false, ...options };
  const formats = new Set(String(opts.formats).split(',').map((f) => f.trim()));
  let counter = 0;

  const sendJSON = (res, status, obj) => {
    res.writeHead(status, { ...CORS, 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();

    if (req.method === 'GET' && req.url === '/v1/models') {
      return sendJSON(res, 200, { object: 'list', data: [{ id: 'mock-fox', object: 'model' }, { id: 'mock-fox-mini', object: 'model' }] });
    }

    const format = req.method === 'POST' ? ROUTES[req.url] : undefined;
    if (!format) return sendJSON(res, 404, { error: { message: 'Not found' } });

    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return sendJSON(res, 400, { error: { message: 'Invalid JSON body' } });
    }

    if (!formats.has(format)) {
      return sendJSON(res, 400, { type: 'error', error: { type: 'ModelError', message: MISMATCH[format](body.model ?? 'mock-fox') } });
    }
    if (format === 'messages' && !req.headers['x-api-key'] && req.headers.authorization) {
      return sendJSON(res, 401, { type: 'error', error: { type: 'AuthError', message: 'Missing API key.' } });
    }

    const failStatus = opts.fail === 'http' ? 500 : Number(opts.fail) || 0;
    if (failStatus) {
      const messages = { 401: 'Invalid API key.', 429: 'Rate limit exceeded. Try again in 20s.' };
      return sendJSON(res, failStatus, { error: { message: messages[failStatus] ?? `Mock server configured to fail (${failStatus})` } });
    }

    const images = requestImages(format, body);
    if (images.length && opts['no-vision']) {
      return sendJSON(res, 400, { error: { message: 'image input is not supported - hint: if this is unexpected, you may need to provide the mmproj' } });
    }
    const seen = images.length ? `Received ${images.length} image${images.length === 1 ? '' : 's'} (${images.map((i) => `${i.mime}, ${Math.round(i.bytes / 1024)} KB`).join('; ')}).\n\n` : '';
    const answer = opts.empty ? ''
      : seen + (opts['code-lines'] ? codeBlock(opts['code-lines']) : RESPONSES[counter++ % RESPONSES.length].repeat(opts.repeat));
    const writer = writerFor(format, res, body, counter);

    if (!body.stream) return sendJSON(res, 200, writer.json(answer));

    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    let closed = false;
    res.on('close', () => { closed = true; });

    await sleep(opts.latency);
    writer.start();

    const interval = 1000 / opts.tps;
    const emit = async (tokens, write) => {
      // Batch tokens per ~16ms tick so high tps rates don't depend on timer resolution.
      const perTick = Math.max(1, Math.round(16 / interval));
      for (let i = 0; i < tokens.length && !closed; i += perTick) {
        for (const t of tokens.slice(i, i + perTick)) write(t);
        await sleep(interval * perTick);
      }
    };

    if (opts.reasoning) await emit(tokenize(REASONING), writer.reasoning);

    const tokens = tokenize(answer);
    if (opts.fail === 'mid') {
      await emit(tokens.slice(0, tokens.length >> 1), writer.text);
      return res.destroy();
    }
    await emit(tokens, writer.text);
    if (closed) return;
    writer.end(tokens.length);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  createMockServer(opts).listen(opts.port, '127.0.0.1', () => {
    console.log(`Mock LLM server on http://127.0.0.1:${opts.port}/v1  (formats=${opts.formats ?? 'all'}, tps=${opts.tps}, latency=${opts.latency}ms${opts.fail ? `, fail=${opts.fail}` : ''}${opts.reasoning ? ', reasoning' : ''})`);
  });
}
