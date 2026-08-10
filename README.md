# Makan Split

A friendly, mobile-first Singapore restaurant bill splitter. Smart Scan sends a receipt image through a Supabase Edge Function to Gemini for structured extraction; Offline Scan retains the existing local Tesseract workflow. Every result goes through editable review and deterministic integer-cent calculations.

## Architecture

- React + strict TypeScript on Vite, with a deliberately small dependency set.
- All monetary values are signed integer cents. The pure calculation module uses deterministic equal splitting and largest-remainder proportional allocation, including the correct adjustment share for unclaimed items.
- Smart Scan sends the image directly (never Tesseract text) to `parse-receipt`; Gemini extracts document facts but never controls financial calculations. Offline Scan lazy-loads Tesseract.js in a browser Web Worker.
- `BillRepository` isolates persistence. IndexedDB stores full bills and image `Blob`s; it is ready to be swapped for a Supabase implementation.
- Vite PWA generates the manifest and service worker. Shared URL routes are explicitly excluded from navigation fallback caching so future live bill updates are not masked by stale data.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the calculation, data, privacy, and backend design.

## Setup and commands

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev       # local development
npm run typecheck # strict TypeScript
npm run lint      # ESLint
npm test          # deterministic financial tests
npm run build     # production build
npm run preview   # serve production build
```

## Smart Scan setup, privacy and deployment

Copy `.env.example` to `.env.local` and set browser-safe `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The app builds and Offline Scan works when absent. **Never create `VITE_GEMINI_API_KEY`: `GEMINI_API_KEY` belongs only in Supabase Edge Function secrets.**

Smart Scan uploads the image to the Makan Split Edge Function, which transmits it to Gemini. This phase does not intentionally persist it in Supabase Storage or server application storage. Google processes it subject to its API terms. Offline Scan runs Tesseract locally and sends nothing to Gemini (runtime assets can still be downloaded). Diagnostics belong only to Offline Scan.

Deploy with:

1. `supabase login` then `supabase link --project-ref <project-ref>`.
2. Confirm the secret name without printing its value: `supabase secrets list --project-ref <project-ref>`. If absent, run `supabase secrets set GEMINI_API_KEY --project-ref <project-ref>` outside source control.
3. Set exact origins: `supabase secrets set ALLOWED_ORIGINS=https://<username>.github.io --project-ref <project-ref>`. Origins omit repository paths; localhost:5173 is built in.
4. Optionally set server-only `GEMINI_MODEL`; the default is `gemini-3.5-flash-lite`. For a short-lived request-isolation diagnosis, set `GEMINI_STRUCTURED_OUTPUT` to `none`, then `mime`, then `schema` (the default). `none` tests image generation without structured output, `mime` requests JSON without a schema, and `schema` sends the full receipt JSON Schema. Remove the diagnostic override after testing.
5. Run `supabase functions deploy parse-receipt --no-verify-jwt --project-ref <project-ref>`.

The public Pages app has no accounts, so JWT verification is disabled for this function. Origin, POST-only, MIME, 8 MiB, fixed upstream/model/prompt and timeout controls reduce abuse, but CORS can be forged outside a browser. Add gateway/WAF quotas or rate limiting before high-volume launch.

Set the GitHub Actions repository variables `VITE_SUPABASE_URL` to `https://vsqvyfoizzjecvskyngn.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the browser-safe publishable key. The Pages workflow validates that both are present and that the URL is an `https://*.supabase.co` base URL before injecting them during the Vite build; it does not print their values. The resulting function URL is `https://vsqvyfoizzjecvskyngn.supabase.co/functions/v1/parse-receipt`. Both values are public browser configuration by design. Never configure `GEMINI_API_KEY` in GitHub or as `VITE_*`.

For a non-sensitive connectivity check, send an `OPTIONS` request with the production Pages origin; a successful preflight returns 204 and the matching `Access-Control-Allow-Origin`, methods, and headers. No API key is required for this check:

```sh
curl -i -X OPTIONS 'https://vsqvyfoizzjecvskyngn.supabase.co/functions/v1/parse-receipt' \
  -H 'Origin: https://kentuthijau.github.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,apikey,content-type'
```

The Smart Scan connection diagnostics disclose only configuration presence, hostname, function URL, failure stage, and HTTP status—never the key or receipt. Browsers intentionally expose CORS/preflight rejection and DNS/transport failure identically as a rejected `fetch`, so that category is reported as `network-or-cors`; use the preflight command and Edge Function logs to separate them. “Not configured” means the build key is absent; HTTP 403 commonly means `ALLOWED_ORIGINS` is not exact; 413/415 means size/type rejection.

## Try the workflow

Choose **Split a bill**, then use **Take photo** (rear camera where supported), **Choose from gallery** (a separate input with no camera capture hint), or demo A–C. A real image is previewed first; press **Read receipt** to opt into OCR. Review every extracted field, add people, tap names on each dish, and view the dashboard. Images, detected text, and bills persist only on the device.

## Local receipt OCR and review

