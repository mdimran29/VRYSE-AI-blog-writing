import { runGeneration } from "@/lib/pipeline";
import { BriefSchema } from "@/lib/schemas/generation";
import { ndjsonStream } from "@/lib/ui/stream";

export const maxDuration = 300;

/** Starts a generation run and streams stage events (retrieve → plan → write → lint → evaluate → save). */
export async function POST(request: Request) {
  const parsed = BriefSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  return ndjsonStream(
    (emit) => runGeneration(parsed.data, emit),
    (result) => ({ runId: result.runId }),
  );
}
