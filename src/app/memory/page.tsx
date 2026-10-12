import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { forget, listMemory } from "@/lib/feedback/memory";
import { listCompanies } from "@/lib/ui/data";

export const dynamic = "force-dynamic";

async function remove(form: FormData) {
  "use server";
  forget(String(form.get("id")));
  revalidatePath("/memory");
}

export default function MemoryPage() {
  const companies = listCompanies();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="text-sm text-muted-foreground">General rules from your feedback (&quot;never…&quot;, &quot;always…&quot;). They are applied to every future article for the company.</p>
      </div>
      {companies.map((company) => {
        const items = listMemory(company);
        return (
          <section key={company} className="rounded-xl border p-5">
            <h2 className="mb-3 font-semibold capitalize">{company}</h2>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved rules yet.</p>
            ) : (
              <ul className="divide-y">
                {items.map((m) => (
                  <li key={m.id} className="flex items-center gap-4 py-2 text-sm">
                    <span className="flex-1">{m.instruction}</span>
                    <span className="text-xs text-muted-foreground">{m.createdAt.toLocaleDateString()}</span>
                    <form action={remove}>
                      <input type="hidden" name="id" value={m.id} />
                      <Button type="submit" size="sm" variant="ghost">Delete</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
