import type { Collection, Dataset, ID } from "../domain/types";
import { COLLECTIONS, emptyDataset } from "./dataset";

/** Onde os dados ficam guardados: IndexedDB no navegador, memória nos testes. */
export interface Persistence {
  /** Carrega tudo (sem o conteúdo dos arquivos). null quando ainda não há dados. */
  loadAll(): Promise<Dataset | null>;
  /** Grava e apaga registros numa única transação. */
  write(puts: { c: Collection | "prefs"; id: ID; v: unknown }[], dels: { c: Collection; id: ID }[]): Promise<void>;
  putFile(id: ID, blob: Blob, pages: string[]): Promise<void>;
  getBlob(id: ID): Promise<Blob | undefined>;
  getPages(id: ID): Promise<string[] | undefined>;
  deleteFiles(ids: ID[]): Promise<void>;
  /** Apaga tudo. */
  clear(): Promise<void>;
}

export const recordKey = (c: Collection | "prefs", id: ID) => (c === "prefs" ? "prefs" : `${c}/${id}`);

/** Monta o conjunto de dados a partir dos registros gravados ("cases/abc" → ds.cases.abc). */
export function assemble(entries: [string, unknown][]): Dataset | null {
  if (!entries.length) return null;
  const ds = emptyDataset();
  for (const [key, v] of entries) {
    if (key === "prefs") ds.prefs = { ...ds.prefs, ...(v as object) };
    else {
      const slash = key.indexOf("/");
      const c = key.slice(0, slash) as Collection;
      if (COLLECTIONS.includes(c)) (ds[c] as Record<string, unknown>)[key.slice(slash + 1)] = v;
    }
  }
  return ds;
}

export class MemoryPersistence implements Persistence {
  records = new Map<string, unknown>();
  blobs = new Map<ID, Blob>();
  pages = new Map<ID, string[]>();

  async loadAll() {
    return assemble([...this.records.entries()]);
  }
  async write(puts: { c: Collection | "prefs"; id: ID; v: unknown }[], dels: { c: Collection; id: ID }[]) {
    for (const p of puts) this.records.set(recordKey(p.c, p.id), structuredClone(p.v));
    for (const d of dels) this.records.delete(recordKey(d.c, d.id));
  }
  async putFile(id: ID, blob: Blob, pages: string[]) {
    this.blobs.set(id, blob);
    this.pages.set(id, pages);
  }
  async getBlob(id: ID) {
    return this.blobs.get(id);
  }
  async getPages(id: ID) {
    return this.pages.get(id);
  }
  async deleteFiles(ids: ID[]) {
    for (const id of ids) {
      this.blobs.delete(id);
      this.pages.delete(id);
    }
  }
  async clear() {
    this.records.clear();
    this.blobs.clear();
    this.pages.clear();
  }
}
