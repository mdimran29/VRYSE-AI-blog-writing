"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StageLog } from "./stage-log";
import { streamJob, type StageEvent } from "./stream-client";

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function BriefForm({ companies, defaults }: { companies: string[]; defaults: { audience: string; targetWords: number } }) {
  const router = useRouter();
  const [events, setEvents] = useState<(StageEvent & { at: number })[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    setEvents([]);
    setStartedAt(Date.now());
    const brief = {
      company: String(form.get("company")),
      topic: String(form.get("topic")),
      audience: String(form.get("audience") || "") || undefined,
      primaryKeyword: String(form.get("primaryKeyword") || "") || undefined,
      targetWords: Number(form.get("targetWords")) || undefined,
      keyPoints: lines(String(form.get("keyPoints") ?? "")),
      requiredSections: lines(String(form.get("requiredSections") ?? "")),
      notes: String(form.get("notes") || "") || undefined,
    };
    try {
      const done = await streamJob<{ runId: string }>("/api/runs", brief, (e) => setEvents((prev) => [...prev, { ...e, at: Date.now() }]));
      router.push(`/runs/${done.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <form action={submit} className="space-y-5">
        <Field label="Company">
          <select name="company" className="h-9 w-full rounded-md border bg-background px-3 text-sm" defaultValue={companies[0]}>
            {companies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Topic" hint="What the article is about">
          <Input name="topic" required minLength={3} placeholder="How enterprises can move their employee fleet to electric vehicles" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Primary keyword">
            <Input name="primaryKeyword" placeholder="electric vehicles for employee transport" />
          </Field>
          <Field label="Target length (words)" hint={`House median: ${defaults.targetWords}`}>
            <Input name="targetWords" type="number" min={300} max={5000} placeholder={String(defaults.targetWords)} />
          </Field>
        </div>
        <Field label="Audience" hint="Leave empty to use the house audience">
          <Input name="audience" placeholder={defaults.audience} />
        </Field>
        <Field label="Key points" hint="One per line — each must be covered">
          <Textarea name="keyPoints" rows={4} placeholder={"Charging infrastructure for shift operations\nTotal cost of ownership vs diesel and CNG"} />
        </Field>
        <Field label="Required sections" hint="One per line, optional">
          <Textarea name="requiredSections" rows={2} placeholder="FAQ" />
        </Field>
        <Field label="Notes for the writer" hint="Optional">
          <Textarea name="notes" rows={2} />
        </Field>
        <Button type="submit" disabled={busy} size="lg">
          {busy ? "Generating…" : "Generate article"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
      <aside className="space-y-3 rounded-xl border p-4 lg:sticky lg:top-6 lg:self-start">
        <h2 className="text-sm font-semibold">Progress</h2>
        {events.length ? <StageLog events={events} startedAt={startedAt} /> : <p className="text-sm text-muted-foreground">Retrieve → plan → write → check → score. Takes about a minute and costs about $0.02–0.05.</p>}
      </aside>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
