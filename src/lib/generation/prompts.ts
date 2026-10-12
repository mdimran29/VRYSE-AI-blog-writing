import fs from "node:fs";
import path from "node:path";

const cache = new Map<string, string>();

/** Loads `prompts/<name>.md` and fills `{{key}}` placeholders. Unknown placeholders throw. */
export function loadPrompt(name: string, vars: Record<string, string> = {}): string {
  let template = cache.get(name);
  if (!template) {
    template = fs.readFileSync(path.join(process.cwd(), "src/lib/generation/prompts", `${name}.md`), "utf8");
    cache.set(name, template);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Prompt "${name}" needs a value for {{${key}}}`);
    return vars[key];
  });
}
