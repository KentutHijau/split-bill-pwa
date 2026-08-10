import { describe, expect, it } from 'vitest';
import { normalizeReceipt } from './receipt.ts';

const base = {
  merchantName: null,
  items: [],
  subtotalCents: null,
  serviceCharges: [],
  taxes: [],
  discounts: [],
  otherAdjustments: [],
  grandTotalCents: null,
  warnings: [],
};
describe('Gemini output validation', () => {
  it('rejects malformed roots', () =>
    expect(() => normalizeReceipt('bad')).toThrow('invalid_model_output'));
  it('removes malformed money and payment rows without valid item structure', () => {
    const value = normalizeReceipt({
      ...base,
      items: [
        {
          name: 'CARD VISA',
          quantity: null,
          unitPriceCents: '10.00',
          lineTotalCents: '10.00',
        },
        { name: 'Food', quantity: 1, unitPriceCents: 100, lineTotalCents: 100 },
      ],
    });
    expect(value.items).toEqual([
      { name: 'Food', quantity: 1, unitPriceCents: 100, lineTotalCents: 100 },
    ]);
    expect(value.warnings).not.toHaveLength(0);
  });
  it('deduplicates identical adjustments', () => {
    const value = normalizeReceipt({
      ...base,
      serviceCharges: [
        { label: 'Service', amountCents: 100 },
        { label: 'Service', amountCents: 100 },
      ],
    });
    expect(value.serviceCharges).toHaveLength(1);
    expect(value.warnings[0]).toContain('Duplicate');
  });
});
