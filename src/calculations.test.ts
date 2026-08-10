import { describe, expect, it } from 'vitest';
import {
  calculateBill,
  calculatedReceiptTotal,
  reconcile,
  reconcileItems,
} from './calculations';
import { allocateProportionally, parseMoney, splitEvenly } from './money';
import type { Bill, Receipt } from './types';
const receipt = (
  adjustments: Receipt['adjustments'] = [],
  total = 1001,
): Receipt => ({
  restaurantName: 'Test',
  items: [
    { id: 'food', name: 'Food', quantity: 1, unitPrice: 1001, lineTotal: 1001 },
  ],
  adjustments,
  subtotal: 1001,
  grandTotal: total,
});
const bill = (r: Receipt, claims = ['a', 'b', 'c']): Bill => ({
  id: 'x',
  createdAt: '',
  updatedAt: '',
  creatorName: 'a',
  receipt: r,
  participants: ['a', 'b', 'c'].map((id) => ({
    id,
    displayName: id,
    paymentStatus: 'UNPAID',
  })),
  allocations: claims.length
    ? [{ itemId: 'food', participantIds: claims }]
    : [],
});
describe('money', () => {
  it('parses cents without floating point arithmetic', () => {
    expect(parseMoney('S$12.34')).toBe(1234);
    expect(parseMoney('-0.01')).toBe(-1);
  });
  it('splits awkward cents deterministically', () => {
    expect(splitEvenly(1001, ['c', 'a', 'b'])).toEqual({
      a: 334,
      b: 334,
      c: 333,
    });
    expect(
      Object.values(splitEvenly(-5, ['b', 'a'])).reduce((a, b) => a + b),
    ).toBe(-5);
  });
  it('allocates proportionally using largest remainder', () => {
    const x = allocateProportionally(7, { a: 1, b: 2, c: 3 });
    expect(x).toEqual({ c: 4, b: 2, a: 1 });
    expect(Object.values(x).reduce((a, b) => a + b)).toBe(7);
  });
});
describe('receipt reconciliation', () => {
  it('includes fixed GST, service, discounts and adjustments', () => {
    const r = receipt(
      [
        { id: 's', label: 'Service', kind: 'SERVICE', amount: 100 },
        { id: 'g', label: 'GST', kind: 'TAX', amount: 99 },
        { id: 'd', label: 'Voucher', kind: 'DISCOUNT', amount: -50 },
        { id: 'o', label: 'Rounding', kind: 'OTHER', amount: 1 },
      ],
      1151,
    );
    expect(calculatedReceiptTotal(r)).toBe(1151);
    expect(reconcile(r).reconciled).toBe(true);
  });
  it('reconciles printed totals separately from detected items', () => {
    const r = receipt(
      [{ id: 's', label: 'Service', kind: 'SERVICE', amount: 100 }],
      1101,
    );
    r.subtotalSource = 'DETECTED';
    r.items[0].lineTotal = 500;
    expect(reconcile(r).reconciled).toBe(true);
    expect(reconcileItems(r)).toMatchObject({
      detectedItems: 500,
      difference: 501,
      reconciled: false,
    });
  });
  it('reports discrepancy and permits a one-cent receipt rounding tolerance', () => {
    expect(reconcile({ ...receipt(), grandTotal: 1002 })).toMatchObject({
      difference: 1,
      reconciled: true,
    });
    expect(reconcile({ ...receipt(), grandTotal: 1003 })).toMatchObject({
      difference: 2,
      reconciled: false,
    });
  });
});
describe('bill calculation', () => {
  it('handles neither GST nor service and shared item rounding', () => {
    const x = calculateBill(bill(receipt()));
    expect(x.breakdowns.map((b) => b.total)).toEqual([334, 334, 333]);
    expect(x.allocated + x.unclaimed).toBe(1001);
  });
  it('handles GST only', () => {
    const r = receipt(
      [{ id: 'g', label: 'GST', kind: 'TAX', amount: 91 }],
      1092,
    );
    const x = calculateBill(bill(r, ['a', 'b']));
    expect(x.breakdowns.map((b) => b.tax)).toEqual([46, 45, 0]);
    expect(x.allocated + x.unclaimed).toBe(1092);
  });
  it('handles service only', () => {
    const r = receipt(
      [{ id: 's', label: 'Service', kind: 'SERVICE', amount: 101 }],
      1102,
    );
    const x = calculateBill(bill(r));
    expect(x.breakdowns.reduce((s, b) => s + b.service, 0)).toBe(101);
  });
  it('allocates GST, service, voucher, and arbitrary rounding exactly', () => {
    const r = receipt(
      [
        { id: 's', label: 'Service', kind: 'SERVICE', amount: 101 },
        { id: 'g', label: 'GST', kind: 'TAX', amount: 99 },
        { id: 'd', label: 'Voucher', kind: 'DISCOUNT', amount: -137 },
        { id: 'o', label: 'Rounding', kind: 'OTHER', amount: 1 },
      ],
      1065,
    );
    const x = calculateBill(bill(r));
    expect(x.breakdowns.reduce((s, b) => s + b.total, 0) + x.unclaimed).toBe(
      1065,
    );
    expect(x.breakdowns.reduce((s, b) => s + b.discount, 0)).toBe(-137);
  });
  it('preserves unclaimed receipt value', () => {
    const x = calculateBill(bill(receipt(), []));
    expect(x.allocated).toBe(0);
    expect(x.unclaimed).toBe(1001);
    expect(x.unclaimedItems).toBe(1001);
  });
  it('gives unclaimed items their proportional share of adjustments', () => {
    const r = receipt(
      [{ id: 's', label: 'Service', kind: 'SERVICE', amount: 200 }],
      2200,
    );
    r.items.push({
      id: 'unclaimed',
      name: 'Shared dessert',
      quantity: 1,
      unitPrice: 999,
      lineTotal: 999,
    });
    r.subtotal = 2000;
    const x = calculateBill(bill(r, ['a']));
    expect(x.breakdowns[0].total).toBe(1101);
    expect(x.unclaimedItems).toBe(999);
    expect(x.unclaimedAdjustments).toBe(100);
    expect(x.unclaimed).toBe(1099);
    expect(x.allocated + x.unclaimed).toBe(2200);
  });
  it('weights receipt charges by allocated item subtotal across multiple items', () => {
    const r = receipt(
      [{ id: 'g', label: 'GST', kind: 'TAX', amount: 101 }],
      2101,
    );
    r.items.push({
      id: 'drink',
      name: 'Drink',
      quantity: 1,
      unitPrice: 999,
      lineTotal: 999,
    });
    r.subtotal = 2000;
    const b = bill(r, ['a']);
    b.allocations.push({ itemId: 'drink', participantIds: ['b'] });
    const x = calculateBill(b);
    expect(x.breakdowns.reduce((s, v) => s + v.total, 0)).toBe(2101);
    expect(x.breakdowns[0].tax).toBe(51);
    expect(x.breakdowns[1].tax).toBe(50);
  });
});
