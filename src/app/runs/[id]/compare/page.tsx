import Link from "next/link";
import { notFound } from "next/navigation";
import { DiffView } from "@/components/diff-view";
import { VerdictCard } from "@/components/verdict-card";
import { latestEvaluation } from "@/lib/pipeline";
import { DIMENSIONS } from "@/lib/schemas/evaluation";
import { getRunView } from "@/lib/ui/data";

export const dynamic = "force-dynamic";

export default async function ComparePage({ params, searchParams }: PageProps<"/runs/[id]/compare">) {
  const { id } = await params;
  const q = await searchParams;
  const b = getRunView(id, q.b ? Number(q.b) : undefined);
  if (!b) notFound();
  const a = getRunView(id, q.a ? Number(q.a) : Math.max(1, b.current.version - 1));
  if (!a) notFound();
  const ea = latestEvaluation(a.current.id);
  const eb = latestEvaluation(b.current.id);
  const row = (label: string, x?: number, y?: number) => (
    <tr key={label} className="border-b last:border-0">
      <td className="py-1.5 capitalize">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{x?.toFixed(1) ?? "–"}</td>
      <td className="py-1.5 text-right tabular-nums">{y?.toFixed(1) ?? "–"}</td>
      <td className={`py-1.5 text-right tabular-nums ${x !== undefined && y !== undefined ? (y - x > 0 ? "text-emerald-600" : y - x < 0 ? "text-rose-600" : "") : ""}`}>
        {x !== undefined && y !== undefined ? `${y - x >= 0 ? "+" : ""}${(y - x).toFixed(1)}` : ""}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/runs/${id}?v=${b.current.version}`} className="text-sm text-muted-foreground hover:text-foreground">← {b.brief.topic}</Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          v{a.current.version} ↔ v{b.current.version}
        </h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-xl border p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-2 font-normal">Score</th>
                <th className="pb-2 text-right font-normal">v{a.current.version}</th>
                <th className="pb-2 text-right font-normal">v{b.current.version}</th>
                <th className="pb-2 text-right font-normal">Δ</th>
              </tr>
            </thead>
            <tbody>
              {row("overall", ea?.overall, eb?.overall)}
              {DIMENSIONS.map((d) => row(d, ea?.dimensions[d].score, eb?.dimensions[d].score))}
            </tbody>
          </table>
        </div>
        {b.revision && b.revision.fromVersion === a.current.version ? (
          <VerdictCard revision={b.revision} version={b.current.version} />
        ) : (
          <p className="text-sm text-muted-foreground">v{b.current.version} was not revised directly from v{a.current.version}, so there is no verdict for this pair.</p>
        )}
      </div>
      <DiffView before={a.current.markdown} after={b.current.markdown} labels={[`v${a.current.version}`, `v${b.current.version}`]} />
    </div>
  );
}
