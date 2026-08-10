# Architecture

## Major components

`App` owns the prototype workflow: home, receipt review, people, claims, and dashboard. Domain types are independent of React. `calculations.ts` and `money.ts` are pure and testable; `parser.ts` and `storage.ts` define replaceable boundaries. Demo receipt fixtures exercise common Singapore receipt shapes.

## Smart Scan architecture and trust boundary

The primary flow is `GitHub Pages PWA → Supabase parse-receipt Edge Function → Gemini multimodal API → normalized ExtractedReceipt → existing editable Receipt`. Gemini receives the image directly, never Tesseract text, and only extracts evidence. `smartScan.ts` maps the shared structured shape into the existing domain; the calculation model is not duplicated. Offline remains `image → deterministic preprocessing → Tesseract.js → parser → editable Receipt`.

The Edge Function defaults centrally to `gemini-3.5-flash-lite` (server-only `GEMINI_MODEL` can override it). A fixed conservative system prompt treats all receipt text, URLs, QR codes and prompt-like text as untrusted document data. It prohibits invented items, amounts and rates, preserves item rows, and distinguishes subtotal, service, tax, discounts/vouchers, rounding and grand total. Production uses `responseJsonSchema` structured output; the server-only `GEMINI_STRUCTURED_OUTPUT` isolation switch can temporarily select `none`, `mime`, or the default `schema`. Regardless of that diagnostic switch, `normalizeReceipt()` remains the final validation boundary.

The browser has a 30-second timeout and retains its Blob after failure. The function allows exact configured origins plus local development, handles OPTIONS, accepts POST only, validates image MIME and declared/actual size (8 MiB), fixes the Gemini host/model/prompt, and times upstream out after 25 seconds. It neither logs nor intentionally stores receipt bytes or extracted contents. Controlled errors hide upstream details.

Model output is untrusted. Normalization requires an object/item array; bounds arrays; trims strings; accepts null uncertainty; requires safe non-negative bounded integer cents and sensible positive integer quantities; omits malformed entries, duplicate adjustments and obvious payment/metadata rows with warnings. Gemini arithmetic is never authoritative. Receipt-level reconciliation (`subtotal + signed adjustments = grand total`) and item-level reconciliation (`sum(line totals) = subtotal`) remain separate, immediate, deterministic checks.

This no-account endpoint disables JWT verification. CORS is not authentication and non-browser callers can forge Origin. Current constraints prevent arbitrary proxy, prompt and model use, but infrastructure-level quotas/rate limiting remain required before significant public traffic.

## Data model

`Bill` is the aggregate root with random UUID, timestamps, creator display name, `Receipt`, `Participant[]`, `ItemAllocation[]`, optional QR blob, and reconciliation override. A `Receipt` contains source-of-truth items, signed adjustments, subtotal, total, an optional private image, raw OCR text, and review warnings. `ReceiptItem` retains quantity, unit price, and explicit line total. `ReceiptAdjustment.kind` distinguishes service, tax, discount, and other while `amount` remains signed. Participants have only UUID, display name, creator flag, and one of `UNPAID`, `MARKED_SENT`, or `CONFIRMED_RECEIVED`.

These map cleanly to relational tables without embedding identity or authorization assumptions in the frontend types.

## Calculation and rounding policy

Money is always integer minor units (cents); parsing decimal text never performs monetary arithmetic on binary floating point values. Receipt reconciliation is:

`sum(explicit line totals) + sum(signed receipt adjustments) = explicit grand total`

A one-cent reconciliation tolerance accommodates explicit receipt rounding, while the discrepancy remains visible. An override is persisted when the creator accepts a larger mismatch.

Each item is divided equally among its sorted claimant UUIDs. Integer division establishes the base share; leftover cents go to lexically earlier UUIDs, making results stable across clients. Unclaimed items remain in the unclaimed pool.

Each explicit receipt adjustment—including fixed GST/service values, negative vouchers, and rounding—is allocated in proportion to all item subtotals. Unclaimed items participate as a deterministic virtual allocation bucket, so claimed diners never absorb the service, tax, or discount share belonging to unclaimed food. Largest-remainder allocation floors absolute shares, then distributes remainder cents by descending fractional remainder and UUID tie-break. Negative adjustments use the same allocation with a negative sign. Rates are never inferred or used as truth. Participant totals plus unclaimed always equal the receipt grand total; a reconciled bill naturally makes that total equal the item-and-adjustment calculation.

## Receipt parsing

`ReceiptParser.parse(blob, progress)` returns a normal editable `Receipt`; both `DemoReceiptParser` and `LocalOcrReceiptParser` implement the seam. The UI deliberately uses separate camera (`capture="environment"`) and gallery (no `capture`) inputs, resets both after selection, retains the original blob, and starts OCR only after an explicit action.