Tesseract.js is dynamically imported only when **Read receipt** is pressed. The original image is retained for preview and IndexedDB persistence; a temporary, orientation-aware canvas copy is resized to at most 2400 pixels, converted to enhanced grayscale, and passed to the worker. The UI reports preparation, recognition progress, parsing, and reconciliation, prevents duplicate jobs, times out stalled recognition, and permits retry.

The preprocessing pipeline is versioned as `makan-ocr-v2`: decode with EXIF auto-orientation disabled, read JPEG EXIF orientation, explicitly orient, cap the normalized long edge at 2400 pixels (short edge is `Math.round(source × scale)`), render to an exact pixel-sized canvas with high-quality smoothing, then apply integer BT.601 grayscale and fixed 1.25 contrast. CSS size and `devicePixelRatio` never participate. The derived metadata-free PNG goes to Tesseract.js 6.0.1 with English, LSTM-only OEM, single-column PSM 4 (which permits the variable-size text regions typical of receipts), and preserved inter-word spaces. The original image remains untouched.

The deterministic Singapore parser recognizes explicit item amounts and common subtotal, total, GST/tax, service charge, discount, voucher/promo, and rounding labels. It normalizes all line endings and Unicode whitespace and generates stable positional parsed IDs; it does not use locale, time, or mutable parser state. It ignores common metadata lines (dates, times, telephone/card/reference/receipt numbers, tender and change), does not assume tax/service rates, and never creates a price without a decimal amount in the OCR evidence. Missing or uncertain fields are flagged for review. Every field stays editable; reconciliation never silently changes an amount. **View detected text** exposes raw OCR text.

After recognition, expand **OCR diagnostics** to compare devices. **Copy diagnostics** copies non-receipt metadata, and **View OCR input image** shows the actual derived input. The fingerprint is SHA-256 over an 8-byte big-endian width/height prefix followed by canvas RGBA bytes—not browser-dependent PNG encoding. On desktop and mobile, choose the same original file, read it, copy both blocks, then compare source properties, orientation, normalized dimensions, preprocessing/configuration, fingerprint, raw character count, and detected text. A different fingerprint identifies decode/preprocessing variation; an equal fingerprint with different text points to Tesseract/WASM/runtime variation; equal text with a different structured result indicates a parser/state defect.

Receipt images and OCR text are **not sent to an OCR service, backend, analytics, or any other participant**. Tesseract's code and English language assets may be downloaded as application dependencies, but recognition runs locally. Manual review is mandatory in practice: shadows, folds, blur, unusual fonts, multi-column layouts, and HEIC/browser support can reduce accuracy. Crop closely, photograph straight-on in even light, and compare every value with the original.

Pixel-identical normalized inputs are the goal, not a guarantee that every browser decodes JPEG or executes Tesseract's WASM identically. `createImageBitmap(..., { imageOrientation: 'none' })`, canvas high-quality interpolation, JPEG color management, and codec implementations can still differ by browser. The fingerprint makes those differences observable; small OCR differences can remain even when it matches.

## PWA testing

Build and serve with `npm run build && npm run preview -- --host`. In Chrome DevTools, use Application → Manifest and Service Workers, then run the installability audit. Test Add to Home Screen on iOS Safari and installation on Android Chrome over HTTPS (localhost is treated as secure). The app shell works offline after one visit; future `/share/` routes are intentionally not navigation-fallback cached.

## GitHub Pages Deployment

GitHub Pages hosts this frontend at the repository's standard project-site URL: `https://<username>.github.io/<repository-name>/`. No custom domain is required. On pull requests to `main`, GitHub Actions installs dependencies, type-checks, lints, tests, and builds the app. A successful push to `main` performs the same validation and then deploys the generated `dist` directory with the official GitHub Pages actions.

In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions** if it is not already selected. Deployment progress and validation failures appear in the repository's **Actions** tab under **Validate and deploy Pages**. The workflow uses `npm install` only while this repository has no genuine lockfile; generate and commit `package-lock.json` from a network-enabled environment as the next maintenance step, after which the workflow automatically switches to cached `npm ci`.

The deployed Phase 1 application remains local-only. Bills and images are stored in that browser's IndexedDB. **Opening the website on another phone, computer, browser, or browser profile does not share existing bills:** every browser has independent data. Cross-device bills will only be introduced in a later Supabase phase.

## Future Supabase integration

Implement `BillRepository` against authenticated Supabase RPC/API calls, store private images in non-public buckets, and replace local navigation with owner and token-scoped participant routes. Do not expose service-role keys or implement authorization only in React. See the proposed schema and RLS outline in the architecture document.

## Prototype limitations

- OCR is best-effort and English-only; difficult photos and complex layouts require manual correction, and first use may need a network connection to fetch OCR runtime/language assets.
- Data and images exist only in this browser's IndexedDB and cannot yet be shared across devices.
- Payment buttons record assertions, not bank confirmations. There is no PayNow or financial integration.
- Local-only storage is not a security boundary and should not be treated as multi-user privacy.
