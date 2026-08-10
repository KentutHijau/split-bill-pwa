# Architecture

## Major components

`App` owns the prototype workflow: home, receipt review, people, claims, and dashboard. Domain types are independent of React. `calculations.ts` and `money.ts` are pure and testable; `parser.ts` and `storage.ts` define replaceable boundaries. Demo receipt fixtures exercise common Singapore receipt shapes.

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

The OCR implementation is lazy-loaded. It creates an orientation-aware bitmap, limits its longest edge to 2400 pixels, applies modest grayscale/contrast enhancement to a temporary canvas, then uses a Tesseract.js Web Worker. The worker is terminated in all outcomes and recognition has a two-minute UI timeout. No receipt pixels or detected text are submitted to a service.

`parseReceiptText` is independently tested and deterministic. It normalizes whitespace, extracts only explicit terminal decimal amounts, recognizes Singapore label variants, signs discounts/vouchers, and conservatively rejects metadata/payment lines. It does not infer GST/service amounts from rates, fabricate missing totals, or insert balancing adjustments. Missing fields and ambiguous quantities create review warnings. Raw text is stored on `Receipt` and shown only in the creator's collapsible review aid. All parsed fields remain editable and feed the existing integer-cent reconciliation immediately. Tesseract confidence/bounding boxes, sophisticated column recovery, and automatic cropping are intentionally deferred; manual comparison with the image is required.

## Storage

`BillRepository` supplies `list`, `get`, `save`, and `remove`. `IndexedDbBillRepository` is the local implementation and supports `Blob` receipt/QR images plus raw OCR text without base64 or localStorage. OCR has no analytics or network submission path. A future remote repository can keep the same application-facing contract, with subscription methods added separately for live changes.

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
