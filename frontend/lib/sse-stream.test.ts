import { describe, it, expect } from "vitest";
import { readSseEvents } from "./sse-stream";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(stream);
}

describe("readSseEvents", () => {
  it("parses events split across chunk boundaries", async () => {
    const received: unknown[] = [];
    await readSseEvents(
      sseResponse(['data: {"type":"pro', 'gress","current":1}\n\ndata: {"type":"complete"}\n\n']),
      (event) => received.push(event),
    );

    expect(received).toEqual([{ type: "progress", current: 1 }, { type: "complete" }]);
  });

  it("flushes a trailing event without a terminating blank line", async () => {
    const received: unknown[] = [];
    await readSseEvents(sseResponse(['data: {"type":"complete"}']), (event) =>
      received.push(event),
    );

    expect(received).toEqual([{ type: "complete" }]);
  });

  it("skips malformed events instead of throwing", async () => {
    const received: unknown[] = [];
    await readSseEvents(sseResponse(["data: not-json\n\n", 'data: {"ok":true}\n\n']), (event) =>
      received.push(event),
    );

    expect(received).toEqual([{ ok: true }]);
  });

  it("throws when the response has no body", async () => {
    await expect(readSseEvents(new Response(null), () => {})).rejects.toThrow(
      "Response body is not readable",
    );
  });
});
