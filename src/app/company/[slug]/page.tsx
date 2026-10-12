import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { readProfile } from "@/lib/ui/data";

export const dynamic = "force-dynamic";

const FEATURES: [string, string][] = [
  ["wordCount", "Words"],
  ["h2Count", "H2 sections"],
  ["introWords", "Intro words"],
  ["wordsPerSentenceMean", "Words per sentence"],
  ["wordsPerParagraphMean", "Words per paragraph"],
  ["fleschKincaidGrade", "Reading grade"],
  ["boldPer1k", "Bold per 1k words"],
  ["linksPer1k", "Links per 1k words"],
  ["faqQuestionCount", "FAQ questions"],
];

export default async function CompanyPage({ params }: PageProps<"/company/[slug]">) {
  const { slug } = await params;
  const p = readProfile(slug);
  if (!p) notFound();
  const g = p.guide;
  const n = p.stats.distributions.numeric;
  const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight capitalize">{p.company} — style profile</h1>
        <p className="text-sm text-muted-foreground">
          Version {p.version} · learned from {p.corpus.articleCount} articles · {p.models.extraction} + {p.models.synthesis}
        </p>
      </div>
      <p className="max-w-3xl text-lg leading-relaxed">{g.summary}</p>

      <section className="grid gap-6 md:grid-cols-2">
        <Card title="Voice">
          <p className="mb-2 flex flex-wrap gap-1.5">{g.voice.tone.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}</p>
          <dl className="space-y-1.5 text-sm">
            <Row k="Audience" v={g.audience} />
            <Row k="Point of view" v={g.voice.pointOfView} />
            <Row k="Recognisable by" v={g.voice.personality} />
          </dl>
        </Card>
        <Card title="Structure">
          <ol className="list-decimal space-y-1 pl-5 text-sm">{g.structure.typicalOutline.map((s) => <li key={s}>{s}</li>)}</ol>
        </Card>
        <Card title="Measured ranges (p10 – median – p90)">
          <table className="w-full text-sm">
            <tbody>
              {FEATURES.filter(([k]) => n[k]).map(([k, label]) => (
                <tr key={k} className="border-b last:border-0">
                  <td className="py-1.5">{label}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(n[k].p10)} – <b>{fmt(n[k].median)}</b> – {fmt(n[k].p90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Intro patterns">
          <ul className="space-y-1.5 text-sm">
            {g.structure.introPatterns.map((x) => (
              <li key={x.pattern} className="flex justify-between gap-4">
                <span>{x.pattern}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{x.articles}/{p.corpus.articleCount}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Do">
          <ul className="list-disc space-y-1 pl-5 text-sm">{g.rules.do.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
        <Card title="Don't">
          <ul className="list-disc space-y-1 pl-5 text-sm">{g.rules.dont.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
        <Card title="Vocabulary">
          <p className="mb-2 text-sm">{g.vocabulary.spelling}</p>
          <p className="flex flex-wrap gap-1.5">{g.vocabulary.preferredTerms.slice(0, 20).map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</p>
        </Card>
        <Card title="Phrases to avoid">
          <p className="flex flex-wrap gap-1.5">{p.avoidPhrases.map((t) => <Badge key={t} variant="destructive">{t}</Badge>)}</p>
        </Card>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="inline font-medium">{k}: </dt>
      <dd className="inline text-muted-foreground">{v}</dd>
    </div>
  );
}
