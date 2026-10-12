// Phrases that tend to mark generic, machine-sounding copy. Scoring compares each article's rate
// against the human reference corpus, so a phrase the company genuinely uses isn't penalised.
const AI_ISMS: { phrase: string; pattern: string }[] = [
  { phrase: "in today's fast-paced", pattern: "in today['’]s fast[- ]paced" },
  { phrase: "in today's digital landscape", pattern: "in today['’]s (?:digital|modern|ever[- ]changing|competitive|dynamic) (?:age|landscape|world|era|environment)" },
  { phrase: "delve", pattern: "delv(?:e|es|ed|ing)" },
  { phrase: "it's important to note", pattern: "it['’]?s (?:important|worth|crucial) (?:to note|noting|to remember)" },
  { phrase: "navigate the landscape", pattern: "navigat(?:e|es|ing) the (?:complex )?(?:landscape|complexities|intricacies)" },
  { phrase: "unlock the power", pattern: "unlock(?:s|ing)? the (?:full )?(?:power|potential)" },
  { phrase: "harness the power", pattern: "harness(?:es|ing)? the (?:full )?(?:power|potential)" },
  { phrase: "game-changer", pattern: "game[- ]chang(?:er|ers|ing)" },
  { phrase: "seamless", pattern: "seamless(?:ly)?" },
  { phrase: "leverage", pattern: "leverag(?:e|es|ed|ing)" },
  { phrase: "robust", pattern: "robust" },
  { phrase: "ever-evolving", pattern: "ever[- ](?:evolving|changing)" },
  { phrase: "tapestry", pattern: "tapestr(?:y|ies)" },
  { phrase: "testament to", pattern: "(?:a )?testament to" },
  { phrase: "realm", pattern: "realms?" },
  { phrase: "embark", pattern: "embark(?:s|ed|ing)?" },
  { phrase: "elevate", pattern: "elevat(?:e|es|ed|ing)" },
  { phrase: "pivotal", pattern: "pivotal" },
  { phrase: "furthermore", pattern: "furthermore" },
  { phrase: "moreover", pattern: "moreover" },
  { phrase: "in conclusion", pattern: "in conclusion" },
  { phrase: "look no further", pattern: "look no further" },
  { phrase: "a myriad of", pattern: "(?:a )?myriad(?: of)?" },
];

const COMPILED = AI_ISMS.map(({ phrase, pattern }) => ({ phrase, regex: new RegExp(`\\b${pattern}\\b`, "gi") }));

export function findAiIsms(text: string): { phrase: string; count: number }[] {
  return COMPILED.map(({ phrase, regex }) => ({ phrase, count: text.match(regex)?.length ?? 0 })).filter((h) => h.count > 0);
}
