import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSmartScanDiagnostics,
  mapExtractedReceipt,
  smartScan,
  SmartScanError,
} from './smartScan';
import type { ExtractedReceipt } from './types';

const extracted: ExtractedReceipt = {
  merchantName: 'Cafe',
  items: [
    { name: 'Noodles', quantity: 2, unitPriceCents: 500, lineTotalCents: 1000 },
  ],
  subtotalCents: 1000,
  serviceCharges: [{ label: 'Service', amountCents: 100 }],
  taxes: [{ label: 'GST', amountCents: 90 }],
  discounts: [{ label: 'Voucher', amountCents: 50 }],
  otherAdjustments: [],
  grandTotalCents: 1140,
  warnings: [],
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Smart Scan mapping', () => {
  it('maps valid cents and keeps service, GST and discounts separate from items', () => {
    const result = mapExtractedReceipt(extracted, new Blob());
    expect(result.items).toHaveLength(1);
    expect(result.adjustments.map((x) => [x.kind, x.amount])).toEqual([
      ['SERVICE', 100],
      ['TAX', 90],
      ['DISCOUNT', -50],
    ]);
    expect(result.subtotalSource).toBe('DETECTED');
  });
  it('handles null fields without floating point inference', () => {
    const result = mapExtractedReceipt(
      {
        ...extracted,
        merchantName: null,
        subtotalCents: null,
        grandTotalCents: null,
        items: [
          {
            name: 'Unknown',
            quantity: null,
            unitPriceCents: null,
            lineTotalCents: null,
          },
        ],
      },
      new Blob(),
    );
    expect(result.restaurantName).toBe('');
    expect(result.subtotalSource).toBeUndefined();
    expect(result.items[0].unitPrice).toBeNull();
    expect(result.items[0].lineTotal).toBeNull();
    expect(result.subtotal).toBeNull();
    expect(result.grandTotal).toBeNull();
  });
});

describe('Smart Scan transport', () => {
  it('reports unavailable config while Offline Scan remains independent', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    await expect(smartScan(new Blob())).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(SmartScanError).toBeDefined();
  });
  it('maps a mocked Edge Function response', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public');
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ receipt: extracted }), { status: 200 }),
      );
    await expect(
      smartScan(new Blob(['x'], { type: 'image/png' }), { fetch: mock }),
    ).resolves.toMatchObject({ restaurantName: 'Cafe' });
    expect(mock).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/parse-receipt',
      expect.objectContaining({ method: 'POST' }),
    );
  });
  it('constructs the exact deployed function URL without exposing its key', () => {
    vi.stubEnv(
      'VITE_SUPABASE_URL',
      'https://vsqvyfoizzjecvskyngn.supabase.co/',
    );
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'do-not-report-this');
    expect(getSmartScanDiagnostics()).toEqual({
      configured: true,
      hostname: 'vsqvyfoizzjecvskyngn.supabase.co',
      functionUrl:
        'https://vsqvyfoizzjecvskyngn.supabase.co/functions/v1/parse-receipt',
    });
    expect(JSON.stringify(getSmartScanDiagnostics())).not.toContain(
      'do-not-report-this',
    );
  });
  it('distinguishes transport, HTTP, JSON, and schema failures', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public');
    await expect(
      smartScan(new Blob(), {
        fetch: vi
          .fn<typeof fetch>()
          .mockRejectedValue(new Error('secret detail')),
      }),
    ).rejects.toMatchObject({
      code: 'network-or-cors',
      diagnostics: { outcome: 'fetch/network' },
    });
    await expect(
      smartScan(new Blob(), {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('{}', { status: 403 })),
      }),
    ).rejects.toMatchObject({
      code: 'http',
      diagnostics: { outcome: 'http-response', httpStatus: 403 },
    });
    await expect(
      smartScan(new Blob(), {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('not json')),
      }),
    ).rejects.toMatchObject({ code: 'invalid-json' });
    await expect(
      smartScan(new Blob(), {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),
      }),
    ).rejects.toMatchObject({
      code: 'invalid-schema',
      diagnostics: { outcome: 'response-parsing', httpStatus: 200 },
    });
  });
  it('times out a stalled request', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public');
    vi.useFakeTimers();
    const promise = smartScan(new Blob(), {
      fetch: vi
        .fn<typeof fetch>()
        .mockImplementation(
          (_u, init) =>
            new Promise((_r, reject) =>
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              ),
            ),
        ),
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
