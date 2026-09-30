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

// Provider wording for "this model uses a different API format", e.g. OpenCode
// Go's "Model does not support this protocol." (Chat Completions) and
// "Model … is not supported for format openai" (Responses).
const FORMAT_MISMATCH = /does not support this protocol|not supported for format|unsupported (api )?format/i;

// True when an error means "wrong API format" rather than a real failure: the
// provider says so, or the endpoint for that format doesn't exist (404/405).
export function isFormatMismatch(err) {
  if (err?.name !== 'ProviderError' || err.kind !== 'http') return false;
  if (FORMAT_MISMATCH.test(err.body ?? '')) return true;
  return err.status === 404 || err.status === 405;
}

// Provider wording for "this model can't take images", e.g. llama.cpp's
// "image input is not supported" or OpenAI's "image_url is only supported by
// certain models".
const NO_IMAGES = /(image|vision|multimodal|image_url|input_image)\b[^.]{0,60}\b(not|isn't|is only|only) (supported|allowed|accepted)|(does not|doesn't|cannot|can't) (support|accept|process|handle)[^.]{0,30}\b(images?|vision|image input)/i;

export function httpErrorMessage(status, body) {
  const detail = extractErrorDetail(body);
  const summary =
    FORMAT_MISMATCH.test(body) ? 'This model uses a different API format — run Test connection on the Models screen to detect it.'
    : NO_IMAGES.test(body) ? 'This model doesn’t accept images — remove them, or use a vision model.'
    : status === 401 || status === 403 ? 'Authentication failed — check the API key.'
    : status === 404 ? 'Not found — check the endpoint URL and model identifier.'
    : status === 429 ? 'Rate limited — wait a moment and try again.'
    : status >= 500 ? 'The provider returned a server error.'
    : 'The provider rejected the request.';
  return detail ? `${summary} (${status}: ${detail})` : `${summary} (${status})`;
}
