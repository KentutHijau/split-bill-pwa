export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_ITEMS = 100;
export const MAX_ADJUSTMENTS = 30;
const MAX_CENTS = 100_000_000;

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
const cents = (value: unknown) =>
  value === null
    ? null
    : Number.isSafeInteger(value) &&
        Number(value) >= 0 &&
        Number(value) <= MAX_CENTS
      ? Number(value)
      : null;
const text = (value: unknown, max = 200) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const nonItem =
  /\b(?:visa|mastercard|amex|card|payment|tender(?:ed)?|change|transaction|receipt\s*(?:no|number)|gst\s*(?:reg|registration))\b/i;

export function normalizeReceipt(value: unknown) {
  const root = object(value);
  if (!root || !Array.isArray(root.items))
    throw new Error('invalid_model_output');
  const warnings = Array.isArray(root.warnings)
    ? root.warnings
        .map((x) => text(x, 300))
        .filter((x): x is string => Boolean(x))
        .slice(0, 30)
    : [];
  const items = root.items.slice(0, MAX_ITEMS).flatMap((raw) => {
    const item = object(raw);
    const name = item && text(item.name);
    if (!item || !name) {
      warnings.push('An item with missing required fields was omitted.');
      return [];
    }
    if (nonItem.test(name)) {
      warnings.push(`A payment or receipt metadata line was omitted: ${name}.`);
      return [];
    }
    const quantity =
      item.quantity === null
        ? null
        : Number.isInteger(item.quantity) &&
            Number(item.quantity) > 0 &&
            Number(item.quantity) <= 100
          ? Number(item.quantity)
          : null;
    const unitPriceCents = cents(item.unitPriceCents);
    const lineTotalCents = cents(item.lineTotalCents);
    if (
      (item.unitPriceCents !== null && unitPriceCents === null) ||
      (item.lineTotalCents !== null && lineTotalCents === null)
    )
      warnings.push(`Malformed monetary value was removed from item: ${name}.`);
    return [{ name, quantity, unitPriceCents, lineTotalCents }];
  });
  const adjustments = (key: string) => {
    const values = Array.isArray(root[key])
      ? root[key].slice(0, MAX_ADJUSTMENTS)
      : [];
    const seen = new Set<string>();
    return values.flatMap((raw) => {
      const entry = object(raw);
      const label = entry && text(entry.label, 100);
      const amountCents = entry && cents(entry.amountCents);
      if (!label || amountCents === null) {
        warnings.push(`A malformed ${key} entry was omitted.`);
        return [];
      }
      const signature = `${label.toLowerCase()}\0${amountCents}`;
      if (seen.has(signature)) {
        warnings.push(`Duplicate adjustment omitted: ${label}.`);
        return [];
      }
      seen.add(signature);
      return [{ label, amountCents }];
    });
  };
  return {
    merchantName: root.merchantName === null ? null : text(root.merchantName),
    items,
    subtotalCents: cents(root.subtotalCents),
    serviceCharges: adjustments('serviceCharges'),
    taxes: adjustments('taxes'),
    discounts: adjustments('discounts'),
    otherAdjustments: adjustments('otherAdjustments'),
    grandTotalCents: cents(root.grandTotalCents),
    warnings: [...new Set(warnings)].slice(0, 30),
  };
}

export const receiptSchema = {
  type: 'object',
  required: [
    'merchantName',
    'items',
    'subtotalCents',
    'serviceCharges',
    'taxes',
    'discounts',
    'otherAdjustments',
    'grandTotalCents',
    'warnings',
  ],
  properties: {
    merchantName: { type: 'string', nullable: true },
    items: {
      type: 'array',
      maxItems: MAX_ITEMS,
      items: {
        type: 'object',
        required: ['name', 'quantity', 'unitPriceCents', 'lineTotalCents'],
        properties: {
          name: { type: 'string' },
          quantity: { type: 'integer', nullable: true },
          unitPriceCents: { type: 'integer', nullable: true },
          lineTotalCents: { type: 'integer', nullable: true },
        },
      },
    },
    subtotalCents: { type: 'integer', nullable: true },
    serviceCharges: adjustmentSchema(),
    taxes: adjustmentSchema(),
    discounts: adjustmentSchema(),
    otherAdjustments: adjustmentSchema(),
    grandTotalCents: { type: 'integer', nullable: true },
    warnings: { type: 'array', items: { type: 'string' }, maxItems: 30 },
  },
};

function adjustmentSchema() {
  return {
    type: 'array',
    maxItems: MAX_ADJUSTMENTS,
    items: {
      type: 'object',
      required: ['label', 'amountCents'],
      properties: {
        label: { type: 'string' },
        amountCents: { type: 'integer' },
      },
    },
  };
}
