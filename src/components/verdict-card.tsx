import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RevisionFile } from "@/lib/ui/data";

const TONE: Record<string, string> = {
  improved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  mixed: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  regressed: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
};

/** The verdict for a revision, with the reasons and the ✓/✗ instruction checklist. */
export function VerdictCard({ revision, version }: { revision: RevisionFile; version: number }) {
  const v = revision.verdict;
  return (
    <div className="space-y-4 rounded-xl border p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-md px-2.5 py-1 text-sm font-semibold uppercase ${TONE[v.verdict] ?? ""}`}>{v.verdict}</span>
        <span className="text-sm text-muted-foreground">
          v{revision.fromVersion} → v{version} · {v.delta >= 0 ? "+" : ""}
          {v.delta.toFixed(1)} points (threshold ±{v.threshold})
        </span>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Instructions</h3>
        <ul className="space-y-2 text-sm">
          {revision.instructions.map((ins) => {
            const check = revision.verification.find((x) => x.id === ins.id);
            return (
              <li key={ins.id} className="flex gap-2">
                {check?.addressed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />}
                <div>
                  <span className="font-medium">{ins.id}</span> <span className="text-muted-foreground">[{ins.target}]</span> {ins.instruction}
                  {ins.persist && <Badge className="ml-1.5">remembered</Badge>}
                  {check?.evidence && <p className="mt-0.5 line-clamp-2 text-muted-foreground">“{check.evidence}”</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {revision.untargeted.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">⚠ Changed without an instruction: {revision.untargeted.join(", ")}</p>}
      {v.pairwise && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Side-by-side judge preferred the {v.pairwise.winner} version (confidence {v.pairwise.confidence}/5)
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{v.pairwise.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
