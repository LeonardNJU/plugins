// Incremental parser for server-sent events (text/event-stream). Chunks may
// end anywhere, even inside a line or a multi-byte character; feed() keeps
// the rest for the next call.

export function createSseParser() {
  let buffer = '';
  let event = '';
  let data = [];

  const flush = (out) => {
    if (data.length) out.push({ event: event || 'message', data: data.join('\n') });
    event = '';
    data = [];
  };

  const takeLine = (line, out) => {
    if (line === '') {
      flush(out);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };

  return {
    /** Add text; returns the events completed by it. */
    feed(text) {
      const out = [];
      buffer += text;
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match) break;
        // A lone \r at the very end may be the first half of \r\n.
        if (match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        takeLine(line, out);
      }
      return out;
    },
    /** End of stream: dispatch what is left. */
    end() {
      const out = [];
      if (buffer) takeLine(buffer, out);
      buffer = '';
      flush(out);
      return out;
    },
  };
}
