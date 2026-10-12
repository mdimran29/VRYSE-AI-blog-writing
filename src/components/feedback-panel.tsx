"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StageLog } from "./stage-log";
import { streamJob, type StageEvent } from "./stream-client";

type Weakness = { issue: string; severity: string; source: string; recommendation: string; target: string };
type Instruction = { id: string; scope: "global" | "section"; target: string; action: string; instruction: string; acceptanceCheck: string; source: "human" | "evaluator"; persist: boolean };

/** Feedback → compile → review/edit instructions → revise, with live progress. */
export function FeedbackPanel({ runId, version, weaknesses }: { runId: string; version: number; weaknesses: Weakness[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [rating, setRating] = useState<number | undefined>();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"revise" | "regenerate">("revise");
  const [instructions, setInstructions] = useState<Instruction[] | null>(null);
  const [events, setEvents] = useState<(StageEvent & { at: number })[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<"compile" | "revise" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const feedback = { text, rating, selectedWeaknesses: selected };
  const toggle = (n: number, on: boolean) => setSelected((s) => (on ? [...s, n].sort((a, b) => a - b) : s.filter((x) => x !== n)));

  async function compile() {
    setBusy("compile");
    setError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/compile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, feedback }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setInstructions(body.instructions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function revise() {
    if (!instructions?.length) return;
    setBusy("revise");
    setError(null);
    setEvents([]);
    setStartedAt(Date.now());
    try {
      const done = await streamJob<{ version: number }>(`/api/runs/${runId}/revise`, { fromVersion: version, mode, feedback, instructions }, (e) => setEvents((p) => [...p, { ...e, at: Date.now() }]));
      router.push(`/runs/${runId}?v=${done.version}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const edit = (i: number, patch: Partial<Instruction>) => setInstructions((list) => list!.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Weaknesses — tick the ones you agree with</h3>
        <ul className="space-y-2">
          {weaknesses.map((w, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <Checkbox checked={selected.includes(i + 1)} onCheckedChange={(on) => toggle(i + 1, Boolean(on))} className="mt-0.5" aria-label={`Select weakness ${i + 1}`} />
              <div>
                <span className="mr-1.5 tabular-nums text-muted-foreground">{i + 1}.</span>
                <Badge variant={w.severity === "high" ? "destructive" : "secondary"} className="mr-1.5">{w.severity}</Badge>
                <Badge variant="outline" className="mr-1.5">{w.source}</Badge>
                {w.issue}
                {w.recommendation && <p className="mt-0.5 text-muted-foreground">→ {w.recommendation}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <Label>Your rating</Label>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Button key={n} type="button" size="sm" variant={rating === n ? "default" : "outline"} onClick={() => setRating(rating === n ? undefined : n)}>
              {n}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Feedback</Label>
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should change? General rules ('never…', 'always…') are remembered for future articles." />
      </div>

      <Button onClick={compile} disabled={busy !== null || (!text.trim() && !selected.length)} variant="secondary">
        {busy === "compile" ? "Compiling…" : instructions ? "Re-compile instructions" : "Compile instructions"}
      </Button>

      {instructions && (
        <div className="space-y-3 rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Revision instructions — edit or remove before revising</h3>
          {instructions.map((ins, i) => (
            <div key={i} className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{ins.id}</Badge>
                <Badge variant="secondary">{ins.action}</Badge>
                <span className="text-muted-foreground">{ins.scope === "global" ? "whole article" : ins.target}</span>
                {ins.persist && <Badge>remembered</Badge>}
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setInstructions((l) => l!.filter((_, n) => n !== i))}>
                  Remove
                </Button>
              </div>
              <Textarea rows={2} value={ins.instruction} onChange={(e) => edit(i, { instruction: e.target.value })} />
              <p className="text-xs text-muted-foreground">Check: {ins.acceptanceCheck}</p>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <select value={mode} onChange={(e) => setMode(e.target.value as "revise" | "regenerate")} className="h-8 rounded-md border bg-background px-2 text-sm">
              <option value="revise">Targeted revision</option>
              <option value="regenerate">Regenerate from a new outline</option>
            </select>
            <Button onClick={revise} disabled={busy !== null || !instructions.length}>
              {busy === "revise" ? "Revising…" : `Revise (${instructions.length} instruction${instructions.length === 1 ? "" : "s"})`}
            </Button>
            <span className="text-xs text-muted-foreground">About 1–2 minutes, ~$0.03–0.05</span>
          </div>
        </div>
      )}
      <StageLog events={events} startedAt={startedAt} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
