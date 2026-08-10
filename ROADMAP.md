# Roadmap

## Phase 1 — local prototype

- Complete: editable demo receipts and image capture/preview, deterministic reconciliation and allocation, participants, item claiming, transparent totals, PayNow QR, payment state dashboard, IndexedDB, PWA, and unit coverage.
- Next within phase: component-level accessibility tests, browser E2E coverage, image compression/orientation handling, data export/delete controls, and richer empty/error states.

## Phase 2 — Supabase shared bills

- Implement schema, private storage, RLS and transactional calculation RPCs.
- Add high-entropy share links, revocable participant sessions, live updates, expiration/deletion, and policy integration tests.

## Phase 3 — creator accounts

- Add passwordless owner authentication, multi-device dashboard, bill ownership/transfer, retention controls, audit history, and account deletion.

## Phase 4 — real OCR improvements

- Evaluate privacy-conscious OCR providers and on-device options behind `ReceiptParser`.
- Add orientation/crop/quality checks, line confidence, label normalization, duplicate detection, and receipt-specific review assistance while retaining manual override.

## Phase 5 — polish/public beta

- Conduct accessibility and cross-browser audits, Singapore usability research, localization, performance/telemetry work with consent, security review, operational monitoring, help content, and a staged public beta.
