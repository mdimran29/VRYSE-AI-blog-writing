import { BriefForm } from "@/components/brief-form";
import { listCompanies, readProfile } from "@/lib/ui/data";

export const dynamic = "force-dynamic";

export default function NewArticle() {
  const companies = listCompanies();
  const profile = companies[0] ? readProfile(companies[0]) : null;
  if (!profile) return <p>No style profile yet. Run <code>pnpm vryse profile build --company &lt;slug&gt;</code> first.</p>;
  const median = profile.stats.distributions.numeric.wordCount?.median ?? 1500;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New article</h1>
        <p className="text-sm text-muted-foreground">Describe the article. Anything left empty is taken from the company&apos;s style profile.</p>
      </div>
      <BriefForm companies={companies} defaults={{ audience: profile.guide.audience, targetWords: Math.round(median / 50) * 50 }} />
    </div>
  );
}
