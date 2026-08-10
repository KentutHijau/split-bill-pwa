import { createParseReceiptHandler } from './handler.ts';

const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

Deno.serve(createParseReceiptHandler({
  apiKey: Deno.env.get('GEMINI_API_KEY'),
  model: Deno.env.get('GEMINI_MODEL'),
  structuredOutput: parseStructuredOutput(Deno.env.get('GEMINI_STRUCTURED_OUTPUT')),
  allowedOrigins: new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...configuredOrigins,
  ]),
}));

function parseStructuredOutput(value: string | undefined) {
  return value === 'none' || value === 'mime' ? value : 'schema';
}
