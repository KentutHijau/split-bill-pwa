import { describe, expect, it } from 'vitest';
import { parseReceiptText } from './parser';
import desktopFixture from './test-fixtures/receipt-desktop.txt?raw';
import mobileFixture from './test-fixtures/receipt-mobile.txt?raw';

const parse = (body: string) => parseReceiptText(`MAKAN HOUSE\n${body}`);
describe('Singapore OCR receipt parser', () => {
  it('reads explicit GST and service charge', () => {
    const r = parse(
      '2 x Laksa 20.00\nSubtotal 20.00\n10% Service Charge 2.00\nGST 9% 1.98\nGrand Total 23.98',
    );
    expect(r.items[0]).toMatchObject({
      name: 'Laksa',
      quantity: 2,
      unitPrice: 1000,
    });
    expect(r.adjustments.map((a) => [a.kind, a.amount])).toEqual([
      ['SERVICE', 200],
      ['TAX', 198],
    ]);
    expect(r.grandTotal).toBe(2398);
  });
  it.each([
    [
      'GST only',
      'Rice 10.00\nSub Total 10.00\nTax 0.90\nAmount Due 10.90',
      ['TAX'],
    ],
    ['service only', 'Rice 10.00\nService Chg 1.00\nTOTAL 11.00', ['SERVICE']],
    ['neither / tax inclusive', 'Rice 10.00\nTOTAL 10.00', []],
  ])('%s', (_name, text, kinds) =>
    expect(parse(text).adjustments.map((a) => a.kind)).toEqual(kinds),
  );
  it.each([
    ['Discount', 'Discount 2.00', -200, 'DISCOUNT'],
    ['Voucher', 'Voucher $5.00', -500, 'DISCOUNT'],
    ['Promo', 'Promo -1.25', -125, 'DISCOUNT'],
    ['Round Adj', 'Round Adj -0.02', -2, 'OTHER'],
  ])('reads %s as an explicit adjustment', (_label, line, amount, kind) => {
    expect(
      parse(`Noodles 12.00\n${line}\nGrand Total 10.00`).adjustments[0],
    ).toMatchObject({ amount, kind });
  });
  it('normalizes noisy whitespace, malformed spacing, dollarless decimals and comma OCR', () => {
    const r = parse(
      '  Chicken    Rice ....  5.50  \nTea $ 1,20\nSub   Total 6.70\nTOTAL 6.70',
    );
    expect(r.items.map((i) => i.lineTotal)).toEqual([550, 120]);
    expect(r.subtotal).toBe(670);
  });
  it('rejects dates, times and reference-like numbers as items', () => {
    const r = parse(
      'Date 10/08/2026 12.00\nTime 18:45 18.45\nTel 61234567 67.00\nReceipt No 1234 12.34\nCard 1234 56.78\nFish Soup 8.00\nTOTAL 8.00',
    );
    expect(r.items.map((i) => i.name)).toEqual(['Fish Soup']);
  });
  it('keeps a missing printed subtotal distinct from the item sum', () => {
    const r = parse('Rice 4.00\nTea 2.00\nTOTAL 6.00');
    expect(r.subtotal).toBeNull();
    expect(r.items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0)).toBe(
      600,
    );
    expect(r.parseWarnings?.join(' ')).toMatch(/subtotal/i);
  });
  it.each([
    ['desktop', desktopFixture],
    ['mobile', mobileFixture],
  ])('parses the sanitized real %s OCR fixture', (_device, fixture) => {
    const r = parseReceiptText(fixture);
    expect(r.subtotal).toBe(4420);
    expect(r.subtotalSource).toBe('DETECTED');
    expect(r.adjustments.map((a) => [a.kind, a.amount])).toEqual([
      ['SERVICE', 442],
      ['TAX', 438],
    ]);
    expect(r.grandTotal).toBe(5300);
    if (_device === 'desktop') {
      expect(r.items.map((item) => [item.name, item.lineTotal])).toEqual([
        ['Vegetable Omelet Curry', 1650],
        ['Cheese', 200],
        ['Fried Chicken (3pcs)', 270],
        ['Creamed Chicken Omelet Curry', 1650],
        ['Tuna', 150],
        ['Beef Yakiniku', 500],
      ]);
      expect(r.modifiers?.map((modifier) => modifier.text)).toEqual([
        'Mild',
        'Standard',
      ]);
    }
    expect(r.items.some((item) => /Service Charges/i.test(item.name))).toBe(
      false,
    );
  });
  it.each([
    'Subtotal 44.20',
    'Sub Total 44.20',
    'SUB TOTAL 44.20',
    'Sub-Total 44.20',
    'sub total : 44.20 “-',
  ])('recognizes subtotal variant: %s', (line) => {
    expect(parse(`${line}\nGrand Total 44.20`).subtotal).toBe(4420);
  });
  it('prefers grand total and ignores a later card payment amount', () => {
    const r = parse(
      'Rice 10.00\nSubtotal 10.00\nTotal 11.00\nGrand Total 12.00 ©\nMaster Card **** 99.00',
    );
    expect(r.grandTotal).toBe(1200);
    expect(r.items.map((item) => item.name)).toEqual(['Rice']);
  });
  it.each([
    ['Grand Total 53.00 bug', 5300],
    ['Grand Total 53.00 !!!©', 5300],
  ])('accepts harmless noise after an explicit amount: %s', (line, amount) => {
    expect(parse(`${line}\nMaster Card:#¥¥¥5034 53.00`).grandTotal).toBe(
      amount,
    );
  });
  it('keeps explicit Grand Total ahead of generic and payment amounts', () => {
    const r = parse(
      'Total 52.00\nGrand Total 53.00 bug\nMaster Card:#¥¥¥5034 53.00',
    );
    expect(r.grandTotal).toBe(5300);
    expect(r.items).toHaveLength(0);
  });
  it('preserves a structurally identified item with an unresolved OCR price', () => {
    const r = parseReceiptText(
      '£000 TCHIBANYA THE STAR VISTA ...\nQTY ITEM NAME AMOUNT\nVegetable Omelet Curry S.OO\n1 **Cheese 2.00\n1 **Fried Chicken 2.70\n1 Creamed Chicken Omelet Curry 16.50\n1 **Tuna 1.50\n1 **Beef Yakiniku 5.00\nSub Total 44.20\nService Charges 4.42\nGST 4.38\nGrand Total 53.00 bug\nMaster Card:#¥¥¥5034 53.00',
    );
    expect(r.restaurantName).toBe('TCHIBANYA THE STAR VISTA');
    expect(r.items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0)).toBe(
      2770,
    );
    expect(
      r.items.find((item) => item.name === 'Vegetable Omelet Curry'),
    ).toMatchObject({ unitPrice: null, lineTotal: null });
    expect(r.items.some((item) => item.name === 'Service Charges')).toBe(false);
    expect(r.possibleMissedLines).toEqual([]);
    expect(r).toMatchObject({ subtotal: 4420, grandTotal: 5300 });
  });
  it.each(['Service Charges', 'Service Chgs', 'Svc Charges', 'Svc Chgs'])(
    'classifies plural service label %s before items',
    (label) => {
      const r = parse(
        `Rice 10.00\nSubtotal 10.00\n${label} 10% 1.00\nGrand Total 11.00`,
      );
      expect(r.adjustments[0]).toMatchObject({ kind: 'SERVICE', amount: 100 });
      expect(r.items.some((item) => item.name.includes(label))).toBe(false);
    },
  );
  it('does not infer a service amount from percentage alone', () => {
    expect(
      parse('Rice 10.00\nService Charge 10%\nTotal 10.00').adjustments,
    ).toHaveLength(0);
  });
  it('reads quantity items with decoration, meaningful parentheses, and modest leading garbage', () => {
    const r = parse(
      '1 *¥Fried Chicken (3pcs) 2.70\n7 1 Beef Yakiniku 5.00 |\nSubtotal 7.70\nTotal 7.70',
    );
    expect(r.items).toMatchObject([
      { name: 'Fried Chicken (3pcs)', quantity: 1, lineTotal: 270 },
      { name: 'Beef Yakiniku', quantity: 1, lineTotal: 500 },
    ]);
  });
  it('leaves a missing total unresolved rather than fabricating one', () => {
    const r = parse('Rice 4.00\nSubtotal 4.00');
    expect(r.grandTotal).toBeNull();
    expect(r.parseWarnings?.join(' ')).toMatch(/total was not detected/);
  });
  it('does not fabricate an item or price from broken OCR', () => {
    const r = parse('NoodIes S.OO\nGST O.45\nTOTAL S.45');
    expect(r.items).toHaveLength(0);
    expect(r.adjustments).toHaveLength(0);
    expect(r.grandTotal).toBeNull();
    expect(r.parseWarnings?.length).toBeGreaterThan(1);
  });
  it('is equivalent for LF, CRLF, CR, tabs, repeated and Unicode whitespace', () => {
    const lf = parseReceiptText(
      'MAKAN HOUSE\nChicken Rice 5.50\nSub Total 5.50\nTOTAL 5.50',
    );
    const noisy = parseReceiptText(
      'MAKAN\u00a0\u2003HOUSE\r\nChicken\t  Rice  5.50\rSub\u202fTotal 5.50\r\nTOTAL 5.50',
    );
    expect(noisy).toEqual({ ...lf, rawOcrText: noisy.rawOcrText });
  });
  it('returns stable IDs and output for identical input', () => {
    const text = 'CAFE\nTea 1,20\nGST 0,11\nTOTAL 1,31';
    expect(parseReceiptText(text)).toEqual(parseReceiptText(text));
    expect(parseReceiptText(text).items[0].id).toBe('ocr-item-1');
  });
  it('keeps decorated unpriced options as modifier metadata', () => {
    const r = parse(
      'QTY ITEM NAME AMOUNT\n1 Curry 10.00\n**Mild\n1 Pasta 12.00\n**Standard\nSub Total 22.00\nGrand Total 22.00',
    );
    expect(r.items.map((item) => item.name)).toEqual(['Curry', 'Pasta']);
    expect(r.modifiers).toEqual([
      { text: 'Mild', itemId: 'ocr-item-1' },
      { text: 'Standard', itemId: 'ocr-item-2' },
    ]);
  });
});
