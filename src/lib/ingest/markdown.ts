import type { Block } from "@/lib/schemas/article";

const escapeCell = (cell: string) => cell.replace(/\|/g, "\\|");

function tableToMarkdown(rows: string[][]): string {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => escapeCell(cells[i] ?? "")).join(" | ")} |`;
  const [header, ...body] = rows;
  return [line(header), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${block.text}`;
    case "paragraph":
      return block.text;
    case "list":
      return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${item}`).join("\n");
    case "table":
      return tableToMarkdown(block.rows);
    case "quote":
      return `> ${block.text}`;
  }
}

export function blocksToMarkdown(blocks: Block[]): string {
  return `${blocks.map(blockToMarkdown).join("\n\n")}\n`;
}

/** Inline markdown → plain text, for word counts and readability. */
export function inlineToPlain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));

/** Parses the markdown subset the system produces (and LLMs write) back into blocks. */
export function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n").filter((l) => !/^\s*```/.test(l));
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ").replace(/\s+/g, " ").trim() });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);

    if (!trimmed) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
    } else if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = (ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/).exec(lines[i]);
        if (!m) break;
        items.push(m[1].trim());
      }
      i--;
      blocks.push({ type: "list", ordered, items });
    } else if (trimmed.startsWith("|")) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const row = splitRow(lines[i]);
        if (row.every((c) => /^:?-{3,}:?$/.test(c))) continue; // separator row
        rows.push(row);
      }
      i--;
      blocks.push({ type: "table", rows });
    } else if (trimmed.startsWith(">")) {
      flush();
      blocks.push({ type: "quote", text: trimmed.replace(/^>\s?/, "") });
    } else {
      paragraph.push(trimmed);
    }
  }
  flush();
  return blocks;
}
