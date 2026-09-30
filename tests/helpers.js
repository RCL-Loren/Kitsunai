// Shared test helpers (not a test file: the glob only matches *.test.js).

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// A Response whose body emits `chunks` (strings) one at a time.
export function sseResponse(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// SSE text for a list of { event?, data } objects (data is JSON-encoded).
export const sse = (events) => events.map(({ event, data }) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`).join('');

// Records calls; answers from a route table keyed "METHOD /path" (the /v1 prefix is dropped).
export function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const target = headers.get('x-kitsunai-upstream') ?? url;
    const path = new URL(target, 'http://local').pathname.replace(/^\/v1/, '');
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push({ url, key, headers, body: init.body });
    const route = routes[key];
    if (!route) throw new TypeError('Failed to fetch');
    return typeof route === 'function' ? route() : route.clone();
  };
  return { fetchImpl, calls };
}

export async function collect(iter) {
  const out = [];
  for await (const e of iter) out.push(e);
  return out;
}

export const model = (over = {}) => ({
  endpoint: 'https://api.example.com/v1', model: 'fox-1', credentials: { apiKey: 'sk-test' }, useProxy: false, parameters: {}, ...over,
});
