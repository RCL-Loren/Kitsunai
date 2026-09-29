#!/usr/bin/env node
// Zero-dependency static server for KitsunAI plus a local relay for providers
// that don't send CORS headers (e.g. OpenCode Go). See plan §4a.
//
//   node tools/serve.js [--port 8000]
//
// The relay is a transport detail: it stores nothing, translates nothing, and
// only accepts same-origin requests from the app it serves.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPSTREAM_HEADER, RELAY_MARKER } from '../js/providers/transport.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Request headers never forwarded upstream.
const DROP_REQUEST = new Set([
  'host', 'origin', 'referer', 'cookie', 'connection', 'keep-alive', 'proxy-connection',
  'transfer-encoding', 'te', 'trailer', 'upgrade', 'content-length', 'accept-encoding',
]);

export { UPSTREAM_HEADER };

// Every relay response carries this so the app can tell relay answers from a
// plain static server that knows nothing about /relay.
const RELAY_HEADERS = { [RELAY_MARKER]: '1' };

// Plain-language explanations for common network failures.
const NETWORK_ERRORS = {
  ECONNREFUSED: 'connection refused — is the server running?',
  ENOTFOUND: 'host not found — check the endpoint address',
  EAI_AGAIN: 'DNS lookup failed — check your connection',
  ETIMEDOUT: 'the connection timed out',
  ECONNRESET: 'the connection was reset',
  UND_ERR_CONNECT_TIMEOUT: 'the connection timed out',
  'bad port': 'that port is blocked for safety by Node’s fetch',
};

function sendJSON(res, status, message, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify({ error: { message } }));
}

// Returns an error message if the request must not be relayed, else null.
export function checkRelayRequest(req, port) {
  const host = (req.headers.host ?? '').toLowerCase();
  const hostname = host.replace(/:\d+$/, '');
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return 'Relay only answers on localhost';

  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return 'Cross-origin relay requests are not allowed';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return 'Cross-site relay requests are not allowed';

  let upstream;
  try {
    upstream = new URL(req.headers[UPSTREAM_HEADER] ?? '');
  } catch {
    return `Missing or invalid ${UPSTREAM_HEADER} header`;
  }
  if (upstream.protocol !== 'https:' && upstream.protocol !== 'http:') return 'Upstream must be http(s)';
  if (port && ['localhost', '127.0.0.1'].includes(upstream.hostname) && Number(upstream.port || 80) === Number(port)) {
    return 'Relay cannot target itself';
  }
  return null;
}

export function forwardHeaders(incoming) {
  const out = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (DROP_REQUEST.has(k) || k.startsWith('sec-') || k.startsWith('x-kitsunai-')) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

async function relay(req, res, port) {
  const problem = checkRelayRequest(req, port);
  if (problem) return sendJSON(res, 403, problem, RELAY_HEADERS);

  const upstream = req.headers[UPSTREAM_HEADER];
  const controller = new AbortController();
  // A client disconnect (e.g. the user pressed Stop) aborts the upstream call.
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });

  let upstreamRes;
  try {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    upstreamRes = await fetch(upstream, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body: hasBody ? req : undefined,
      duplex: hasBody ? 'half' : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    const code = err.cause?.code ?? err.cause?.message ?? err.message;
    const cause = NETWORK_ERRORS[code] ?? code;
    console.warn(`relay  ✕ ${new URL(upstream).host}: ${cause}`);
    return sendJSON(res, 502, `Relay could not reach ${new URL(upstream).host}: ${cause}`, { ...RELAY_HEADERS, 'x-kitsunai-relay-error': '1' });
  }

  console.log(`relay  ${req.method} ${new URL(upstream).host} → ${upstreamRes.status}`);
  res.writeHead(upstreamRes.status, {
    ...RELAY_HEADERS,
    'content-type': upstreamRes.headers.get('content-type') ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  if (!upstreamRes.body) return res.end();
  try {
    for await (const chunk of upstreamRes.body) res.write(chunk);
    res.end();
  } catch {
    // Upstream dropped mid-stream or the client went away; end what we have.
    res.destroy();
  }
}

async function serveStatic(req, res, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, 'Method not allowed');
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return sendJSON(res, 400, 'Bad path');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(root, pathname);
  if (file !== root && !file.startsWith(root + path.sep)) return sendJSON(res, 403, 'Forbidden');
  if (pathname.split('/').some((seg) => seg.startsWith('.'))) return sendJSON(res, 404, 'Not found');

  try {
    const info = await stat(file);
    if (!info.isFile()) return sendJSON(res, 404, 'Not found');
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch {
    sendJSON(res, 404, 'Not found');
  }
}

export function createServe({ root = ROOT, port } = {}) {
  const server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/relay') return relay(req, res, port ?? server.address()?.port);
    serveStatic(req, res, root);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  const port = i > -1 ? Number(process.argv[i + 1]) : 8000;
  createServe({ port }).listen(port, '127.0.0.1', () => {
    console.log(`KitsunAI on http://localhost:${port}  (relay at /relay)`);
  });
}
