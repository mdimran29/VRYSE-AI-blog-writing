import { Progress } from "@/components/ui/progress";
import type { Dimension, DimensionScore } from "@/lib/schemas/evaluation";

const LABELS: Record<Dimension, string> = {
  structure: "Structure",
  style: "Style",
  relevance: "Relevance",
  completeness: "Completeness",
  tone: "Tone",
  readability: "Readability",
  specificity: "Specificity",
};

/** Overall score plus one bar per dimension, showing the measured and judged halves. */
export function ScorePanel({ overall, capped, dimensions, judge }: { overall: number; capped: boolean; dimensions: Record<Dimension, DimensionScore>; judge: { model: string; runs: number; available: boolean } }) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-semibold tabular-nums">{overall.toFixed(1)}</span>
        <span className="text-muted-foreground">/ 100</span>
        {capped && <span className="text-xs text-destructive">capped: a required section is missing</span>}
      </div>
      <ul className="space-y-2.5">
        {(Object.keys(LABELS) as Dimension[]).map((d) => {
          const s = dimensions[d];
          const parts = [s.deterministic !== null && `measured ${s.deterministic.toFixed(0)}`, s.judge !== null && `judge ${s.judge.toFixed(0)}`].filter(Boolean).join(" · ");
          return (
            <li key={d} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>
                  {LABELS[d]} <span className="text-xs text-muted-foreground">{Math.round(s.weight * 100)}%</span>
                </span>
                <span className="tabular-nums font-medium">{s.score.toFixed(0)}</span>
              </div>
              <Progress value={Math.round(s.score)} />
              <p className="text-xs text-muted-foreground">{parts}</p>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Judge: {judge.model}, {judge.runs} run{judge.runs === 1 ? "" : "s"} averaged{judge.available ? "" : " — unavailable, measured scores only"}
      </p>
    </div>
  );
}
