import { demos } from './demos';
import type { Receipt } from './types';
export interface ReceiptParser {
  parse(image: Blob): Promise<Receipt>;
}
export class DemoReceiptParser implements ReceiptParser {
  async parse(_image: Blob) {
    return structuredClone(demos[0]);
  }
}
