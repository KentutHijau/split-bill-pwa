import { describe, expect, it, vi } from 'vitest';
import { createParseReceiptHandler } from './handler.ts';

const origin = 'https://kentuthijau.github.io';
const baseReceipt = {
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

const geminiResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const invoke = async (upstream: Response, structuredOutput?: 'none' | 'mime' | 'schema') => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(upstream);
  const log = vi.fn();
  const handler = createParseReceiptHandler({
    apiKey: 'test-key',
    allowedOrigins: new Set([origin]),
    fetch,
    log,
    structuredOutput,
  });
  const response = await handler(new Request('https://example.test/parse-receipt', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'image/jpeg' },
    body: new Uint8Array([1, 2, 3]),
  }));
  return { response, body: await response.json(), fetch, log };
};

describe('parse-receipt Gemini diagnostics', () => {
  it.each([
    [400, 'INVALID_ARGUMENT'],
    [401, 'UNAUTHENTICATED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RESOURCE_EXHAUSTED'],
    [500, 'INTERNAL'],
  ])('reports safe diagnostics for Gemini %i %s', async (status, code) => {
    const result = await invoke(geminiResponse({
      error: { code: status, status: code, message: `Safe detail for ${code}` },
    }, status));
    expect(result.response.status).toBe(status === 429 ? 429 : 502);
    expect(result.body).toEqual({
      error: 'receipt_service_failed', upstreamStatus: status, upstreamCode: code,
    });
    expect(result.log).toHaveBeenCalledWith(expect.stringContaining(`status=${status} code=${code}`));
    expect(result.log.mock.calls.join(' ')).not.toContain('test-key');
  });

  it('categorizes a successful response with no candidate', async () => {
    const result = await invoke(geminiResponse({ candidates: [] }));
    expect(result.body).toEqual({ error: 'gemini_no_candidate' });
  });

  it('logs only safe structured error metadata', async () => {
    const result = await invoke(geminiResponse({ error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      message: 'Request contains an invalid argument.',
      details: [{
        '@type': 'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations: [{ field: 'generation_config.response_json_schema' }],
      }, {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        metadata: { api_key: 'must-not-be-logged', receipt: 'must-not-be-logged' },
      }],
    } }, 400));
    const logged = result.log.mock.calls.join(' ');
    expect(logged).toContain('type.googleapis.com/google.rpc.BadRequest');
    expect(logged).toContain('generation_config.response_json_schema');
    expect(logged).not.toContain('must-not-be-logged');
  });

  it('categorizes a candidate with no text', async () => {
    const result = await invoke(geminiResponse({ candidates: [{ content: { parts: [] } }] }));
    expect(result.body).toEqual({ error: 'gemini_no_text' });
  });

  it('categorizes malformed candidate JSON', async () => {
    const result = await invoke(geminiResponse({ candidates: [{ content: { parts: [{ text: '{bad' }] } }] }));
    expect(result.body).toEqual({ error: 'gemini_invalid_json' });
  });

  it('categorizes schema-invalid candidate JSON', async () => {
    const result = await invoke(geminiResponse({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    expect(result.body).toEqual({ error: 'gemini_schema_validation_failed' });
  });

  it('returns a normalized valid structured response', async () => {
    const result = await invoke(geminiResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(baseReceipt) }] } }] }));
    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({ receipt: baseReceipt });
    const request = JSON.parse(String(result.fetch.mock.calls[0]?.[1]?.body));
    expect(result.fetch.mock.calls[0]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(request.generationConfig).toEqual({
      responseMimeType: 'application/json', responseJsonSchema: expect.any(Object),
    });
    expect(request.generationConfig.responseSchema).toBeUndefined();
    expect(request.generationConfig.temperature).toBeUndefined();
    expect(request.generationConfig.responseJsonSchema.properties.merchantName.type)
      .toEqual(['string', 'null']);
    expect(request.generationConfig.responseJsonSchema.properties.items.maxItems).toBe(100);
    expect(request.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
    expect(request.contents[0].parts[1].inlineData.data).toBe('AQID');
    expect(request.systemInstruction.parts[0].text).toEqual(expect.any(String));
  });

  it.each([
    ['none', undefined],
    ['mime', { responseMimeType: 'application/json' }],
    ['schema', { responseMimeType: 'application/json', responseJsonSchema: expect.any(Object) }],
  ] as const)('builds the %s structured-output isolation request', async (mode, expected) => {
    const result = await invoke(geminiResponse({ candidates: [] }), mode);
    const request = JSON.parse(String(result.fetch.mock.calls[0]?.[1]?.body));
    expect(request.generationConfig).toEqual(expected);
    expect(request.contents[0].parts).toEqual([
      { text: expect.any(String) },
      { inlineData: { mimeType: 'image/jpeg', data: 'AQID' } },
    ]);
  });
});
