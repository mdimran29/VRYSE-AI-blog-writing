import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedbackPanel } from "@/components/feedback-panel";
import { Markdown } from "@/components/markdown";
import { ScorePanel } from "@/components/score-panel";
import { buttonVariants } from "@/components/ui/button";
import { VerdictCard } from "@/components/verdict-card";
import { getRunView } from "@/lib/ui/data";

export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const { v } = await searchParams;
  const view = getRunView(id, v ? Number(v) : undefined);
  if (!view) notFound();
  const { brief, versions, current, evaluation, revision } = view;
  const latest = versions[versions.length - 1].version;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{brief.topic}</h1>
        <p className="text-sm text-muted-foreground">
          {brief.company} · {brief.audience} · target {brief.targetWords} words
          {brief.keyPoints.length > 0 && ` · ${brief.keyPoints.length} key points`}
        </p>
        <nav className="flex flex-wrap items-center gap-2 pt-1">
          {versions.map((x) => (
            <Link key={x.version} href={`/runs/${id}?v=${x.version}`} className={buttonVariants({ variant: x.version === current.version ? "default" : "outline", size: "sm" })}>
              v{x.version} · {x.overall === null ? "–" : x.overall.toFixed(1)}
            </Link>
          ))}
          {current.version > 1 && (
            <Link href={`/runs/${id}/compare?a=${current.version - 1}&b=${current.version}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Compare v{current.version - 1} ↔ v{current.version}
            </Link>
          )}
        </nav>
      </div>

      {revision && <VerdictCard revision={revision} version={current.version} />}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article className="min-w-0 rounded-xl border p-6">
          <Markdown>{current.markdown}</Markdown>
        </article>
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          {evaluation ? (
            <>
              <ScorePanel overall={evaluation.overall} capped={evaluation.capped} dimensions={evaluation.dimensions} judge={evaluation.judge} />
              {evaluation.keyPoints.length > 0 && (
                <div className="space-y-1.5 text-sm">
                  <h3 className="font-semibold">Key points</h3>
                  {evaluation.keyPoints.map((k) => (
                    <p key={k.point}>
                      {k.status === "covered" ? "✓" : k.status === "partial" ? "~" : "✗"} {k.point}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-sm text-muted-foreground">{evaluation.summary}</p>
              {evaluation.unsupportedClaims.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold">Unsupported claims ({evaluation.unsupportedClaims.length})</summary>
                  <ul className="mt-2 space-y-2">{evaluation.unsupportedClaims.map((c, i) => <li key={i} className="text-muted-foreground">“{c.quote}”</li>)}</ul>
                </details>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not evaluated yet.</p>
          )}
        </aside>
      </div>

      {evaluation && (
        <section className="rounded-xl border p-6">
          <h2 className="mb-1 text-lg font-semibold">Feedback</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            {current.version === latest ? "Review the article and request a revision." : `You are viewing an older version; revising it creates v${latest + 1} from v${current.version}.`}
          </p>
          <FeedbackPanel key={current.version} runId={id} version={current.version} weaknesses={evaluation.weaknesses} />
        </section>
      )}
    </div>
  );
}
