# Roadmap

## Phase 1 — local prototype

- Complete: editable demo receipts and image capture/preview, deterministic reconciliation and allocation, participants, item claiming, transparent totals, PayNow QR, payment state dashboard, IndexedDB, PWA, and unit coverage.
- Next within phase: component-level accessibility tests, browser E2E coverage, image compression/orientation handling, data export/delete controls, and richer empty/error states.

## Phase 1.5 — useful receipt uploads

- Complete: explicit camera/gallery inputs, original-image preview and persistence, opt-in lazy-loaded local Tesseract.js OCR, lightweight derived-image preprocessing, staged progress/error/retry UI, raw detected-text review, conservative Singapore receipt parsing, editable extracted fields, warnings, and immediate deterministic reconciliation.
- Covered with synthetic offline parser fixtures: GST/service combinations, tax-inclusive/no-adjustment receipts, discounts, vouchers, rounding, noisy spacing, dollarless prices, misleading metadata, and unresolved missing/malformed values.
- Follow-up improvements: receipt crop/rotation controls, broader language packs, confidence/bounding-box visualization, multi-column receipt recovery, and device-level OCR performance testing.

## Phase 2 — Supabase shared bills

- Implement schema, private storage, RLS and transactional calculation RPCs.
- Add high-entropy share links, revocable participant sessions, live updates, expiration/deletion, and policy integration tests.

## Phase 3 — creator accounts

- Add passwordless owner authentication, multi-device dashboard, bill ownership/transfer, retention controls, audit history, and account deletion.

## Phase 4 — advanced OCR improvements

- Evaluate further on-device OCR options behind `ReceiptParser` without introducing paid image services.
- Add crop/quality checks, line confidence, duplicate detection, and receipt-specific review assistance while retaining manual override.

## Phase 5 — polish/public beta

- Conduct accessibility and cross-browser audits, Singapore usability research, localization, performance/telemetry work with consent, security review, operational monitoring, help content, and a staged public beta.

## Receipt extraction (current)

- Smart Scan uses direct Gemini multimodal extraction through a validated Supabase function.
- Offline Scan retains Tesseract preprocessing, parser, diagnostics and fingerprint.
- Next: gateway-level quotas/rate limiting before meaningful public traffic.
