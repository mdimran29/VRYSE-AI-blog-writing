import { z } from "zod";
import { compileForRun } from "@/lib/pipeline";

const Body = z.object({
  version: z.number().int().min(1),
  feedback: z.object({ text: z.string(), rating: z.number().int().min(1).max(5).optional(), selectedWeaknesses: z.array(z.number().int()).optional() }),
});

/** Turns feedback into instructions without revising, so the reviewer can edit them first. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Body.safeParse(await request.json());
  if (!body.success) return Response.json({ error: "Invalid feedback" }, { status: 400 });
  try {
    return Response.json({ instructions: await compileForRun(id, body.data.version, body.data.feedback) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
