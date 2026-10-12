import { z } from "zod";
import { runRevision } from "@/lib/pipeline";
import { RevisionInstructionSchema } from "@/lib/schemas/feedback";
import { ndjsonStream } from "@/lib/ui/stream";

export const maxDuration = 300;

const Body = z.object({
  fromVersion: z.number().int().min(1),
  mode: z.enum(["revise", "regenerate"]).default("revise"),
  feedback: z.object({ text: z.string(), rating: z.number().int().min(1).max(5).optional(), selectedWeaknesses: z.array(z.number().int()).optional() }),
  instructions: z.array(RevisionInstructionSchema).optional(),
});

/** Runs one feedback cycle and streams its stage events; ends with the new version number. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Body.safeParse(await request.json());
  if (!body.success) return Response.json({ error: "Invalid revision request" }, { status: 400 });
  return ndjsonStream(
    (emit) => runRevision({ runId: id, ...body.data }, emit),
    (result) => ({ version: result.version, verdict: result.verdict.verdict }),
  );
}
