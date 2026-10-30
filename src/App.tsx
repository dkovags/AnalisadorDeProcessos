import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_NAME } from "./config";
import { openDb, IdbPersistence } from "./store/idb";
import { MemoryPersistence } from "./store/persistence";
import { AppStore } from "./store/store";
import { ConfirmDialog, Logo } from "./ui/components/basics";
import { Shell } from "./ui/components/Shell";
import { StoreProvider, UIContext, useDatasetOrNull, useStatus, useStore, useToday, useUI, type Dialog, type Toast, type UI } from "./ui/context";
import { CaseDialog } from "./ui/dialogs/CaseDialog";
import { DocViewer } from "./ui/dialogs/DocViewer";
import { ImportDialog } from "./ui/dialogs/ImportDialog";
import { NoticeDialog } from "./ui/dialogs/NoticeDialog";
import { PrecedentDialog } from "./ui/dialogs/PrecedentDialog";
import { CalculatorDialog, NoteDialog } from "./ui/dialogs/SmallDialogs";
import { TaskDialog } from "./ui/dialogs/TaskDialog";
import { notifyDeadlines } from "./ui/notify";
import { AgendaPage } from "./ui/pages/Agenda";
import { CasePage } from "./ui/pages/CasePage";
import { CasesPage } from "./ui/pages/Cases";
import { CitationsPage } from "./ui/pages/Citations";
import { Dashboard } from "./ui/pages/Dashboard";
import { MorePage } from "./ui/pages/More";
import { PrecedentPage, PrecedentsPage } from "./ui/pages/Precedents";
import { SearchPage } from "./ui/pages/SearchPage";
import { SettingsPage } from "./ui/pages/Settings";
import { useRoute } from "./ui/router";

/** Banco de dados do navegador; se estiver bloqueado (aba anônima restrita), funciona só em memória. */
async function createStore(): Promise<{ store: AppStore; memory: boolean }> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("sem IndexedDB");
    const store = new AppStore(new IdbPersistence(await openDb()));
    await store.load();
    return { store, memory: false };
  } catch (e) {
    console.error(e);
    const store = new AppStore(new MemoryPersistence());
    await store.load();
    return { store, memory: true };
  }
}

/** Tema escolhido pela página que hospeda o app (por exemplo, um visualizador embutido), se houver. */
const hostTheme = typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined;

function useTheme(theme: string | undefined) {
  useEffect(() => {
    const apply = () => {
      const systemDark = hostTheme ? hostTheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      const dark = theme === "dark" || (theme !== "light" && systemDark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#141a24" : "#24406b");
    };
    apply();
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [theme]);
}

function UIProvider({ children }: { children: React.ReactNode }) {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<UI["toast"]>(
    (text, opts = {}) => {
      const id = ++seq.current;
      setToasts((t) => [...t.filter((x) => x.text !== text).slice(-1), { id, text, kind: opts.kind || "ok", action: opts.action }]);
      setTimeout(() => dismissToast(id), opts.action ? 7000 : opts.kind === "error" ? 6500 : 4000);
    },
    [dismissToast],
  );
  const ui = useMemo<UI>(
    () => ({
      dialogs,
      open: (d) => setDialogs((s) => [...s, d]),
      close: () => setDialogs((s) => s.slice(0, -1)),
      closeAll: () => setDialogs([]),
      toasts,
      toast,
      dismissToast,
    }),
    [dialogs, toasts, toast, dismissToast],
  );
  return <UIContext.Provider value={ui}>{children}</UIContext.Provider>;
}

function DialogHost() {
  const ui = useUI();
  return (
    <>
      {ui.dialogs.map((d, i) => {
        const close = () => ui.close();
        const key = `${i}:${d.type}`;
        switch (d.type) {
          case "case":
            return <CaseDialog key={key} caseId={d.caseId} onClose={close} />;
          case "import":
            return <ImportDialog key={key} caseId={d.caseId} precedentId={d.precedentId} mode={d.mode} files={d.files} onClose={close} />;
          case "notice":
            return <NoticeDialog key={key} caseId={d.caseId} noticeId={d.noticeId} text={d.text} docId={d.docId} onClose={close} />;
          case "task":
            return <TaskDialog key={key} caseId={d.caseId} taskId={d.taskId} noticeId={d.noticeId} onClose={close} />;
          case "doc":
            return <DocViewer key={key} docId={d.docId} q={d.q} page={d.page} onClose={close} />;
          case "precedent":
            return <PrecedentDialog key={key} precedentId={d.precedentId} text={d.text} caseId={d.caseId} onClose={close} />;
          case "note":
            return <NoteDialog key={key} caseId={d.caseId} onClose={close} />;
          case "calculator":
            return <CalculatorDialog key={key} onClose={close} />;
          case "confirm":
            return <ConfirmDialog key={key} {...d} onClose={close} />;
        }
      })}
    </>
  );
}

function Toasts() {
  const ui = useUI();
  return (
    <div className="toasts" aria-live="polite">
      {ui.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.onClick();
                ui.dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Pages() {
  const route = useRoute();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name, "id" in route ? route.id : ""]);
  switch (route.name) {
    case "processos":
      return <CasesPage q={route.q} status={route.status} />;
    case "processo":
      return <CasePage id={route.id} tab={route.tab} q={route.q} />;
    case "prazos":
      return <AgendaPage />;
    case "pesquisa":
      return <SearchPage q={route.q} />;
    case "jurisprudencia":
      return <PrecedentsPage q={route.q} />;
    case "decisao":
      return <PrecedentPage id={route.id} />;
    case "citacoes":
      return <CitationsPage />;
    case "configuracoes":
      return <SettingsPage />;
    case "mais":
      return <MorePage />;
    default:
      return <Dashboard />;
  }
}

function Splash({ error }: { error?: string }) {
  return (
    <div className="splash">
      <Logo size={64} />
      <div className="splash-name">{APP_NAME}</div>
      {error ? <p className="field-error">Não foi possível abrir os dados: {error}</p> : <div className="spinner" />}
    </div>
  );
}

/** Avisos do navegador e número no ícone do app, ao abrir e quando o app volta a ficar visível. */
function useDeadlineAlerts() {
  const ds = useDatasetOrNull();
  const today = useToday();
  const last = useRef("");
  useEffect(() => {
    if (!ds) return;
    const key = `${today}:${Object.keys(ds.tasks).length}:${Object.keys(ds.notices).length}`;
    if (key === last.current) return;
    last.current = key;
    notifyDeadlines(ds, today);
  }, [ds, today]);
}

function Main({ memory }: { memory: boolean }) {
  const status = useStatus();
  const ds = useDatasetOrNull();
  const ui = useUI();
  const store = useStore();
  useTheme(ds?.prefs.theme);
  useDeadlineAlerts();
  useEffect(() => store.onError((msg) => ui.toast(msg, { kind: "error" })), [store, ui]);
  useEffect(() => {
    if (memory) ui.toast("O navegador não deixou guardar dados: o que você fizer some ao fechar a página (aba anônima?).", { kind: "error" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory]);
  if (status.phase === "loading" || !ds) return <Splash error={status.error} />;
  return (
    <Shell>
      <Pages />
    </Shell>
  );
}

export default function App() {
  const [state, setState] = useState<{ store: AppStore; memory: boolean } | null>(null);
  useEffect(() => {
    createStore().then(setState);
  }, []);
  if (!state) return <Splash />;
  return (
    <StoreProvider store={state.store}>
      <UIProvider>
        <Main memory={state.memory} />
        <DialogHost />
        <Toasts />
      </UIProvider>
    </StoreProvider>
  );
}
