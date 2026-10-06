import { createHash } from 'node:crypto';
import type { SourceDocument, Span, ProtectedValue } from '../contracts';
import { quantities, protectedValueRole } from './quantities';
export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
// BMP strings already use identical scalar/UTF-16 offsets. Avoid rebuilding a
// complete scalar array for every small edit/validation slice of long Japanese
// input. Astral input retains the exact scalar-array behavior.
export const slice = (text: string, span: Span) => /[\uD800-\uDBFF]/.test(text) ? [...text].slice(span.start, span.end).join('') : text.slice(span.start, span.end);
export const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
export function sourceDocument(raw: string): SourceDocument {
  if (!raw.isWellFormed() || !raw.trim() || [...raw].length > 5000) throw new Error('INVALID_SOURCE');
  const scalarToUtf16 = [0];
  for (const char of raw) scalarToUtf16.push(scalarToUtf16.at(-1)! + char.length);
  const utf16ToScalar = new Map(scalarToUtf16.map((position, i) => [position, i]));
  const normalizationMap: Span[] = [];
  let normalized = '';
  // Normalize grapheme clusters together, including combining marks and halfwidth kana.
  for (const segment of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(raw)) {
    const value = segment.segment.normalize('NFKC');
    const span = { start: utf16ToScalar.get(segment.index)!, end: utf16ToScalar.get(segment.index + segment.segment.length)! };
    normalized += value;
    for (const _ of value) normalizationMap.push(span);
  }
  const protectedValues = extractProtectedValues(raw, utf16ToScalar);
  const opaqueSpans: Span[] = [];
  for (const match of raw.matchAll(/「[^」]*」|『[^』]*』|"[^"\n]*"/gu)) opaqueSpans.push({ start: utf16ToScalar.get(match.index!)!, end: utf16ToScalar.get(match.index! + match[0].length)! });
  const document = { raw, inputHash: hash(raw), scalarToUtf16, normalized, normalizationMap, protectedValues, opaqueSpans };
  const freeze = (value: any): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(document); return document;
}

// The same literal extractor is used independently for input and rendered output.
// Output can grow beyond the input's 5,000-scalar admission limit, but never
// beyond the 12,000-scalar candidate contract. Do not construct an input document
// from output: that conflates two different bounds and falsely fails V-quantity.
function extractProtectedValues(raw: string, utf16ToScalar: Map<number, number>): ProtectedValue[] {
  const protectedValues: ProtectedValue[] = [];
  const patterns: [string, RegExp][] = [
    ['url', /https?:\/\/[^\s「」『』<>。]+/gu], ['email', /[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}/gu],
    ['anchor', /(?:>>|＞＞)\s*[0-9０-９]+/gu],
    ['identifier', /(?<![0-9０-９A-Za-zＡ-Ｚａ-ｚ])[A-Za-zＡ-Ｚａ-ｚ][A-Za-zＡ-Ｚａ-ｚ0-9０-９_-]*/gu],
    ['unsupported_numeral', /[一二三四五六七八九十百千万億兆]+(?:円|個|人|件|台|回)/gu],
  ];
  for (const [kind, pattern] of patterns) for (const match of raw.matchAll(pattern)) {
    const span = { start: utf16ToScalar.get(match.index!)!, end: utf16ToScalar.get(match.index! + match[0].length)! };
    if (protectedValues.some(value => overlaps(value.span, span))) continue;
    const suffix = raw.slice(match.index! + match[0].length);
    const role = protectedValueRole(suffix);
    protectedValues.push({ id: `pv-${span.start}`, kind, raw: match[0], span, role });
  }
  const existing = [...protectedValues];
  const parsedQuantities = quantities(raw, (start, end) => ({ start: utf16ToScalar.get(start)!, end: utf16ToScalar.get(end)! }));
  const excluded = new Set(parsedQuantities.filter(value => existing.some(other => overlaps(other.span, value.span))).map(value => value.id));
  protectedValues.push(...parsedQuantities.filter(value => !excluded.has(value.id) && (!value.parentId || !excluded.has(value.parentId))));
  return protectedValues.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
}
export function outputProtectedValues(raw: string): ProtectedValue[] {
  if (!raw.isWellFormed() || !raw.trim()) throw new Error('INVALID_OUTPUT');
  const utf16ToScalar = new Map<number, number>([[0, 0]]);
  let scalar = 0, offset = 0;
  for (const char of raw) {
    if (++scalar > 12000) throw new Error('INVALID_OUTPUT');
    offset += char.length; utf16ToScalar.set(offset, scalar);
  }
  return extractProtectedValues(raw, utf16ToScalar);
}
