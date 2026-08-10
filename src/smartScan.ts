import type { ExtractedReceipt, Receipt, ReceiptAdjustment } from './types';

export const SMART_SCAN_TIMEOUT_MS = 30_000;
const FUNCTION_PATH = '/functions/v1/parse-receipt';

export type SmartScanFailure =
  | 'unavailable'
  | 'timeout'
  | 'network-or-cors'
  | 'http'
  | 'invalid-json'
  | 'invalid-schema';

export interface SmartScanDiagnostics {
  configured: boolean;
  hostname?: string;
  functionUrl?: string;
  outcome?: 'fetch/network' | 'timeout' | 'http-response' | 'response-parsing';
  failure?: SmartScanFailure;
  httpStatus?: number;
}

export const getSmartScanDiagnostics = (): SmartScanDiagnostics => {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '');
  const configured = Boolean(
    base && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
  );
  if (!base) return { configured };
  try {
    const url = new URL(`${base}${FUNCTION_PATH}`);
    return { configured, hostname: url.hostname, functionUrl: url.href };
  } catch {
    return { configured: false };
  }
};

export const smartScanConfigured = () => getSmartScanDiagnostics().configured;

export class SmartScanError extends Error {
  constructor(
    public code: SmartScanFailure,
    public diagnostics: SmartScanDiagnostics,
  ) {
    super(
      code === 'unavailable'
        ? 'Smart Scan is not configured. You can still use Offline Scan.'
        : code === 'timeout'
          ? 'Smart Scan took too long. Please retry or use Offline Scan.'
          : code === 'network-or-cors'
            ? 'Smart Scan could not reach the receipt service (network, DNS, or browser CORS/preflight failure). Please retry or use Offline Scan.'
            : code === 'http'
              ? `The receipt service returned HTTP ${diagnostics.httpStatus ?? 'error'}. Please retry or use Offline Scan.`
              : 'Smart Scan returned an unreadable result. Please retry or use Offline Scan.',
    );
    this.name = 'SmartScanError';
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
      item.lineTotalCents ??
      (item.unitPriceCents === null ? null : item.unitPriceCents * quantity);
    const unitPrice =
      item.unitPriceCents ??
      (lineTotal === null ? null : Math.round(lineTotal / quantity));
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
  subtotal: data.subtotalCents,
  subtotalSource: data.subtotalCents === null ? undefined : 'DETECTED',
  grandTotal: data.grandTotalCents,
  parseWarnings: data.warnings,
});

export async function smartScan(
  image: Blob,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Receipt> {
  const diagnostics = getSmartScanDiagnostics();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!diagnostics.configured || !diagnostics.functionUrl || !key)
    throw new SmartScanError('unavailable', {
      ...diagnostics,
      failure: 'unavailable',
    });
  // Deliberately contains only public routing metadata, never the key or image.
  console.info('[Smart Scan] request', diagnostics);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMART_SCAN_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort(), {
    once: true,
  });
  try {
    const response = await (options.fetch ?? fetch)(diagnostics.functionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': image.type,
      },
      body: image,
      signal: controller.signal,
    });
    if (!response.ok)
      throw new SmartScanError('http', {
        ...diagnostics,
        outcome: 'http-response',
        failure: 'http',
        httpStatus: response.status,
      });
    let body: { receipt?: ExtractedReceipt };
    try {
      body = (await response.json()) as { receipt?: ExtractedReceipt };
    } catch {
      throw new SmartScanError('invalid-json', {
        ...diagnostics,
        outcome: 'response-parsing',
        failure: 'invalid-json',
        httpStatus: response.status,
      });
    }
    if (!body.receipt || !Array.isArray(body.receipt.items))
      throw new SmartScanError('invalid-schema', {
        ...diagnostics,
        outcome: 'response-parsing',
        failure: 'invalid-schema',
        httpStatus: response.status,
      });
    return mapExtractedReceipt(body.receipt, image);
  } catch (error) {
    if (error instanceof SmartScanError) {
      console.error('[Smart Scan] failure', error.diagnostics);
      throw error;
    }
    const failure = controller.signal.aborted ? 'timeout' : 'network-or-cors';
    const detail: SmartScanDiagnostics = {
      ...diagnostics,
      outcome: failure === 'timeout' ? 'timeout' : 'fetch/network',
      failure,
    };
    console.error('[Smart Scan] failure', detail);
    throw new SmartScanError(failure, detail);
  } finally {
    clearTimeout(timeout);
  }
}
