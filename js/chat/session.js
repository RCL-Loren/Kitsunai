// Chat session: send / stream / stop / retry / persist for one conversation.
// No DOM here; the view subscribes through handlers.

import { createConversation, updateConversation, getConversation } from '../data/conversations.js';
import { addMessage } from '../data/messages.js';
import { saveModel } from '../data/models.js';
import { adapterFor, requestHeaders, detectFormat } from '../providers/index.js';
import { ProviderError, isFormatMismatch } from '../providers/errors.js';

const TITLE_MAX = 60;

// Pure: first non-empty line of the first user message, without Markdown markers.
export function deriveTitle(markdown) {
  const line = markdown.split('\n').map((l) => l.trim()).find((l) => l && !/^(```|~~~|\$\$|\\\[)/.test(l)) ?? '';
  const text = line
    .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'New conversation';
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1).trimEnd()}…` : text;
}

// Pure: API messages for the next reply — everything up to and including the
// last user message (a stopped partial reply after it is left out on retry).
export function contextFor(history) {
  let last = -1;
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user') { last = i; break; }
  return history.slice(0, last + 1).map((m) => ({ role: m.role, content: m.markdown }));
}

// handlers: onConversationCreated(conv), onUserMessage(msg), onStreamStart(),
//           onDelta({ text, reasoning }), onStreamEnd({ message, error, aborted, text }),
//           onFormatChanged(model) after self-correcting a model's API format
export function createChatSession({ conversation = null, model, messages = [], handlers = {} }) {
  let conv = conversation;
  const history = [...messages];
  let controller = null;
  let busy = false; // covers the whole send, including the saves before streaming starts

  // Bumping updatedAt is bookkeeping; a failure here must not break the chat.
  const touch = () => updateConversation(conv.id, { updatedAt: Date.now() }).catch(() => {});

  // One streaming attempt with the model's current API format.
  async function attempt() {
    const result = { text: '', reasoning: '', usage: undefined, finishReason: undefined, error: null, aborted: false };
    try {
      const events = adapterFor(model).stream(model, {
        messages: contextFor(history),
        signal: controller.signal,
        headers: requestHeaders(model, conv.id), // conversation ID = stable session ID
      });
      for await (const e of events) {
        if (e.type === 'text') result.text += e.text;
        else if (e.type === 'reasoning') result.reasoning += e.text;
        else if (e.type === 'usage') result.usage = e.usage;
        else if (e.type === 'finish') result.finishReason = e.finishReason;
        if (e.type === 'text' || e.type === 'reasoning') handlers.onDelta?.({ text: result.text, reasoning: result.reasoning });
      }
    } catch (err) {
      if (err.name === 'AbortError') result.aborted = true;
      else result.error = err;
    }
    return result;
  }

  // Self-correction: the model's API format is wrong (e.g. saved before format
  // detection existed, or the provider changed it). Detects the right format,
  // saves it on the model, and returns true so the reply can be retried once.
  async function correctFormat() {
    try {
      const { format } = await detectFormat(model, { signal: controller.signal });
      if (format === (model.apiFormat ?? 'chat')) return false;
      model = await saveModel({ ...model, apiFormat: format });
      handlers.onFormatChanged?.(model);
      return true;
    } catch {
      return false; // keep the original error; it already says to run Test connection
    }
  }

  async function streamReply() {
    controller = new AbortController();
    handlers.onStreamStart?.();
    let result = await attempt();
    const wrongFormat = result.error && isFormatMismatch(result.error) && !result.text && !result.reasoning;
    if (wrongFormat && await correctFormat()) result = await attempt();
    controller = null;

    const { text, reasoning, usage, finishReason, aborted } = result;
    let { error } = result;

    if (!aborted && !error && !text.trim()) {
      error = new ProviderError(
        reasoning
          ? 'The model only produced reasoning and no answer — it may have hit its token limit. Try raising Max tokens.'
          : 'The model returned an empty response.',
        { kind: 'protocol' },
      );
    }

    let message = null;
    if (text.trim()) {
      const metadata = { status: aborted || error ? 'stopped' : 'complete' };
      if (reasoning) metadata.reasoning = reasoning;
      if (usage) metadata.usage = usage;
      if (finishReason) metadata.finishReason = finishReason;
      try {
        // The conversation may have been deleted while the reply streamed.
        if (await getConversation(conv.id)) {
          message = await addMessage({ conversationId: conv.id, role: 'assistant', markdown: text, metadata });
          history.push(message);
          await touch();
        }
      } catch (err) {
        error = new Error(`The reply couldn’t be saved: ${err.message}`);
      }
    }
    handlers.onStreamEnd?.({ message, error, aborted, text });
  }

  return {
    get conversation() { return conv; },
    get streaming() { return busy; },

    // Throws only if the user's message couldn't be saved (the caller restores
    // the draft so nothing typed is lost); stream problems go to onStreamEnd.
    async send(markdown) {
      if (busy || !markdown.trim()) return false;
      busy = true;
      try {
        if (!conv) {
          conv = await createConversation({ title: deriveTitle(markdown), modelId: model.id, modelName: model.name });
          handlers.onConversationCreated?.(conv);
        }
        const userMessage = await addMessage({ conversationId: conv.id, role: 'user', markdown });
        history.push(userMessage);
        await touch();
        handlers.onUserMessage?.(userMessage);
        await streamReply();
        return true;
      } finally {
        busy = false;
      }
    },

    // Re-streams a reply to the last user message (after an error).
    async retry() {
      if (busy || !conv) return;
      busy = true;
      try {
        await streamReply();
      } finally {
        busy = false;
      }
    },

    stop() {
      controller?.abort();
    },
  };
}
