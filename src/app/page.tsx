import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listRuns } from "@/lib/ui/data";

export const dynamic = "force-dynamic";

export default function Home() {
  const runs = listRuns();
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Article runs</h1>
          <p className="text-sm text-muted-foreground">Each run is one brief: its versions, scores and feedback cycles.</p>
        </div>
        <Link href="/articles/new" className={buttonVariants()}>
          New article
        </Link>
      </div>
      {runs.length === 0 ? (
        <p className="rounded-xl border p-8 text-center text-muted-foreground">No runs yet. Start with a new article.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/runs/${r.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 hover:bg-muted/50">
                <span className="min-w-0 flex-1 font-medium">{r.topic}</span>
                <span className="text-sm text-muted-foreground">{r.company}</span>
                <span className="text-sm tabular-nums">
                  {r.scores.map((s, i) => (
                    <span key={i} className="ml-2">
                      v{i + 1} <b>{s === null ? "–" : s.toFixed(1)}</b>
                    </span>
                  ))}
                </span>
                <span className="w-24 text-right text-xs text-muted-foreground">{r.createdAt.toLocaleDateString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
