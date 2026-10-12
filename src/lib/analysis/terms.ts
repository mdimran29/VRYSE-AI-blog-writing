// Common English words that carry no company signal. Not exhaustive: a term must also recur across
// many articles to rank, which filters most remaining generic words.
const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by
  can could did do does doing down during each either else even every few for from further get gets getting go goes had has have
  having he her here hers herself him himself his how however i if in into is it its itself just let like make makes many may
  me might more most much must my myself need needs no nor not now of off often on once one only or other our ours ourselves out
  over own per same see she should so some such than that the their theirs them themselves then there these they this those
  through to too under until up upon us use used uses using very via want was way ways we well were what when where whether
  which while who whom whose why will with within without would yet you your yours yourself yourselves etc e.g i.e new also
  first second third two three four five based across around rather instead every each another since still thus therefore
  often across along already always among become becomes better best help helps make making takes take right good`.split(/\s+/),
);

const tokenize = (text: string) => text.toLowerCase().match(/[a-z][a-z'-]*[a-z]|[a-z]/g) ?? [];

export type Term = { term: string; docFrequency: number; count: number; score: number };

/**
 * Terms the company uses consistently: unigrams and bigrams that appear in at least two articles,
 * ranked by document share × log(total count). Bigrams get a boost because phrases like
 * "employee transport" carry more style signal than their single words.
 */
export function signatureTerms(docs: string[], limit = 40): Term[] {
  const df = new Map<string, number>();
  const tf = new Map<string, number>();
  for (const doc of docs) {
    const tokens = tokenize(doc);
    const seen = new Set<string>();
    const add = (term: string) => {
      tf.set(term, (tf.get(term) ?? 0) + 1);
      if (!seen.has(term)) {
        seen.add(term);
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    };
    tokens.forEach((t, i) => {
      if (!STOPWORDS.has(t) && t.length > 2) add(t);
      const next = tokens[i + 1];
      if (next && !STOPWORDS.has(t) && !STOPWORDS.has(next)) add(`${t} ${next}`);
    });
  }
  const minDocs = Math.min(2, docs.length);
  return [...df.entries()]
    .filter(([, d]) => d >= minDocs)
    .map(([term, d]) => {
      const count = tf.get(term)!;
      const boost = term.includes(" ") ? 1.5 : 1;
      return { term, docFrequency: d, count, score: (d / docs.length) * Math.log(1 + count) * boost };
    })
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, limit);
}
