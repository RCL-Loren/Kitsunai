// Chat session: send / stream / stop / retry / persist for one conversation.
// No DOM here; the view subscribes through handlers.

import { createConversation, updateConversation } from '../data/conversations.js';
import { addMessage } from '../data/messages.js';
import { adapterFor } from '../providers/index.js';

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
//           onDelta({ text, reasoning }), onStreamEnd({ message, error, aborted })
export function createChatSession({ conversation = null, model, messages = [], handlers = {} }) {
  let conv = conversation;
  const history = [...messages];
  let controller = null;

  const touch = () => updateConversation(conv.id, { updatedAt: Date.now() });

  async function streamReply() {
    controller = new AbortController();
    handlers.onStreamStart?.();
    let text = '';
    let reasoning = '';
    let usage;
    let finishReason;
    let error = null;
    let aborted = false;

    try {
      const events = adapterFor(model).stream(model, { messages: contextFor(history), signal: controller.signal });
      for await (const e of events) {
        if (e.type === 'text') text += e.text;
        else if (e.type === 'reasoning') reasoning += e.text;
        else if (e.type === 'usage') usage = e.usage;
        else if (e.type === 'finish') finishReason = e.finishReason;
        if (e.type === 'text' || e.type === 'reasoning') handlers.onDelta?.({ text, reasoning });
      }
    } catch (err) {
      if (err.name === 'AbortError') aborted = true;
      else error = err;
    }
    controller = null;

    let message = null;
    if (text.trim()) {
      const metadata = { status: aborted || error ? 'stopped' : 'complete' };
      if (reasoning) metadata.reasoning = reasoning;
      if (usage) metadata.usage = usage;
      if (finishReason) metadata.finishReason = finishReason;
      message = await addMessage({ conversationId: conv.id, role: 'assistant', markdown: text, metadata });
      history.push(message);
      await touch();
    }
    handlers.onStreamEnd?.({ message, error, aborted });
  }

  return {
    get conversation() { return conv; },
    get streaming() { return controller !== null; },

    async send(markdown) {
      if (controller || !markdown.trim()) return;
      if (!conv) {
        conv = await createConversation({ title: deriveTitle(markdown), modelId: model.id, modelName: model.name });
        handlers.onConversationCreated?.(conv);
      }
      const userMessage = await addMessage({ conversationId: conv.id, role: 'user', markdown });
      history.push(userMessage);
      await touch();
      handlers.onUserMessage?.(userMessage);
      await streamReply();
    },

    // Re-streams a reply to the last user message (after an error).
    async retry() {
      if (controller || !conv) return;
      await streamReply();
    },

    stop() {
      controller?.abort();
    },
  };
}
