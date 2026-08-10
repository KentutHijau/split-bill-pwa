# Makan Split

A friendly, mobile-first Singapore restaurant bill splitter. This production-quality local prototype takes a creator from receipt capture and correction through deterministic item sharing, transparent participant totals, PayNow QR display, and honest payment tracking—without accounts or a backend.

## Architecture

- React + strict TypeScript on Vite, with a deliberately small dependency set.
- All monetary values are signed integer cents. The pure calculation module uses deterministic equal splitting and largest-remainder proportional allocation, including the correct adjustment share for unclaimed items.
- `ReceiptParser` isolates OCR from review and calculations. Demo parsing remains available, while the real implementation lazy-loads Tesseract.js and recognizes images in a browser Web Worker.
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

## Try the workflow

Choose **Split a bill**, then use **Take photo** (rear camera where supported), **Choose from gallery** (a separate input with no camera capture hint), or demo A–C. A real image is previewed first; press **Read receipt** to opt into OCR. Review every extracted field, add people, tap names on each dish, and view the dashboard. Images, detected text, and bills persist only on the device.

## Local receipt OCR and review

Tesseract.js is dynamically imported only when **Read receipt** is pressed. The original image is retained for preview and IndexedDB persistence; a temporary, orientation-aware canvas copy is resized to at most 2400 pixels, converted to enhanced grayscale, and passed to the worker. The UI reports preparation, recognition progress, parsing, and reconciliation, prevents duplicate jobs, times out stalled recognition, and permits retry.

The preprocessing pipeline is versioned as `makan-ocr-v2`: decode with EXIF auto-orientation disabled, read JPEG EXIF orientation, explicitly orient, cap the normalized long edge at 2400 pixels (short edge is `Math.round(source × scale)`), render to an exact pixel-sized canvas with high-quality smoothing, then apply integer BT.601 grayscale and fixed 1.25 contrast. CSS size and `devicePixelRatio` never participate. The derived metadata-free PNG goes to Tesseract.js 6.0.1 with English, LSTM-only OEM, single-block PSM, and preserved inter-word spaces. The original image remains untouched.

The deterministic Singapore parser recognizes explicit item amounts and common subtotal, total, GST/tax, service charge, discount, voucher/promo, and rounding labels. It normalizes all line endings and Unicode whitespace and generates stable positional parsed IDs; it does not use locale, time, or mutable parser state. It ignores common metadata lines (dates, times, telephone/card/reference/receipt numbers, tender and change), does not assume tax/service rates, and never creates a price without a decimal amount in the OCR evidence. Missing or uncertain fields are flagged for review. Every field stays editable; reconciliation never silently changes an amount. **View detected text** exposes raw OCR text.

Parsing uses strict precedence: normalize a line, classify receipt summaries and adjustments, reject metadata/payment lines, then consider the remainder as probable items. Summary amounts tolerate harmless OCR punctuation after the decimal value. Printed subtotal remains separate from the detected-item sum: receipt-level reconciliation checks printed subtotal plus explicit adjustments against grand total, while item-level reconciliation compares editable items with the printed subtotal. Thus complete receipt totals can reconcile while the UI independently warns that menu items may be missing.

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
