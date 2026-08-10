import { demos } from './demos';
import type { AdjustmentKind, Receipt } from './types';
export type OcrStage = 'preparing' | 'reading' | 'understanding' | 'checking';
export interface ParseProgress { stage: OcrStage; progress?: number }
export interface ReceiptParser {
  parse(image: Blob, onProgress?: (update: ParseProgress) => void): Promise<Receipt>;
}
export class DemoReceiptParser implements ReceiptParser {
  async parse() { return structuredClone(demos[0]); }
}

const id = (kind: string, index: number) => `ocr-${kind}-${index + 1}`;
const decimalAmount = /(?:S?\$\s*)?(-?\s*\d{1,5}[.,]\d{2})/gi;
const harmlessTail = /^[\s|¦©®™“”‘’'"`´*#~_.:;!?+\-=–—()[\]{}<>/\\]*$/u;
const normalizeAmount = (value: string) => {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  return Math.round(Number(normalized) * 100);
};
const normalizeLine = (line: string) => line
  .replace(/[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g, ' ')
  .trim();

interface MoneyMatch { amount: number; start: number; end: number }
function lastMoney(line: string): MoneyMatch | undefined {
  const matches = [...line.matchAll(decimalAmount)];
  const match = matches.at(-1);
  if (!match || match.index === undefined || !harmlessTail.test(line.slice(match.index + match[0].length))) return undefined;
  return { amount: normalizeAmount(match[1]), start: match.index, end: match.index + match[0].length };
}

const prefix = String.raw`^[^\p{L}\p{N}]*`;
const subtotalLabel = new RegExp(prefix + String.raw`sub\s*[-–—:]?\s*total\b`, 'iu');
const grandTotalLabel = new RegExp(prefix + String.raw`grand\s*[-–—:]?\s*total\b`, 'iu');
const genericTotalLabel = new RegExp(prefix + String.raw`(?:total\b|amount\s+(?:due|payable)\b)`, 'iu');
const serviceLabel = new RegExp(prefix + String.raw`(?:\d+(?:[.,]\d+)?\s*%\s*)?(?:service|svc)\s+(?:charge|chg)s?\b`, 'iu');
const taxLabel = new RegExp(prefix + String.raw`(?:gst|tax)\b`, 'iu');
const discountLabel = new RegExp(prefix + String.raw`(?:discount|disc\b|voucher|promo)\b`, 'iu');
const roundingLabel = new RegExp(prefix + String.raw`(?:rounding|round\s*adj(?:ustment)?)\b`, 'iu');
const metaLine = /(?:\bdate\b|\btime\b|\btel(?:ephone)?\b|\bphone\b|receipt|invoice|table\s*(?:no)?|queue|transaction|\btrans\b|card|visa|master|approval|auth|reference|\bref\b|gst\s*(?:reg|no)|postal|postcode|address|\bpax\b|cashier|shift|tender|cash|change|payment|masked|loyalty|reward|points|thank\s+you|dine\s+in)/iu;
const nonItemLine = /^(?:qty\b|item\s+name\b|amount\b|[-=_.*\s]+$)/iu;

type Summary = { kind: 'subtotal' | 'grand' | 'generic-total' | AdjustmentKind; amount?: MoneyMatch };
function classifySummary(line: string): Summary | undefined {
  const amount = lastMoney(line);
  if (subtotalLabel.test(line)) return { kind: 'subtotal', amount };
  if (grandTotalLabel.test(line)) return { kind: 'grand', amount };
  if (serviceLabel.test(line)) return { kind: 'SERVICE', amount };
  if (taxLabel.test(line)) return { kind: 'TAX', amount };
  if (discountLabel.test(line)) return { kind: 'DISCOUNT', amount };
  if (roundingLabel.test(line)) return { kind: 'OTHER', amount };
  if (genericTotalLabel.test(line)) return { kind: 'generic-total', amount };
  return undefined;
}

/**
 * Pure parsing precedence: normalize, classify summary, reject metadata, then
 * conservatively classify an item. A classified summary can never become food.
 */
export function parseReceiptText(rawText: string): Receipt {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n').map(normalizeLine).filter(Boolean);
  const receipt: Receipt = {
    restaurantName: '', items: [], adjustments: [], subtotal: 0, grandTotal: 0,
    explicitSubtotalDetected: false, rawOcrText: rawText, parseWarnings: [],
  };
  const classified = new Set<number>();
  let totalPriority = 0;

  lines.forEach((line, index) => {
    const summary = classifySummary(line);
    if (!summary) return;
    classified.add(index);
    if (!summary.amount) {
      receipt.parseWarnings!.push(`Could not read an amount for: ${line}`);
      return;
    }
    if (summary.kind === 'subtotal') {
      receipt.subtotal = summary.amount.amount;
      receipt.explicitSubtotalDetected = true;
    } else if (summary.kind === 'grand' || summary.kind === 'generic-total') {
      const priority = summary.kind === 'grand' ? 2 : 1;
      if (priority > totalPriority) {
        receipt.grandTotal = summary.amount.amount;
        totalPriority = priority;
      }
    } else {
      const amount = summary.kind === 'DISCOUNT' && summary.amount.amount > 0
        ? -summary.amount.amount : summary.amount.amount;
      receipt.adjustments.push({
        id: id('adjustment', receipt.adjustments.length),
        label: line.slice(0, summary.amount.start).replace(/[^\p{L}\p{N}%]+$/gu, '').trim(),
        kind: summary.kind,
        amount,
      });
    }
  });

  receipt.restaurantName = lines.find((line, index) => index < 6 && !classified.has(index) &&
    !metaLine.test(line) && !nonItemLine.test(line) && !lastMoney(line) && /[A-Za-z]{2}/.test(line)) ?? '';

  lines.forEach((line, index) => {
    if (classified.has(index) || metaLine.test(line) || nonItemLine.test(line)) return;
    const money = lastMoney(line);
    if (!money) return;
    let description = line.slice(0, money.start).replace(/[.·\-–—\s]+$/, '').trim();
    let quantity = 1;
    // A duplicated leading number is tolerated only when followed by a clear quantity + name.
    const noisyQuantity = description.match(/^\d{1,2}\s+(\d{1,2})\s+([*¥#|:;]*\s*[A-Za-z].*)$/u);
    const quantityMatch = description.match(/^(\d{1,2})(?:\s*[xX])?\s+(.+)$/u);
    if (noisyQuantity) {
      quantity = Number(noisyQuantity[1]); description = noisyQuantity[2];
    } else if (quantityMatch) {
      quantity = Number(quantityMatch[1]); description = quantityMatch[2];
    }
    description = description.replace(/^[*¥#|:;~]+\s*/u, '').trim();
    if (!/[A-Za-z]{2}/.test(description) || quantity < 1 || quantity > 99) return;
    const lineTotal = money.amount;
    if (!Number.isFinite(lineTotal) || lineTotal < 0) return;
    const unitPrice = lineTotal % quantity === 0 ? lineTotal / quantity : lineTotal;
    receipt.items.push({ id: id('item', receipt.items.length), name: description, quantity, unitPrice, lineTotal });
    if (lineTotal % quantity !== 0)
      receipt.parseWarnings!.push(`Check quantity and unit price for: ${description}`);
  });

  if (!receipt.explicitSubtotalDetected)
    receipt.parseWarnings!.push('Receipt subtotal was not detected; detected items are shown separately.');
  if (!totalPriority) receipt.parseWarnings!.push('Receipt total was not detected.');
  if (!receipt.restaurantName) receipt.parseWarnings!.push('Merchant name was not confidently detected.');
  if (!receipt.items.length) receipt.parseWarnings!.push('No item lines were confidently detected.');
  return receipt;
}
