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
