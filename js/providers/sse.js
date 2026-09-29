// Incremental Server-Sent Events parser (https://html.spec.whatwg.org/#event-stream-interpretation).
// Pure: feed it decoded text chunks split anywhere; it calls onEvent({ event, data, id })
// once per complete event.

export function createSSEParser(onEvent) {
  let buffer = '';
  let data = [];
  let event = '';
  let id = '';

  function dispatch() {
    if (data.length) onEvent({ event: event || 'message', data: data.join('\n'), id });
    data = [];
    event = '';
  }

  function line(text) {
    if (text === '') return dispatch();
    if (text.startsWith(':')) return; // comment / keep-alive
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
  }

  return {
    push(chunk) {
      buffer += chunk;
      // Lines end in \n, \r\n, or \r. A trailing \r may be half of a \r\n, so wait for more.
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i];
        if (c !== '\n' && c !== '\r') continue;
        if (c === '\r' && i === buffer.length - 1) break;
        line(buffer.slice(start, i));
        if (c === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
      buffer = buffer.slice(start);
    },
    // Flush a final event if the stream ended without a trailing blank line.
    end() {
      if (buffer) { line(buffer.replace(/\r$/, '')); buffer = ''; }
      dispatch();
    },
  };
}
