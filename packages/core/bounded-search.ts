import fs from 'node:fs';
import path from 'node:path';
import MiniSearch from 'minisearch';

type RawResult = { score: number; terms: string[]; match: Record<string, string[]> };
type RawResults = Map<number, RawResult>;
type ExactOptions = { prefix?: boolean; filter?: unknown; tokenize?: (query: string) => string[]; processTerm?: (term: string) => string };
type Executor = { executeQuery: (query: string, options?: ExactOptions) => RawResults };
const cacheTerms = 32, cachePostings = 20000;
let checkedVersion = false;

/** Exact OR retrieval, with bounded intermediate memory.
 *
 * MiniSearch 7.2.0's string-query executor creates every term's posting result
 * before reducing them, even when a long query repeats a handful of terms.
 * Stream those same results in the same order instead. Repeated scores are
 * added (not multiplied), preserving floating-point scores, ties, and order.
 *
 * This adapter intentionally relies on that pinned version's private raw-query
 * entry point. Public per-term search sorts results before exposing them, which
 * would change ties. Fail explicitly on a version/surface/options mismatch;
 * do not approximate, truncate queries, or silently return unbounded execution.
 * Native full ordered-result equality tests must pass before a version update.
 */
export function boundedExactSearch<T>(fields: string[], tokenize: (query: string) => string[]): MiniSearch<T> {
  if (!checkedVersion) {
    const manifest = path.resolve(path.dirname(require.resolve('minisearch')), '../../package.json');
    if (JSON.parse(fs.readFileSync(manifest, 'utf8')).version !== '7.2.0') throw new Error('UNSUPPORTED_MINISEARCH_VERSION');
    checkedVersion = true;
  }
  const index = new MiniSearch<T>({ fields, storeFields: ['series'], tokenize });
  const executor = index as unknown as Executor, execute = executor.executeQuery;
  if (typeof execute !== 'function') throw new Error('UNSUPPORTED_MINISEARCH_EXECUTOR');
  const processTerm = MiniSearch.getDefault('processTerm') as (term: string) => string;
  executor.executeQuery = (query, options = {}) => {
    if (typeof query !== 'string' || Object.keys(options).some(key => key !== 'prefix' && key !== 'filter') || options.prefix !== undefined && options.prefix !== false) throw new Error('UNSUPPORTED_EXACT_SEARCH_OPTIONS');
    const terms = tokenize(query).flatMap(processTerm).filter(Boolean);
    const result: RawResults = new Map(), cached = new Map<string, RawResults>();
    let postings = 0;
    for (const term of terms) {
      let next = cached.get(term);
      if (!next) {
        // Tokenization and processing were already applied to the complete
        // query. Reusing its processed token avoids resegmenting single terms.
        next = execute.call(index, '', { ...options, tokenize: () => [term], processTerm: value => value });
        if (!(next instanceof Map)) throw new Error('UNSUPPORTED_MINISEARCH_RESULTS');
        if (cached.size < cacheTerms && postings + next.size <= cachePostings) { cached.set(term, next); postings += next.size; }
      }
      for (const [id, value] of next) {
        const existing = result.get(id);
        if (!existing) result.set(id, { score: value.score, terms: [...value.terms], match: Object.fromEntries(Object.entries(value.match).map(([key, fields]) => [key, [...fields]])) });
        else {
          existing.score = existing.score + value.score;
          for (const [key, fields] of Object.entries(value.match)) existing.match[key] = [...fields];
          for (const term of value.terms) if (!existing.terms.includes(term)) existing.terms.push(term);
        }
      }
    }
    return result;
  };
  return index;
}
