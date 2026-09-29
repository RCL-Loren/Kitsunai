// kind: 'network' | 'relay-missing' | 'relay' | 'http' | 'protocol'
export class ProviderError extends Error {
  constructor(message, { kind = 'http', status, body } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

// Pulls a human-readable message out of an error response body.
export function extractErrorDetail(body) {
  try {
    const json = JSON.parse(body);
    const e = json.error ?? json;
    const msg = typeof e === 'string' ? e : e.message ?? json.message ?? json.detail;
    if (msg) return String(msg);
  } catch {}
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function httpErrorMessage(status, body) {
  const detail = extractErrorDetail(body);
  const summary =
    status === 401 || status === 403 ? 'Authentication failed — check the API key.'
    : status === 404 ? 'Not found — check the endpoint URL and model identifier.'
    : status === 429 ? 'Rate limited — wait a moment and try again.'
    : status >= 500 ? 'The provider returned a server error.'
    : 'The provider rejected the request.';
  return detail ? `${summary} (${status}: ${detail})` : `${summary} (${status})`;
}
