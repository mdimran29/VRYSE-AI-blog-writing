export type StageEvent = { type: "event"; stage: string; status: "start" | "done"; detail?: string };

/** POSTs a JSON body and reads the NDJSON progress stream until "done" or "error". */
export async function streamJob<T>(url: string, body: unknown, onEvent: (e: StageEvent) => void): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? "Request failed");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.type === "event") onEvent(message);
      else if (message.type === "error") throw new Error(message.message);
      else if (message.type === "done") return message as T;
    }
  }
  throw new Error("The stream ended without a result.");
}
