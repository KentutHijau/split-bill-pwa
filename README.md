# Makan Split

A friendly, mobile-first Singapore restaurant bill splitter. This production-quality local prototype takes a creator from receipt capture and correction through deterministic item sharing, transparent participant totals, PayNow QR display, and honest payment tracking—without accounts or a backend.

## Architecture

- React + strict TypeScript on Vite, with a deliberately small dependency set.
- All monetary values are signed integer cents. The pure calculation module uses deterministic equal splitting and largest-remainder proportional allocation, including the correct adjustment share for unclaimed items.
- `ReceiptParser` isolates OCR from review and calculations; the current demo parser can later be replaced without changing the workflow.
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

Choose **Split a bill**, then load demo A, B, or C. Review every extracted field, add people, tap names on each dish, and view the dashboard. Expand a participant row for their transparent total and payment actions. Bills persist on the device.

## PWA testing

Build and serve with `npm run build && npm run preview -- --host`. In Chrome DevTools, use Application → Manifest and Service Workers, then run the installability audit. Test Add to Home Screen on iOS Safari and installation on Android Chrome over HTTPS (localhost is treated as secure). The app shell works offline after one visit; future `/share/` routes are intentionally not navigation-fallback cached.

## GitHub Pages Deployment

GitHub Pages hosts this frontend at the repository's standard project-site URL: `https://<username>.github.io/<repository-name>/`. No custom domain is required. On pull requests to `main`, GitHub Actions installs dependencies, type-checks, lints, tests, and builds the app. A successful push to `main` performs the same validation and then deploys the generated `dist` directory with the official GitHub Pages actions.

In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions** if it is not already selected. Deployment progress and validation failures appear in the repository's **Actions** tab under **Validate and deploy Pages**. The workflow uses `npm install` only while this repository has no genuine lockfile; generate and commit `package-lock.json` from a network-enabled environment as the next maintenance step, after which the workflow automatically switches to cached `npm ci`.

The deployed Phase 1 application remains local-only. Bills and images are stored in that browser's IndexedDB. **Opening the website on another phone, computer, browser, or browser profile does not share existing bills:** every browser has independent data. Cross-device bills will only be introduced in a later Supabase phase.

## Future Supabase integration

Implement `BillRepository` against authenticated Supabase RPC/API calls, store private images in non-public buckets, and replace local navigation with owner and token-scoped participant routes. Do not expose service-role keys or implement authorization only in React. See the proposed schema and RLS outline in the architecture document.

## Prototype limitations

- Receipt parsing is demo/mock based; uploaded photographs are previewed but not sent to OCR.
- Data and images exist only in this browser's IndexedDB and cannot yet be shared across devices.
- Payment buttons record assertions, not bank confirmations. There is no PayNow or financial integration.
- Local-only storage is not a security boundary and should not be treated as multi-user privacy.
