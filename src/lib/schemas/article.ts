import { z } from "zod";

// Inline text is stored as markdown (**bold**, *italic*, [link](url)) so formatting signals survive.
export const BlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(6), text: z.string() }),
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(z.string()) }),
  z.object({ type: z.literal("table"), rows: z.array(z.array(z.string())) }),
  z.object({ type: z.literal("quote"), text: z.string() }),
]);
export type Block = z.infer<typeof BlockSchema>;

export const ArticleMetaSchema = z.object({
  fileName: z.string(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  urlSlug: z.string().optional(),
});
export type ArticleMeta = z.infer<typeof ArticleMetaSchema>;

export const ArticleSchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  sourcePath: z.string(),
  meta: ArticleMetaSchema,
  blocks: z.array(BlockSchema),
  markdown: z.string(),
  contentHash: z.string(),
  split: z.enum(["train", "test"]),
});
export type Article = z.infer<typeof ArticleSchema>;
