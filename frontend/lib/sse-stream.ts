/**
 * Read a `text/event-stream` response and hand each `data:` payload to a callback.
 *
 * Our batch endpoints emit one JSON object per SSE event; malformed events are
 * skipped rather than aborting the stream.
 */
export async function readSseEvents<T>(
  response: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is not readable");

  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        onEvent(JSON.parse(line.substring(6)) as T);
      } catch (error) {
        console.error("Failed to parse SSE event:", error);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    events.forEach(flush);
  }

  if (buffer.trim()) flush(buffer);
}
