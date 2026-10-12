import path from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { getConfig } from "@/lib/config";

let extractor: Promise<FeatureExtractionPipeline> | undefined;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = path.resolve(getConfig().VRYSE_DATA_DIR, ".models");
    return pipeline("feature-extraction", getConfig().VRYSE_EMBED_MODEL, { dtype: "fp32" });
  })();
  return extractor;
}

// BGE models are trained with this instruction on queries (not on passages) and CLS pooling.
const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
const isBge = () => /bge/i.test(getConfig().VRYSE_EMBED_MODEL);

/** Embeds texts locally into L2-normalised vectors, so a dot product is cosine similarity. */
export async function embed(texts: string[], kind: "query" | "passage", batchSize = 16): Promise<Float32Array[]> {
  const model = await getExtractor();
  const inputs = kind === "query" && isBge() ? texts.map((t) => BGE_QUERY_PREFIX + t) : texts;
  const out: Float32Array[] = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    const tensor = await model(inputs.slice(i, i + batchSize), { pooling: isBge() ? "cls" : "mean", normalize: true });
    const [rows, dims] = tensor.dims as [number, number];
    const data = tensor.data as Float32Array;
    for (let r = 0; r < rows; r++) out.push(data.slice(r * dims, (r + 1) * dims));
  }
  return out;
}

export const embedQuery = async (text: string) => (await embed([text], "query"))[0];
