import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { memory } from "@/lib/db/schema";
import type { RevisionInstruction } from "@/lib/schemas/feedback";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Standing preferences for a company, oldest first. */
export function listMemory(company: string) {
  return getDb().select().from(memory).where(eq(memory.company, company)).orderBy(asc(memory.createdAt)).all();
}

/** Saves instructions marked `persist` as company preferences, skipping ones already remembered. */
export function rememberInstructions(company: string, instructions: RevisionInstruction[], sourceFeedbackId?: string): string[] {
  const known = new Set(listMemory(company).map((m) => norm(m.instruction)));
  const added: string[] = [];
  for (const i of instructions.filter((x) => x.persist)) {
    if (known.has(norm(i.instruction))) continue;
    getDb().insert(memory).values({ id: randomUUID(), company, instruction: i.instruction, sourceFeedbackId }).run();
    known.add(norm(i.instruction));
    added.push(i.instruction);
  }
  return added;
}

export function forget(id: string) {
  getDb().delete(memory).where(eq(memory.id, id)).run();
}
