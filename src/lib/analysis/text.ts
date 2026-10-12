const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });
const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** Words in plain text. Contractions and numbers stay whole; punctuation is dropped. */
export function splitWords(text: string): string[] {
  return [...wordSegmenter.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
}

/** Sentences in plain text, trimmed. */
export function splitSentences(text: string): string[] {
  return [...sentenceSegmenter.segment(text)].map((s) => s.segment.trim()).filter(Boolean);
}
