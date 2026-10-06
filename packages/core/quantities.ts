import type { ProtectedValue, Span } from '../contracts';

// Decimal spelling is retained. No conversion to a JS number, unit conversion,
// or inference from an unrecognized Japanese numeral is performed here.
const number = '[+＋\\-－−]?[0-9０-９]+(?:[,，][0-9０-９]{3})*(?:[.．][0-9０-９]+)?';
const unit = '(?:時間|か月|ヶ月|[%％円年月日時分秒個枚人回点件歳台度℃]|kg|km|cm|mm)?';
const atom = `${number}${unit}`;
const comparator: Record<string, NonNullable<ProtectedValue['comparator']>> = { '以上': 'ge', '以下': 'le', '未満': 'lt', '超': 'gt', '>': 'gt', '<': 'lt', '>=': 'ge', '<=': 'le', '≧': 'ge', '≦': 'le', '≥': 'ge', '≤': 'le' };
// A terminal polite copula is not the case particle で. Require a closing
// boundary: e.g. 500円ですしを買う can instead contain で + すし and must
// retain the conservative particle observation. This is a literal role cue,
// not a general grammatical analysis or permission to rewrite a value.
export function protectedValueRole(suffix: string): string {
  if (/^で(?:す|した)(?=[。！？!?」』\s]|$)/u.test(suffix)) return 'unknown';
  return /^(から|より|を|に|が|は|で)/u.exec(suffix)?.[1] ?? 'unknown';
}
export function quantities(raw: string, toSpan: (start: number, end: number) => Span): ProtectedValue[] {
  const pattern = new RegExp(`(?:[<>＜＞]=?|[≧≦≥≤])?${atom}(?:[〜～~]${atom})?(?:以上|以下|未満|超)?`, 'gu');
  const values: ProtectedValue[] = [];
  for (const match of raw.matchAll(pattern)) {
    const span = toSpan(match.index!, match.index! + match[0].length), normalized = match[0].normalize('NFKC').replaceAll('−', '-');
    const prefix = /^(>=|<=|>|<|≧|≦|≥|≤)/u.exec(normalized)?.[1];
    const suffix = /(以上|以下|未満|超)$/u.exec(normalized)?.[1];
    const role = protectedValueRole(raw.slice(match.index! + match[0].length));
    const parts = [...match[0].matchAll(new RegExp(atom, 'gu'))];
    const parse = (text: string) => {
      const value = /^([+-]?)([0-9,]+(?:\.[0-9]+)?)(.*)$/u.exec(text.normalize('NFKC').replaceAll('−', '-'))!;
      return { sign: value[1] || '+', decimal: value[2].replaceAll(',', ''), unit: value[3] };
    };
    if (parts.length === 2) {
      const id = `pv-${span.start}-range`;
      values.push({ id, kind: 'quantity_range', raw: match[0], span, role });
      for (const [index, part] of parts.entries()) {
        const childSpan = toSpan(match.index! + part.index!, match.index! + part.index! + part[0].length);
        values.push({ id: `pv-${childSpan.start}`, kind: 'quantity', raw: part[0], span: childSpan, role: index === 0 ? 'range_start' : 'range_end', parentId: id, ...parse(part[0]), comparator: 'eq' });
      }
    } else {
      const value = parse(parts[0][0]);
      values.push({ id: `pv-${span.start}`, kind: 'quantity', raw: match[0], span, role, ...value, comparator: comparator[prefix ?? suffix ?? ''] ?? 'eq' });
    }
  }
  return values;
}
