import type { ExtractedReceipt, Receipt, ReceiptAdjustment } from './types';

export const SMART_SCAN_TIMEOUT_MS = 30_000;
export const smartScanConfigured = () =>
  Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );

export class SmartScanError extends Error {
  constructor(public code: 'unavailable' | 'timeout' | 'network' | 'invalid') {
    super(
      code === 'unavailable'
        ? 'Smart Scan is not configured. You can still use Offline Scan.'
        : code === 'timeout'
          ? 'Smart Scan took too long. Please retry or use Offline Scan.'
          : code === 'network'
            ? 'Smart Scan could not reach the receipt service. Please retry or use Offline Scan.'
            : 'Smart Scan returned an unreadable result. Please retry or use Offline Scan.',
    );
  }
}

const adjustment = (
  value: { label: string; amountCents: number },
  kind: ReceiptAdjustment['kind'],
): ReceiptAdjustment => ({
  id: crypto.randomUUID(),
  label: value.label,
  kind,
  amount:
    kind === 'DISCOUNT' ? -Math.abs(value.amountCents) : value.amountCents,
});

export const mapExtractedReceipt = (
  data: ExtractedReceipt,
  image: Blob,
): Receipt => ({
  restaurantName: data.merchantName ?? '',
  image,
  scanMethod: 'SMART',
  items: data.items.map((item) => {
    const quantity = item.quantity ?? 1;
    const lineTotal =
      item.lineTotalCents ?? (item.unitPriceCents ?? 0) * quantity;
    const unitPrice =
      item.unitPriceCents ?? (quantity ? Math.round(lineTotal / quantity) : 0);
    return {
      id: crypto.randomUUID(),
      name: item.name,
      quantity,
      unitPrice,
      lineTotal,
    };
  }),
  adjustments: [
    ...data.serviceCharges.map((x) => adjustment(x, 'SERVICE')),
    ...data.taxes.map((x) => adjustment(x, 'TAX')),
    ...data.discounts.map((x) => adjustment(x, 'DISCOUNT')),
    ...data.otherAdjustments.map((x) => adjustment(x, 'OTHER')),
  ],
  subtotal: data.subtotalCents ?? 0,
  subtotalSource: data.subtotalCents === null ? undefined : 'DETECTED',
  grandTotal: data.grandTotalCents ?? 0,
  parseWarnings: data.warnings,
});

export async function smartScan(
  image: Blob,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Receipt> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new SmartScanError('unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMART_SCAN_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort(), {
    once: true,
  });
  try {
    const response = await (options.fetch ?? fetch)(
      `${url}/functions/v1/parse-receipt`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          'Content-Type': image.type,
        },
        body: image,
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new SmartScanError('network');
    const body = (await response.json()) as { receipt?: ExtractedReceipt };
    if (!body.receipt || !Array.isArray(body.receipt.items))
      throw new SmartScanError('invalid');
    return mapExtractedReceipt(body.receipt, image);
  } catch (error) {
    if (error instanceof SmartScanError) throw error;
    if (controller.signal.aborted) throw new SmartScanError('timeout');
    throw new SmartScanError('network');
  } finally {
    clearTimeout(timeout);
  }
}
