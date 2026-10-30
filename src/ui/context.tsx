import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { todayISO } from "../domain/dates";
import type { Dataset, ID } from "../domain/types";
import { UserError, type Ctx, type Result } from "../store/actions";
import { run, type AppStore, type StoreStatus } from "../store/store";

/* ---------- dados ---------- */

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): AppStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error("StoreProvider ausente");
  return s;
}

export function useStatus(): StoreStatus {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getStatus);
}

export function useDatasetOrNull(): Dataset | null {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useData(): Dataset {
  const ds = useDatasetOrNull();
  if (!ds) throw new Error("Dados não carregados");
  return ds;
}

/** Data de hoje, atualizada quando o dia vira (o app pode ficar aberto de um dia para o outro). */
export function useToday(): string {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const tick = () => setToday(todayISO());
    const t = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return today;
}

/** Texto das páginas de um arquivo (lido do aparelho quando precisa). */
export function usePages(fileId: ID | undefined): string[] | null {
  const store = useStore();
  const [pages, setPages] = useState<{ id?: ID; pages: string[] } | null>(null);
  useEffect(() => {
    if (!fileId) return;
    let alive = true;
    store.pages(fileId).then((p) => alive && setPages({ id: fileId, pages: p }));
    return () => {
      alive = false;
    };
  }, [store, fileId]);
  return pages && pages.id === fileId ? pages.pages : null;
}

/* ---------- interface: diálogos e avisos ---------- */

export type Dialog =
  | { type: "case"; caseId?: ID }
  | { type: "import"; caseId?: ID; precedentId?: ID; mode?: "processo" | "documento" | "expediente"; files?: File[] }
  | { type: "notice"; caseId?: ID; noticeId?: ID; text?: string; docId?: ID }
  | { type: "task"; caseId?: ID; taskId?: ID; noticeId?: ID }
  | { type: "doc"; docId: ID; q?: string; page?: number }
  | { type: "precedent"; precedentId?: ID; text?: string; caseId?: ID }
  | { type: "note"; caseId: ID }
  | { type: "calculator" }
  | { type: "confirm"; title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void };

export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
  action?: { label: string; onClick: () => void };
}

export interface UI {
  dialogs: Dialog[];
  open: (d: Dialog) => void;
  close: () => void;
  closeAll: () => void;
  toasts: Toast[];
  toast: (text: string, opts?: { kind?: "ok" | "error"; action?: Toast["action"] }) => void;
  dismissToast: (id: number) => void;
}

export const UIContext = createContext<UI | null>(null);

export function useUI(): UI {
  const ui = useContext(UIContext);
  if (!ui) throw new Error("UIContext ausente");
  return ui;
}

export type RunResult<T> = [T] extends [void] ? true | undefined : T | undefined;

/** Executa uma ação e mostra o erro num aviso. Devolve o resultado (true para ações sem valor) ou undefined se falhou. */
export function useRun() {
  const store = useStore();
  const ui = useUI();
  return useCallback(
    <T, A extends unknown[]>(action: (ds: Dataset, ctx: Ctx, ...args: A) => Result<T>, ...args: A): RunResult<T> => {
      try {
        const v = run(store, action, ...args);
        return (v === undefined ? true : v) as RunResult<T>;
      } catch (e) {
        if (e instanceof UserError) ui.toast(e.message, { kind: "error" });
        else {
          console.error(e);
          ui.toast("Algo deu errado. Tente novamente.", { kind: "error" });
        }
        return undefined as RunResult<T>;
      }
    },
    [store, ui],
  );
}

/* ---------- tela ---------- */

const mobileQuery = "(max-width: 900px)";

function subscribeMedia(cb: () => void) {
  const m = window.matchMedia(mobileQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMedia, () => window.matchMedia(mobileQuery).matches, () => false);
}
