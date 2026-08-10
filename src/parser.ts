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
const amountAtEnd = /(?:S?\$\s*)?(-?\s*\d{1,5}[.,]\d{2})\s*$/i;
const normalizeAmount = (value: string) => {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  return Math.round(Number(normalized) * 100);
};
const metaLine =
  /(?:date|time|tel|phone|receipt|invoice|table|queue|transaction|trans\b|card|visa|master|approval|auth|reference|ref\b|gst\s*(?:reg|no)|postal|postcode|member|loyalty|points|tender|cash|change)/i;
const subtotalLabel = /\bsub\s*total\b/i;
const totalLabel =
  /\b(?:grand\s*total|amount\s*due|net\s*total|total\s*due)\b|^\s*total\b/i;
const adjustmentRules: Array<[RegExp, AdjustmentKind]> = [
  [/\b(?:service\s*(?:charge|chg)|svc\s*(?:charge|chg))\b/i, 'SERVICE'],
  [/\b(?:gst|tax)\b/i, 'TAX'],
  [/\b(?:discount|disc\b|voucher|promo)\b/i, 'DISCOUNT'],
  [/\b(?:rounding|round\s*adj(?:ustment)?)\b/i, 'OTHER'],
];

/** Deterministic, conservative conversion of OCR text into editable receipt data. */
export function parseReceiptText(rawText: string): Receipt {
  const lines = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g, ' ').trim())
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
  let foundSubtotal = false;
  let foundTotal = false;

  lines.forEach((line, index) => {
    const match = line.match(amountAtEnd);
    const amount = match ? normalizeAmount(match[1]) : undefined;
    if (subtotalLabel.test(line)) {
      structural.add(index);
      if (amount !== undefined) {
        receipt.subtotal = amount;
        foundSubtotal = true;
      }
      return;
    }
    const adjustment = adjustmentRules.find(([pattern]) => pattern.test(line));
    if (adjustment) {
      structural.add(index);
      if (amount !== undefined) {
        const kind = adjustment[1];
        const negative = kind === 'DISCOUNT' && amount > 0 ? -amount : amount;
        receipt.adjustments.push({
          id: id('adjustment', receipt.adjustments.length),
          label: line.slice(0, match?.index).trim(),
          kind,
          amount: negative,
        });
      } else
        receipt.parseWarnings!.push(`Could not read an amount for: ${line}`);
      return;
    }
    if (totalLabel.test(line) && !subtotalLabel.test(line)) {
      structural.add(index);
      if (amount !== undefined) {
        receipt.grandTotal = amount;
        foundTotal = true;
      }
    }
  });

  const firstCandidate = lines.find(
    (line, index) =>
      index < 6 &&
      !structural.has(index) &&
      !metaLine.test(line) &&
      !amountAtEnd.test(line) &&
      /[A-Za-z]{2}/.test(line),
  );
  receipt.restaurantName = firstCandidate ?? '';

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
    const quantityMatch = description.match(/^(\d{1,2})\s*[xX]\s+(.+)$/);
    if (quantityMatch) {
      quantity = Number(quantityMatch[1]);
      description = quantityMatch[2];
    }
    const lineTotal = normalizeAmount(match[1]);
    if (!Number.isFinite(lineTotal) || lineTotal < 0 || quantity < 1) return;
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
  if (!foundSubtotal) {
    receipt.subtotal = itemSum;
    receipt.parseWarnings!.push(
      'Subtotal was not detected; item sum is shown.',
    );
  }
  if (!foundTotal)
    receipt.parseWarnings!.push('Receipt total was not detected.');
  if (!receipt.restaurantName)
    receipt.parseWarnings!.push('Merchant name was not confidently detected.');
  if (!receipt.items.length)
    receipt.parseWarnings!.push('No item lines were confidently detected.');
  return receipt;
}