The OCR implementation remains lazy-loaded and follows one explicit `makan-ocr-v2` path: read source bytes and JPEG EXIF orientation; decode through `createImageBitmap` with orientation disabled; explicitly apply one of the eight EXIF transforms; calculate dimensions solely from decoded source pixels; cap the oriented long edge at 2400; round each scaled edge with `Math.round`; draw into an exact-sized canvas with smoothing enabled and quality `high`; then apply integer BT.601 grayscale and fixed 5/4 contrast. CSS layout and device pixel ratio are absent from the calculation. Canvas export to PNG strips EXIF and is the image passed to Tesseract.js 6.0.1. The worker uses `eng`, LSTM-only OEM 1, single-column PSM 4, and preserved inter-word spaces on every device. Unlike PSM 6, PSM 4 does not force the differently indented header, item, modifier, and total regions into one uniform block, while retaining deterministic reading order without merging independently recognized passes. The worker is terminated in all outcomes, including the two-minute timeout; temporary bitmap references are closed.

Diagnostics retain the derived PNG locally for a collapsible visual inspection and record source metadata, decoded/oriented dimensions, configuration, user agent, and raw text length. The reproducibility fingerprint deliberately avoids PNG encoder differences: SHA-256 receives big-endian unsigned 32-bit width, big-endian unsigned 32-bit height, then every post-filter canvas RGBA byte in row-major order. Hash failure is non-fatal to OCR. Keeping the diagnostic PNG alongside the original costs one processed-resolution copy, but avoids retaining a second full-resolution decode.

Cross-browser consistency has three observable boundaries. A fingerprint mismatch means source decoding, orientation, resizing, canvas interpolation, color management, or preprocessing differed. A matching fingerprint with different raw text isolates a Tesseract worker/WASM/runtime difference. Matching raw text with different parsed data is a parser/state defect. JPEG codecs, color profiles, browser support for disabled bitmap orientation, high-quality interpolation kernels, and WASM execution can still vary; diagnostics expose rather than overstate these limits.

`parseReceiptText` is pure and independently tested. It canonicalizes CRLF/CR/LF and explicit Unicode whitespace, uses stable positional IDs, extracts only explicit terminal decimal amounts (period or OCR comma), and has no locale, clock, random, or device input. It recognizes Singapore label variants, signs discounts/vouchers, and conservatively rejects metadata/payment lines. It does not infer GST/service amounts from rates, fabricate missing totals, or insert balancing adjustments. Missing fields and ambiguous quantities create review warnings. Raw text is stored on `Receipt` and shown only in the creator's collapsible review aid. All parsed fields remain editable and feed integer-cent reconciliation immediately.

## Storage

`BillRepository` supplies `list`, `get`, `save`, and `remove`. `IndexedDbBillRepository` is the local implementation and supports `Blob` receipt/QR images plus raw OCR text without base64 or localStorage. Offline OCR has no analytics or receipt submission path. Smart Scan sends the image through Supabase to Gemini for processing but does not intentionally persist it server-side; Google processing is subject to its API terms. A future remote repository can keep the same application-facing contract, with subscription methods added separately for live changes.

## Sharing and security design

This local prototype does **not** claim to provide cross-user security. The backend phase must enforce:

- Private owner access through authenticated creator identity.
- High-entropy bill public IDs plus separate hashed, revocable participant session tokens. IDs are locators, not authorization secrets.
- Participants need no account, but an edge/server exchange should turn a one-time share token into a narrowly scoped, expiring session.
- Receipt images are owner-only. PayNow QR access is bill-scoped and time-limited via signed URLs. Neither bucket is public.
- Participant reads expose a database view/RPC that omits owner metadata, receipt image paths, other session tokens, and private audit data.
- Owner-controlled automatic deletion timestamps and a scheduled deletion job cover rows and storage objects.
- Rate limits, audit events, token rotation, CSP, input constraints, and storage MIME/size checks are server responsibilities.

## Proposed Supabase schema

- `bills(id uuid, owner_id uuid, creator_name, currency, restaurant_name, receipt_subtotal_cents, grand_total_cents, reconciliation_override, delete_at, timestamps)`
- `receipt_items(id, bill_id, name, quantity, unit_price_cents, line_total_cents, sort_order)`
- `receipt_adjustments(id, bill_id, label, kind, amount_cents, sort_order)`
- `participants(id, bill_id, display_name, payment_status, timestamps)`
- `item_allocations(item_id, participant_id)` with a composite primary key
- `participant_sessions(id, bill_id, participant_id nullable, token_hash, expires_at, revoked_at)`
- `bill_assets(id, bill_id, kind, private_storage_path, owner_only)`
- `payment_events(id, bill_id, participant_id, actor_kind, from_status, to_status, created_at)`

Use checks for integer cent ranges, non-empty names, status enums, positive quantities, uniqueness, and foreign-key cascading deletion. Transactional RPCs should update allocations/statuses and return recalculated snapshots; do not trust totals submitted by a browser.

## Row Level Security approach

Enable RLS on every public-schema table. Owners may select/mutate rows only where `bills.owner_id = auth.uid()`. Participants receive no direct broad table access: security-definer RPCs validate a server-set session claim or hashed token, restrict the bill/participant, return an allow-listed projection, and permit only claim edits and `UNPAID ↔ MARKED_SENT`. Only owners may set or undo `CONFIRMED_RECEIVED`. Storage policies mirror bill ownership; participant QR access uses a validating function and short signed URL, while receipt access remains owner-only. Test policies with owner, unrelated owner, valid participant, expired/revoked participant, and anonymous roles before launch.
