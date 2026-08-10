import { demos } from './demos';
import type { AdjustmentKind, Receipt } from './types';
export type OcrStage = 'preparing' | 'reading' | 'understanding' | 'checking';
export interface ParseProgress {
  stage: OcrStage;
  progress?: number;
}
export interface ReceiptParser {
  parse(
    image: Blob,
    onProgress?: (update: ParseProgress) => void,
  ): Promise<Receipt>;
}
export class DemoReceiptParser implements ReceiptParser {
  async parse() {
    return structuredClone(demos[0]);
  }
}

const id = (kind: string, index: number) => `ocr-${kind}-${index + 1}`;
// The final monetary value may be followed by harmless OCR glyphs, but not words.
const amountAtEnd =
  /(?:S?\$\s*)?(-?\s*\d{1,5}[.,]\d{2})(?=\s*[^\p{L}\p{N}]*$)/iu;
const normalizeAmount = (value: string) =>
  Math.round(Number(value.replace(/\s/g, '').replace(',', '.')) * 100);
const metaLine =
  /(?:date|time|tel|phone|receipt|invoice|table|queue|transaction|trans\b|card|visa|master|approval|auth|reference|ref\b|gst\s*(?:reg|no)|postal|postcode|member|loyalty|points|reward|tender|cash|change|cashier|pax|dine\s*in|thank\s*you|please\s*come|address|shift)/i;
const subtotalLabel = /\bsub\s*[-–—]?\s*total\b/i;
const explicitTotalLabel = /\bgrand\s*total\b/i;
const genericTotalLabel =
  /\b(?:amount\s*(?:due|payable)|total\s*due|net\s*total)\b|^\s*[^\p{L}\p{N}]*total\b/iu;
const adjustmentRules: Array<[RegExp, AdjustmentKind]> = [
  [/\b(?:(?:service|svc)\s*(?:charge|chg)s?)\b/i, 'SERVICE'],
  [/\b(?:gst|tax)\b/i, 'TAX'],
  [/\b(?:discount|disc\b|voucher|promo)\b/i, 'DISCOUNT'],
  [/\b(?:rounding|round\s*adj(?:ustment)?)\b/i, 'OTHER'],
];

/** Deterministic precedence: summary/adjustment, metadata/payment, item, ignore. */
export function parseReceiptText(rawText: string): Receipt {
  const lines = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(
          /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g,
          ' ',
        )
        .trim(),
    )
    .filter(Boolean);
  const receipt: Receipt = {
    restaurantName: '',
    items: [],
    adjustments: [],
    subtotal: 0,
    grandTotal: 0,
    rawOcrText: rawText,
    parseWarnings: [],
  };
  const structural = new Set<number>();
  let foundTotal = false;
  let foundExplicitTotal = false;

  // Summary classification happens first and claims a line permanently.
  lines.forEach((line, index) => {
    const match = line.match(amountAtEnd);
    const amount = match ? normalizeAmount(match[1]) : undefined;
    if (subtotalLabel.test(line)) {
      structural.add(index);
      if (amount !== undefined) {
        receipt.subtotal = amount;
        receipt.subtotalSource = 'DETECTED';
      } else
        receipt.parseWarnings!.push(`Could not read an amount for: ${line}`);
      return;
    }
    const adjustment = adjustmentRules.find(([pattern]) => pattern.test(line));
    if (adjustment) {
      structural.add(index);
      if (amount !== undefined) {
        const kind = adjustment[1];
        receipt.adjustments.push({
          id: id('adjustment', receipt.adjustments.length),
          label: line.slice(0, match?.index).trim(),
          kind,
          amount: kind === 'DISCOUNT' && amount > 0 ? -amount : amount,
        });
      } else
        receipt.parseWarnings!.push(`Could not read an amount for: ${line}`);
      return;
    }
    const explicit = explicitTotalLabel.test(line);
    const generic = genericTotalLabel.test(line) && !subtotalLabel.test(line);
    if (explicit || generic) {
      structural.add(index);
      if (amount !== undefined && (explicit || !foundExplicitTotal)) {
        receipt.grandTotal = amount;
        foundTotal = true;
        if (explicit) foundExplicitTotal = true;
      }
    }
  });

  receipt.restaurantName =
    lines.find(
      (line, index) =>
        index < 6 &&
        !structural.has(index) &&
        !metaLine.test(line) &&
        !amountAtEnd.test(line) &&
        /[A-Za-z]{2}/.test(line),
    ) ?? '';

  lines.forEach((line, index) => {
    if (structural.has(index) || metaLine.test(line)) return;
    const match = line.match(amountAtEnd);
    if (!match) return;
    let description = line
      .slice(0, match.index)
      .replace(/[.·\-\s]+$/, '')
      .trim();
    if (!/[A-Za-z]{2}/.test(description)) return;
    let quantity = 1;
    // Prefer a quantity at the start; permit one short numeric OCR fragment before it.
    const quantityMatch = description.match(
      /^(?:(?:\d{1,2}|[^\p{L}\p{N}]{1,3})\s+)?(\d{1,2})(?:\s*[xX])?\s+(.+)$/u,
    );
    if (quantityMatch) {
      quantity = Number(quantityMatch[1]);
      description = quantityMatch[2];
    }
    description = description.replace(/^[*¥￥|~^`'"“”]+\s*/, '').trim();
    if (!/[A-Za-z]{2}/.test(description) || quantity < 1 || quantity > 99)
      return;
    const lineTotal = normalizeAmount(match[1]);
    if (!Number.isFinite(lineTotal) || lineTotal < 0) return;
    const unitPrice =
      lineTotal % quantity === 0 ? lineTotal / quantity : lineTotal;
    receipt.items.push({
      id: id('item', receipt.items.length),
      name: description,
      quantity,
      unitPrice,
      lineTotal,
    });
    if (lineTotal % quantity !== 0)
      receipt.parseWarnings!.push(
        `Check quantity and unit price for: ${description}`,
      );
  });
  const itemSum = receipt.items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!receipt.subtotalSource)
    receipt.parseWarnings!.push('Receipt subtotal was not detected.');
  else if (Math.abs(itemSum - receipt.subtotal) > 1)
    receipt.parseWarnings!.push(
      `Detected items total S$${(itemSum / 100).toFixed(2)} but receipt subtotal is S$${(receipt.subtotal / 100).toFixed(2)}. One or more items may be missing.`,
    );
  if (!foundTotal)
    receipt.parseWarnings!.push('Receipt total was not detected.');
  if (!receipt.restaurantName)
    receipt.parseWarnings!.push('Merchant name was not confidently detected.');
  if (!receipt.items.length)
    receipt.parseWarnings!.push('No item lines were confidently detected.');
  return receipt;
}
