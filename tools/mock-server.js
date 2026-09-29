#!/usr/bin/env node
// Zero-dependency mock of an OpenAI-compatible Chat Completions server.
// Streams canned technical Markdown as SSE so KitsunAI can be developed and
// profiled without API keys.
//
//   node tools/mock-server.js [--port 8090] [--tps 60] [--latency 400]
//                             [--fail http|mid|<status>] [--reasoning] [--repeat 1]
//                             [--empty] [--code-lines N]
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
  const opts = { port: 8090, tps: 60, latency: 400, fail: null, reasoning: false, repeat: 1, empty: false, 'code-lines': 0 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'reasoning' || key === 'empty') opts[key] = true;
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
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

export function createMockServer(options = {}) {
  const opts = { port: 8090, tps: 60, latency: 400, fail: null, reasoning: false, repeat: 1, empty: false, 'code-lines': 0, ...options };
  let counter = 0;

  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();

    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-fox', object: 'model' }, { id: 'mock-fox-mini', object: 'model' }] }));
    }

    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { ...CORS, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Not found' } }));
    }

    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { ...CORS, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
    }

    const failStatus = opts.fail === 'http' ? 500 : Number(opts.fail) || 0;
    if (failStatus) {
      const messages = { 401: 'Invalid API key.', 429: 'Rate limit exceeded. Try again in 20s.' };
      res.writeHead(failStatus, { ...CORS, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: messages[failStatus] ?? `Mock server configured to fail (${failStatus})` } }));
    }

    const answer = opts.empty ? ''
      : opts['code-lines'] ? codeBlock(opts['code-lines'])
      : RESPONSES[counter++ % RESPONSES.length].repeat(opts.repeat);
    const id = `chatcmpl-mock-${counter}`;
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model ?? 'mock-fox' };
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const delta = (d, finish = null) => send({ ...base, choices: [{ index: 0, delta: d, finish_reason: finish }] });

    if (!body.stream) {
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] }));
    }

    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    let closed = false;
    res.on('close', () => { closed = true; });

    await sleep(opts.latency);
    delta({ role: 'assistant', content: '' });

    const interval = 1000 / opts.tps;
    const emit = async (tokens, field) => {
      // Batch tokens per ~16ms tick so high tps rates don't depend on timer resolution.
      const perTick = Math.max(1, Math.round(16 / interval));
      for (let i = 0; i < tokens.length && !closed; i += perTick) {
        for (const t of tokens.slice(i, i + perTick)) delta({ [field]: t });
        await sleep(interval * perTick);
      }
    };

    if (opts.reasoning) await emit(tokenize(REASONING), 'reasoning_content');

    const tokens = tokenize(answer);
    if (opts.fail === 'mid') {
      await emit(tokens.slice(0, tokens.length >> 1), 'content');
      return res.destroy();
    }
    await emit(tokens, 'content');
    if (closed) return;

    delta({}, 'stop');
    if (body.stream_options?.include_usage) {
      send({ ...base, choices: [], usage: { prompt_tokens: 42, completion_tokens: tokens.length, total_tokens: 42 + tokens.length } });
    }
    res.end('data: [DONE]\n\n');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  createMockServer(opts).listen(opts.port, '127.0.0.1', () => {
    console.log(`Mock OpenAI server on http://127.0.0.1:${opts.port}/v1  (tps=${opts.tps}, latency=${opts.latency}ms${opts.fail ? `, fail=${opts.fail}` : ''}${opts.reasoning ? ', reasoning' : ''})`);
  });
}
