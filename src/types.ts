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
  /** True only when OCR/manual review supplied the printed receipt subtotal. */
  explicitSubtotalDetected?: boolean;
  grandTotal: Cents;
  /** Text produced by local OCR. Kept with the receipt for review, never sent. */
  rawOcrText?: string;
  /** Debug metadata only; contains no OCR text or receipt fields. */
  ocrDiagnostics?: OcrDiagnostics;
  /** Exact metadata-free PNG passed to Tesseract, retained for local inspection. */
  ocrInputImage?: Blob;
  parseWarnings?: string[];
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
