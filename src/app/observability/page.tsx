import { costSummary } from "@/lib/ui/data";

export const dynamic = "force-dynamic";

export default function UsagePage() {
  const { byStage, total, budget, evaluated } = costSummary();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-muted-foreground">Every AI call is logged with its stage, model, cost, time and status.</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Stat label="Total spend" value={`$${total.toFixed(2)}`} />
        <Stat label="Spending cap" value={`$${budget.toFixed(2)}`} />
        <Stat label="Evaluations" value={String(evaluated)} />
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-normal">Stage</th>
              <th className="px-4 py-2 font-normal">Model</th>
              <th className="px-4 py-2 text-right font-normal">Calls</th>
              <th className="px-4 py-2 text-right font-normal">Errors</th>
              <th className="px-4 py-2 text-right font-normal">Avg time</th>
              <th className="px-4 py-2 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {byStage.map((r) => (
              <tr key={`${r.stage}-${r.model}`} className="border-b last:border-0">
                <td className="px-4 py-2">{r.stage}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.model}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.calls}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.errors}</td>
                <td className="px-4 py-2 text-right tabular-nums">{(r.avgMs / 1000).toFixed(1)}s</td>
                <td className="px-4 py-2 text-right tabular-nums">${r.cost.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-36 rounded-xl border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
