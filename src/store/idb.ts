import { APP_NAME } from "../config";
import type { Collection, ID } from "../domain/types";
import { assemble, recordKey, type Persistence } from "./persistence";

// Dados no IndexedDB do navegador: "dados" (registros), "arquivos" (conteúdo dos arquivos) e "textos" (texto das páginas).

const DB_NAME = "autos";
const STORES = ["dados", "arquivos", "textos"] as const;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Gravação cancelada."));
  });
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error(`O ${APP_NAME} está aberto em outra aba com uma versão antiga: feche-a e recarregue esta página.`));
  });
}

export class IdbPersistence implements Persistence {
  constructor(private db: IDBDatabase) {}

  async loadAll() {
    const t = this.db.transaction("dados", "readonly");
    const s = t.objectStore("dados");
    const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
    return assemble(keys.map((k, i) => [String(k), values[i]]));
  }

  async write(puts: { c: Collection | "prefs"; id: ID; v: unknown }[], dels: { c: Collection; id: ID }[]) {
    const t = this.db.transaction("dados", "readwrite");
    const s = t.objectStore("dados");
    for (const p of puts) s.put(p.v, recordKey(p.c, p.id));
    for (const d of dels) s.delete(recordKey(d.c, d.id));
    await done(t);
  }

  async putFile(id: ID, blob: Blob, pages: string[]) {
    const t = this.db.transaction(["arquivos", "textos"], "readwrite");
    t.objectStore("arquivos").put(blob, id);
    t.objectStore("textos").put(pages, id);
    await done(t);
  }

  async getBlob(id: ID) {
    return (await req(this.db.transaction("arquivos", "readonly").objectStore("arquivos").get(id))) as Blob | undefined;
  }

  async getPages(id: ID) {
    return (await req(this.db.transaction("textos", "readonly").objectStore("textos").get(id))) as string[] | undefined;
  }

  async deleteFiles(ids: ID[]) {
    if (!ids.length) return;
    const t = this.db.transaction(["arquivos", "textos"], "readwrite");
    for (const id of ids) {
      t.objectStore("arquivos").delete(id);
      t.objectStore("textos").delete(id);
    }
    await done(t);
  }

  async clear() {
    const t = this.db.transaction([...STORES], "readwrite");
    for (const s of STORES) t.objectStore(s).clear();
    await done(t);
  }
}
