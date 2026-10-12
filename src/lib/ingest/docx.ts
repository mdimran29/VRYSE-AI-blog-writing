import path from "node:path";
import mammoth from "mammoth";
import { NodeType, parse, type HTMLElement, type Node } from "node-html-parser";
import type { ArticleMeta, Block } from "@/lib/schemas/article";
import { inlineToPlain } from "./markdown";

// Labels for screenshots and reports pasted in during editing, e.g. "Grammarly Plagiarism & AI Report".
const EDITORIAL = /^(grammarly|plagiarism|ai (detection|report)|originality|copyscape|zerogpt|quillbot)\b/i;
const META_LINE = /^(meta title|meta description|url slug|slug)\s*:\s*(.*)$/i;
const META_KEYS: Record<string, keyof Omit<ArticleMeta, "fileName">> = {
  "meta title": "metaTitle",
  "meta description": "metaDescription",
  "url slug": "urlSlug",
  slug: "urlSlug",
};
const BLOCKY = new Set(["p", "div", "li", "td", "th", "tr", "table", "ul", "ol"]);

const cleanText = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " ");

const finalize = (s: string) =>
  s
    .replace(/\*\*\*\*/g, "") // adjacent bold runs: **a****b** → **ab**
    .replace(/\s+/g, " ")
    .trim();

function wrap(text: string, mark: string): string {
  const inner = text.trim();
  if (!inner) return text.length ? " " : "";
  const lead = /^\s/.test(text) ? " " : "";
  const trail = /\s$/.test(text) ? " " : "";
  return `${lead}${mark}${inner}${mark}${trail}`;
}

function renderInline(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) return cleanText(node.text);
  if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.rawTagName?.toLowerCase();
  if (tag === "img") return "";
  if (tag === "br") return " ";
  const inner = el.childNodes.map(renderInline).join("");
  if (tag === "strong" || tag === "b") return wrap(inner, "**");
  if (tag === "em" || tag === "i") return wrap(inner, "*");
  if (tag === "a") {
    const href = el.getAttribute("href");
    if (!href || href.startsWith("#") || !inner.trim()) return inner;
    return wrap(inner, "").replace(inner.trim(), `[${inner.trim()}](${href})`);
  }
  return BLOCKY.has(tag) ? ` ${inner} ` : inner;
}

const elementChildren = (el: HTMLElement) =>
  el.childNodes.filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE);

function listItems(list: HTMLElement): string[] {
  const items: string[] = [];
  for (const li of elementChildren(list).filter((c) => c.rawTagName.toLowerCase() === "li")) {
    const nested = elementChildren(li).filter((c) => ["ul", "ol"].includes(c.rawTagName.toLowerCase()));
    const own = finalize(li.childNodes.filter((c) => !nested.includes(c as HTMLElement)).map(renderInline).join(""));
    if (own) items.push(own);
    for (const sub of nested) items.push(...listItems(sub));
  }
  return items;
}

export type ParsedHtml = {
  blocks: Block[];
  meta: Omit<ArticleMeta, "fileName">;
  editorialRemoved: number;
  promotedHeadings: number;
};

/** Walks mammoth's HTML output into article blocks. */
export function htmlToBlocks(html: string): ParsedHtml {
  const blocks: Block[] = [];
  const meta: ParsedHtml["meta"] = {};
  const boldCandidates: number[] = [];
  let editorialRemoved = 0;

  for (const el of elementChildren(parse(html))) {
    const tag = el.rawTagName.toLowerCase();
    const heading = /^h([1-6])$/.exec(tag);

    if (heading) {
      const text = inlineToPlain(finalize(renderInline(el)));
      if (text) blocks.push({ type: "heading", level: Number(heading[1]), text });
    } else if (tag === "ul" || tag === "ol") {
      const items = listItems(el);
      if (items.length) blocks.push({ type: "list", ordered: tag === "ol", items });
    } else if (tag === "table") {
      const rows = el
        .querySelectorAll("tr")
        .map((tr) => elementChildren(tr).map((cell) => finalize(renderInline(cell))))
        .filter((row) => row.some(Boolean));
      if (rows.length) blocks.push({ type: "table", rows });
    } else {
      const text = finalize(renderInline(el));
      if (!text) continue;
      const plain = inlineToPlain(text);
      const metaLine = META_LINE.exec(plain);
      if (metaLine) {
        meta[META_KEYS[metaLine[1].toLowerCase()]] = metaLine[2].trim();
        continue;
      }
      if (EDITORIAL.test(plain) && plain.length < 120) {
        editorialRemoved++;
        continue;
      }
      if (tag === "blockquote") {
        blocks.push({ type: "quote", text });
        continue;
      }
      const boldOnly = text === `**${plain}**` && plain.split(" ").length <= 14 && !/[.:;!,]$/.test(plain);
      if (boldOnly) boldCandidates.push(blocks.length);
      blocks.push({ type: "paragraph", text });
    }
  }

  // Some docs fake headings with bold lines. Only trust that guess when the doc has no real H2 structure.
  let promotedHeadings = 0;
  const realH2s = blocks.filter((b) => b.type === "heading" && b.level === 2).length;
  if (realH2s < 2) {
    for (const i of boldCandidates) {
      const next = blocks[i + 1];
      if (next && next.type !== "heading") {
        blocks[i] = { type: "heading", level: 2, text: inlineToPlain(blocks[i].type === "paragraph" ? blocks[i].text : "") };
        promotedHeadings++;
      }
    }
  }

  return { blocks, meta, editorialRemoved, promotedHeadings };
}

/** Converts a .docx file to blocks. Images are dropped before HTML is built. */
export async function parseDocx(filePath: string) {
  const result = await mammoth.convertToHtml(
    { path: filePath },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  const parsed = htmlToBlocks(result.value);
  const h1 = parsed.blocks.find((b) => b.type === "heading" && b.level === 1);
  const title = h1?.type === "heading" ? h1.text : path.basename(filePath, path.extname(filePath));
  return { ...parsed, title, warnings: result.messages.map((m) => m.message) };
}
