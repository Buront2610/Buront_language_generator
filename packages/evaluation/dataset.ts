import { hash } from '../core/source';
import { similarity } from '../core/evaluation';
import { outputFeatures, featureVersion } from '../core/output-features';
export type Example = { id: string; text: string; postId: string; threadId: string; family: string; quoteGroupId?: string; variantGroupId?: string; leakageGroupId?: string; sourcePostIds?: string[]; leakagePostIds?: string[] };
export function splitBeforeGeneration(examples: Example[]) {
  const parent = examples.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const unite = (a: number, b: number) => { parent[find(a)] = find(b); };
  const memberships = new Map<string, number>();
  for (let i = 0; i < examples.length; i++) {
    const example = examples[i];
    const links = Object.entries({ post: example.postId, thread: example.threadId, family: example.family,
      quote: example.quoteGroupId, variant: example.variantGroupId, leakage: example.leakageGroupId });
    links.push(...[...(example.sourcePostIds ?? []), ...(example.leakagePostIds ?? [])].map(postId => ['post', postId] as [string, string]));
    for (const [kind, value] of links) {
      if (!value) continue; const key = `${kind}:${value}`, previous = memberships.get(key);
      if (previous !== undefined) unite(i, previous); else memberships.set(key, i);
    }
    for (let j = 0; j < i; j++) if (similarity(examples[i].text, examples[j].text) >= 0.85) unite(i, j);
  }
  const groups = new Map<number, string[]>();
  examples.forEach((example, i) => { const id = find(i); groups.set(id, [...(groups.get(id) ?? []), example.id]); });
  const allocations = new Map<number, { group: string; split: string }>();
  for (const [id, members] of groups) { const group = hash(members.sort()), bucket = parseInt(group.slice(0, 8), 16) % 10; allocations.set(id, { group, split: bucket < 7 ? 'train' : bucket < 9 ? 'validation' : 'test' }); }
  return { schemaVersion: 1, sourceHash: hash(examples), method: 'connected-post-thread-quote-variant-leakage-near-duplicate-family-before-generation-v2',
    groups: groups.size, examples: examples.map((example, i) => ({ ...example, ...allocations.get(find(i))! })), frozenBeforeGeneration: true };
}
export function blindPairs(source: string, outputs: { text: string; method: string; features: Record<string, number> }[], group: string, split: string) {
  const pairs = [];
  for (let i = 0; i < outputs.length; i++) for (let j = i + 1; j < outputs.length; j++) {
    const reverse = parseInt(hash(`${group}:${i}:${j}`).slice(0, 8), 16) % 2 === 1;
    const [left, right] = reverse ? [outputs[j], outputs[i]] : [outputs[i], outputs[j]];
    pairs.push({ comparisonId: hash([source, left.text, right.text]).slice(0, 24), source, left: left.text, right: right.text,
      private: { methods: [left.method, right.method], features: [outputFeatures(left.text), outputFeatures(right.text)], featureVersion, group, split },
      dimensions: ['S', 'Q', 'C'], allowedChoices: ['left', 'right', 'tie', 'both_bad', 'cannot_judge'] });
  }
  return pairs;
}
