import { syllable } from "syllable";
import { splitSentences, splitWords } from "./text";

type Counts = { words: number; sentences: number; syllables: number };

export const fleschReadingEase = ({ words, sentences, syllables }: Counts) =>
  206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);

export const fleschKincaidGrade = ({ words, sentences, syllables }: Counts) =>
  0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;

export const countSyllables = (words: string[]) => words.reduce((sum, w) => sum + syllable(w), 0);

export function readability(text: string): { fleschReadingEase: number | null; fleschKincaidGrade: number | null } {
  const words = splitWords(text);
  const sentences = splitSentences(text).length;
  if (!words.length || !sentences) return { fleschReadingEase: null, fleschKincaidGrade: null };
  const counts = { words: words.length, sentences, syllables: countSyllables(words) };
  return { fleschReadingEase: fleschReadingEase(counts), fleschKincaidGrade: fleschKincaidGrade(counts) };
}
