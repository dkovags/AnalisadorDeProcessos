import { todayISO } from "../domain/dates";
import type { Collection, Dataset, FileMeta, ID } from "../domain/types";
import type { Ctx, Result } from "./actions";
import { emptyDataset } from "./dataset";
import { newId } from "./ids";
import { applyOps, type Op } from "./ops";
import type { Persistence } from "./persistence";

export interface StoreStatus {
  phase: "loading" | "ready";
  /** Erro que impediu o carregamento. */
  error?: string;
}

/**
 * Dados do app: ficam em memória (a tela atualiza na hora) e são gravados no aparelho em segundo plano,
 * na ordem em que mudaram. O conteúdo dos arquivos e o texto das páginas são lidos só quando precisa.
 */
export class AppStore {
  private ds: Dataset | null = null;
  private status: StoreStatus = { phase: "loading" };
  private listeners = new Set<() => void>();
  private errorListeners = new Set<(msg: string) => void>();
  private queue: Promise<void> = Promise.resolve();
  private pageCache = new Map<ID, string[]>();
  private channel: BroadcastChannel | null = null;

  constructor(private p: Persistence) {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("autos-dados");
      // outra aba alterou os dados: recarrega
      this.channel.onmessage = () => void this.reload();
    }
  }

  async load(): Promise<void> {
    try {
      this.ds = (await this.p.loadAll()) || emptyDataset();
      this.status = { phase: "ready" };
    } catch (e) {
      this.status = { phase: "loading", error: (e as Error).message || String(e) };
    }
    this.emit();
  }

  private async reload() {
    await this.queue;
    const ds = await this.p.loadAll().catch(() => null);
    if (ds) {
      this.ds = ds;
      this.emit();
    }
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private fail(e: unknown) {
    console.error(e);
    const msg = (e as Error)?.name === "QuotaExceededError" ? "Sem espaço no aparelho para guardar os dados." : "Não foi possível gravar os dados neste aparelho.";
    this.errorListeners.forEach((l) => l(msg));
  }

  getSnapshot = (): Dataset | null => this.ds;
  getStatus = (): StoreStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onError(listener: (msg: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Aplica as alterações na memória e grava em segundo plano. */
  commit(ops: Op[]): void {
    if (!this.ds || !ops.length) return;
    this.ds = applyOps(this.ds, ops);
    this.emit();
    const puts: { c: Collection | "prefs"; id: ID; v: unknown }[] = [];
    const dels: { c: Collection; id: ID }[] = [];
    const files: ID[] = [];
    for (const op of ops) {
      if (op.t === "put") puts.push({ c: op.c, id: op.v.id, v: op.v });
      else if (op.t === "prefs") puts.push({ c: "prefs", id: "prefs", v: op.v });
      else {
        dels.push({ c: op.c, id: op.id });
        if (op.c === "files") files.push(op.id);
      }
    }
    for (const id of files) this.pageCache.delete(id);
    this.queue = this.queue
      .then(() => this.p.write(puts, dels))
      .then(() => this.p.deleteFiles(files))
      .then(() => this.channel?.postMessage("alterado"))
      .catch((e) => this.fail(e));
  }

  /** Espera as gravações pendentes. */
  flush(): Promise<void> {
    return this.queue;
  }

  /** Guarda o conteúdo e o texto de um arquivo (o registro FileMeta vai nas alterações). */
  async saveFile(meta: Pick<FileMeta, "id">, blob: Blob, pages: string[]): Promise<void> {
    await this.p.putFile(meta.id, blob, pages);
    this.pageCache.set(meta.id, pages);
  }

  async pages(fileId: ID): Promise<string[]> {
    const hit = this.pageCache.get(fileId);
    if (hit) return hit;
    const pages = (await this.p.getPages(fileId)) || [];
    this.pageCache.set(fileId, pages);
    // guarda na memória só os mais recentes
    if (this.pageCache.size > 40) this.pageCache.delete(this.pageCache.keys().next().value!);
    return pages;
  }

  blob(fileId: ID): Promise<Blob | undefined> {
    return this.p.getBlob(fileId);
  }

  /** Troca todos os dados (restauração de cópia ou apagar tudo). */
  async replace(ds: Dataset, files: Map<ID, { blob: Blob; pages: string[] }> = new Map()): Promise<void> {
    await this.queue;
    await this.p.clear();
    for (const [id, f] of files) await this.p.putFile(id, f.blob, f.pages);
    const puts: { c: Collection | "prefs"; id: ID; v: unknown }[] = [{ c: "prefs", id: "prefs", v: ds.prefs }];
    for (const c of ["cases", "notices", "tasks", "docs", "files", "precedents"] as Collection[])
      for (const [id, v] of Object.entries(ds[c])) puts.push({ c, id, v });
    await this.p.write(puts, []);
    this.pageCache.clear();
    this.ds = ds;
    this.emit();
    this.channel?.postMessage("alterado");
  }
}

export function makeCtx(): Ctx {
  return { now: new Date().toISOString(), today: todayISO(), id: newId };
}

/** Executa uma ação sobre os dados atuais e grava o resultado. Lança UserError se algo estiver inválido. */
export function run<T, A extends unknown[]>(store: AppStore, action: (ds: Dataset, ctx: Ctx, ...args: A) => Result<T>, ...args: A): T {
  const ds = store.getSnapshot();
  if (!ds) throw new Error("Dados ainda não carregados.");
  const { ops, value } = action(ds, makeCtx(), ...args);
  store.commit(ops);
  return value;
}
