import { openDB } from 'idb';
import type { Bill } from './types';
export interface BillRepository {
  list(): Promise<Bill[]>;
  get(id: string): Promise<Bill | undefined>;
  save(bill: Bill): Promise<void>;
  remove(id: string): Promise<void>;
}
const db = () =>
  openDB('makan-split', 1, {
    upgrade(database) {
      database.createObjectStore('bills', { keyPath: 'id' });
    },
  });
export class IndexedDbBillRepository implements BillRepository {
  async list() {
    return ((await (await db()).getAll('bills')) as Bill[]).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  async get(id: string) {
    return (await (await db()).get('bills', id)) as Bill | undefined;
  }
  async save(bill: Bill) {
    await (await db()).put('bills', bill);
  }
  async remove(id: string) {
    await (await db()).delete('bills', id);
  }
}
