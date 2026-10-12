import { diffWords } from "diff";

/** Side-by-side word diff: removals highlighted on the left, additions on the right. */
export function DiffView({ before, after, labels }: { before: string; after: string; labels: [string, string] }) {
  const parts = diffWords(before, after);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {([0, 1] as const).map((side) => (
        <div key={side} className="min-w-0 rounded-xl border">
          <div className="border-b px-4 py-2 text-sm font-medium">{labels[side]}</div>
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 font-sans text-sm leading-relaxed">
            {parts.map((p, i) =>
              p.added ? (
                side === 1 && <ins key={i} className="rounded bg-emerald-100 text-emerald-900 no-underline dark:bg-emerald-900/40 dark:text-emerald-100">{p.value}</ins>
              ) : p.removed ? (
                side === 0 && <del key={i} className="rounded bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100">{p.value}</del>
              ) : (
                <span key={i}>{p.value}</span>
              ),
            )}
          </pre>
        </div>
      ))}
    </div>
  );
}
