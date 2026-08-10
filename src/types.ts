export type Cents = number;
export type AdjustmentKind = 'SERVICE' | 'TAX' | 'DISCOUNT' | 'OTHER';
export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: Cents;
  lineTotal: Cents;
}
export interface ReceiptAdjustment {
  id: string;
  label: string;
  kind: AdjustmentKind;
  amount: Cents;
}
export interface OcrDiagnostics {
  sourceFileName: string;
  sourceMimeType: string;
  sourceFileSize: number;
  originalWidth: number;
  originalHeight: number;
  exifOrientation: number;
  orientationTransform: string;
  normalizedWidth: number;
  normalizedHeight: number;
  maximumDimension: number;
  preprocessingVersion: string;
  ocrLanguage: string;
  tesseractVersion: string;
  engineMode: string;
  pageSegmentationMode: string;
  userAgent: string;
  rawOcrCharacterCount: number;
  fingerprint: string;
}
export interface Receipt {
  restaurantName: string;
  image?: Blob;
  items: ReceiptItem[];
  adjustments: ReceiptAdjustment[];
  subtotal: Cents;
  /** Whether the printed subtotal was OCR-detected or subsequently entered by a user. */
  subtotalSource?: 'DETECTED' | 'MANUAL';
  grandTotal: Cents;
  /** Text produced by local OCR. Kept with the receipt for review, never sent. */
  rawOcrText?: string;
  /** Debug metadata only; contains no OCR text or receipt fields. */
  ocrDiagnostics?: OcrDiagnostics;
  /** Exact metadata-free PNG passed to Tesseract, retained for local inspection. */
  ocrInputImage?: Blob;
  parseWarnings?: string[];
  /** Plausible item-area OCR lines that the conservative parser did not classify. */
  possibleMissedLines?: string[];
  /** Extraction path used for the latest scan. */
  scanMethod?: 'SMART' | 'OFFLINE';
}

export interface ExtractedReceipt {
  merchantName: string | null;
  items: Array<{
    name: string;
    quantity: number | null;
    unitPriceCents: number | null;
    lineTotalCents: number | null;
  }>;
  subtotalCents: number | null;
  serviceCharges: Array<{ label: string; amountCents: number }>;
  taxes: Array<{ label: string; amountCents: number }>;
  discounts: Array<{ label: string; amountCents: number }>;
  otherAdjustments: Array<{ label: string; amountCents: number }>;
  grandTotalCents: number | null;
  warnings: string[];
}
export type PaymentStatus = 'UNPAID' | 'MARKED_SENT' | 'CONFIRMED_RECEIVED';
export interface Participant {
  id: string;
  displayName: string;
  isCreator?: boolean;
  paymentStatus: PaymentStatus;
}
export interface ItemAllocation {
  itemId: string;
  participantIds: string[];
}
export interface Bill {
  id: string;
  createdAt: string;
  updatedAt: string;
  creatorName: string;
  receipt: Receipt;
  participants: Participant[];
  allocations: ItemAllocation[];
  payNowQr?: Blob;
  reconciliationOverride?: boolean;
}
export interface ParticipantBreakdown {
  participantId: string;
  itemSubtotal: Cents;
  service: Cents;
  tax: Cents;
  other: Cents;
  discount: Cents;
  total: Cents;
}
