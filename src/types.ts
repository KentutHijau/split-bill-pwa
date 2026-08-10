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
export interface Receipt {
  restaurantName: string;
  image?: Blob;
  items: ReceiptItem[];
  adjustments: ReceiptAdjustment[];
  subtotal: Cents;
  grandTotal: Cents;
  /** Text produced by local OCR. Kept with the receipt for review, never sent. */
  rawOcrText?: string;
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
