import { normalizeSearch } from './normalize.ts';

/** A query word and the catalog words it may be a misspelling of. */
export type RankWord = { word: string; alts: readonly string[] };
export type RankTerms = { text: string; words: readonly RankWord[] };

/**
 * How well a name (a category's, a brand's) matches a query, for ordering the cards of a search:
 * 0 = the name is the query · 1 = it starts with it · 2 = a word of it starts with the first query word · 3 = it contains every word
 * (or a spelling correction of it) somewhere. null = it does not match. Pure: the same normalisation as the products' search.
 */
export function matchRank(name: string, t: RankTerms): number | null {
  const n = normalizeSearch(name);
  if (!t.words.length || !t.words.every((w) => [w.word, ...w.alts].some((x) => n.includes(x)))) return null;
  if (n === t.text) return 0;
  const first = t.words[0];
  const starts = first ? [first.word, ...first.alts] : [];
  // starts with the query (for a one-word query: or with its correction)
  if (n.startsWith(t.text) || (t.words.length === 1 && starts.some((x) => n.startsWith(x)))) return 1;
  return n.split(' ').some((w) => starts.some((x) => w.startsWith(x))) ? 2 : 3;
}
