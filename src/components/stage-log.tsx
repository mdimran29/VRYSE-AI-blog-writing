"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import type { StageEvent } from "./stream-client";

/** Live list of pipeline stages: a spinner while a stage runs, a tick and its detail when it's done. */
export function StageLog({ events, startedAt }: { events: (StageEvent & { at: number })[]; startedAt: number | null }) {
  if (!events.length) return null;
  const rows: { stage: string; running: boolean; detail?: string; at: number }[] = [];
  for (const e of events) {
    const open = rows.findLast((r) => r.stage === e.stage && r.running);
    if (e.status === "start") rows.push({ stage: e.stage, running: true, detail: e.detail, at: e.at });
    else if (open) Object.assign(open, { running: false, detail: e.detail ?? open.detail, at: e.at });
  }
  return (
    <ol className="space-y-1.5 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start gap-2">
          {r.running ? <Loader2 className="mt-0.5 size-4 animate-spin text-muted-foreground" /> : <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />}
          <span className="w-20 shrink-0 font-medium capitalize">{r.stage}</span>
          <span className="text-muted-foreground">{r.detail}</span>
          {startedAt && <span className="ml-auto tabular-nums text-xs text-muted-foreground">{((r.at - startedAt) / 1000).toFixed(0)}s</span>}
        </li>
      ))}
    </ol>
  );
}
