import { allocateProportionally, splitEvenly } from './money';
import type { Bill, Cents, ParticipantBreakdown, Receipt } from './types';
export const calculatedReceiptTotal = (r: Receipt): Cents =>
  r.items.reduce((s, i) => s + i.lineTotal, 0) +
  r.adjustments.reduce((s, a) => s + a.amount, 0);
export const reconcile = (r: Receipt) => {
  const calculated = calculatedReceiptTotal(r);
  return {
    calculated,
    difference: r.grandTotal - calculated,
    reconciled: Math.abs(r.grandTotal - calculated) <= 1,
  };
};
export function calculateBill(bill: Bill) {
  const unclaimedId = '__unclaimed__';
  const ids = bill.participants.map((p) => p.id);
  const itemShares = Object.fromEntries(ids.map((id) => [id, 0])) as Record<
    string,
    Cents
  >;
  let unclaimedItems = 0;
  for (const item of bill.receipt.items) {
    const claims =
      bill.allocations.find((a) => a.itemId === item.id)?.participantIds ?? [];
    if (!claims.length) unclaimedItems += item.lineTotal;
    else
      for (const [id, value] of Object.entries(
        splitEvenly(item.lineTotal, claims),
      ))
        itemShares[id] = (itemShares[id] ?? 0) + value;
  }
  const adjustmentWeights = { ...itemShares, [unclaimedId]: unclaimedItems };
  const itemTotal = Object.values(adjustmentWeights).reduce((a, v) => a + v, 0);
  const categories = {
    service: Object.fromEntries(ids.map((id) => [id, 0])),
    tax: Object.fromEntries(ids.map((id) => [id, 0])),
    discount: Object.fromEntries(ids.map((id) => [id, 0])),
    other: Object.fromEntries(ids.map((id) => [id, 0])),
  } as Record<string, Record<string, Cents>>;
  let unclaimedAdjustments = 0;
  for (const adjustment of bill.receipt.adjustments) {
    if (itemTotal === 0) {
      unclaimedAdjustments += adjustment.amount;
      continue;
    }
    const shares = allocateProportionally(adjustment.amount, adjustmentWeights);
    unclaimedAdjustments += shares[unclaimedId] ?? 0;
    const key =
      adjustment.kind === 'SERVICE'
        ? 'service'
        : adjustment.kind === 'TAX'
          ? 'tax'
          : adjustment.kind === 'DISCOUNT'
            ? 'discount'
            : 'other';
    for (const id of ids) categories[key][id] += shares[id] ?? 0;
  }
  const breakdowns: ParticipantBreakdown[] = ids.map((participantId) => ({
    participantId,
    itemSubtotal: itemShares[participantId],
    service: categories.service[participantId],
    tax: categories.tax[participantId],
    discount: categories.discount[participantId],
    other: categories.other[participantId],
    total:
      itemShares[participantId] +
      categories.service[participantId] +
      categories.tax[participantId] +
      categories.discount[participantId] +
      categories.other[participantId],
  }));
  const allocated = breakdowns.reduce((s, b) => s + b.total, 0);
  return {
    breakdowns,
    allocated,
    unclaimed: bill.receipt.grandTotal - allocated,
    unclaimedItems,
    unclaimedAdjustments,
  };
}
