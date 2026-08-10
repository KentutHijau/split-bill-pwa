import { describe, expect, it } from 'vitest';
import { parseReceiptText } from './parser';

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
  it('uses the item sum when subtotal is missing and marks it for review', () => {
    const r = parse('Rice 4.00\nTea 2.00\nTOTAL 6.00');
    expect(r.subtotal).toBe(600);
    expect(r.parseWarnings?.join(' ')).toMatch(/Subtotal/);
  });
  it('leaves a missing total unresolved rather than fabricating one', () => {
    const r = parse('Rice 4.00\nSubtotal 4.00');
    expect(r.grandTotal).toBe(0);
    expect(r.parseWarnings?.join(' ')).toMatch(/total was not detected/);
  });
  it('does not fabricate an item or price from broken OCR', () => {
    const r = parse('NoodIes S.OO\nGST O.45\nTOTAL S.45');
    expect(r.items).toHaveLength(0);
    expect(r.adjustments).toHaveLength(0);
    expect(r.grandTotal).toBe(0);
    expect(r.parseWarnings?.length).toBeGreaterThan(1);
  });
  it('is equivalent for LF, CRLF, CR, tabs, repeated and Unicode whitespace', () => {
    const lf = parseReceiptText('MAKAN HOUSE\nChicken Rice 5.50\nSub Total 5.50\nTOTAL 5.50');
    const noisy = parseReceiptText('MAKAN\u00a0\u2003HOUSE\r\nChicken\t  Rice  5.50\rSub\u202fTotal 5.50\r\nTOTAL 5.50');
    expect(noisy).toEqual({ ...lf, rawOcrText: noisy.rawOcrText });
  });
  it('returns stable IDs and output for identical input', () => {
    const text = 'CAFE\nTea 1,20\nGST 0,11\nTOTAL 1,31';
    expect(parseReceiptText(text)).toEqual(parseReceiptText(text));
    expect(parseReceiptText(text).items[0].id).toBe('ocr-item-1');
  });
});
