// All provider HTTP goes through providerFetch so the transport can change
// (local relay today, a native shell later) without touching adapters.

export const RELAY_PATH = '/relay';
export const UPSTREAM_HEADER = 'x-kitsunai-upstream';
export const RELAY_MARKER = 'x-kitsunai-relay';

export function providerFetch(model, url, init = {}, fetchImpl = globalThis.fetch) {
  if (!model.useProxy) return fetchImpl(url, init);
  const headers = new Headers(init.headers);
  headers.set(UPSTREAM_HEADER, url);
  return fetchImpl(RELAY_PATH, { ...init, headers });
}
