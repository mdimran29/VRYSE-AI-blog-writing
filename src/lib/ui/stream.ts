/** Runs a long job and streams its progress as newline-delimited JSON: events, then "done" or "error". */
export function ndjsonStream<T>(job: (emit: (event: unknown) => void) => Promise<T>, done: (result: T) => unknown): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const result = await job((event) => send({ type: "event", ...(event as object) }));
        send({ type: "done", ...(done(result) as object) });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
