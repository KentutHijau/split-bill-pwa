import type { Cents } from './types';
export const parseMoney = (value: string): Cents => {
  const clean = value.replace(/[^0-9.-]/g, '');
  if (!/^-?\d*(\.\d{0,2})?$/.test(clean) || clean === '' || clean === '-')
    throw new Error('Enter a valid amount');
  const negative = clean.startsWith('-');
  const [whole = '0', fraction = ''] = clean.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
};
export const formatMoney = (cents: Cents, currency = 'SGD') =>
  new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  })
    .format(cents / 100)
    .replace('$', 'S$');
export const splitEvenly = (
  cents: Cents,
  ids: string[],
): Record<string, Cents> => {
  if (!ids.length) return {};
  const ordered = [...ids].sort();
  const sign = Math.sign(cents) || 1,
    absolute = Math.abs(cents),
    base = Math.floor(absolute / ordered.length),
    remainder = absolute % ordered.length;
  return Object.fromEntries(
    ordered.map((id, i) => [id, sign * (base + (i < remainder ? 1 : 0))]),
  );
};
export const allocateProportionally = (
  amount: Cents,
  weights: Record<string, Cents>,
): Record<string, Cents> => {
  const ids = Object.keys(weights).sort(),
    total = ids.reduce((s, id) => s + Math.max(0, weights[id]), 0);
  if (!ids.length || total === 0) return {};
  const sign = Math.sign(amount) || 1,
    absolute = Math.abs(amount);
  const rows = ids.map((id) => {
    const raw = (absolute * Math.max(0, weights[id])) / total;
    return { id, value: Math.floor(raw), fraction: raw - Math.floor(raw) };
  });
  let left = absolute - rows.reduce((s, r) => s + r.value, 0);
  rows.sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
  for (let i = 0; i < left; i++) rows[i].value++;
  return Object.fromEntries(rows.map((r) => [r.id, r.value * sign]));
};
