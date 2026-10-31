import { useEffect, useRef } from "react";
import { APP_NAME } from "../config";
import { addDays } from "../domain/dates";
import * as A from "../store/actions";
import { CnjError, djenNotice, djenReady, djenSearch, type Fetch } from "../store/cnjapi";
import { run, type AppStore } from "../store/store";
import { useDatasetOrNull, useStore, useToday, useUI } from "./context";
import { notifyNews } from "./notify";
import { navigate } from "./router";

// Busca das intimações no DJEN: pelo botão em Configurações e, se a pessoa ligou, sozinha ao abrir o app, uma vez por dia.

/** Alcance da primeira busca, em dias. */
export const FIRST_DAYS = 30;
/** As buscas seguintes recomeçam alguns dias antes da última (o DJEN às vezes inclui comunicações com atraso). */
export const OVERLAP_DAYS = 7;

export interface DjenSync extends A.DjenImport {
  /** Comunicações que o DJEN devolveu (novas ou não). */
  found: number;
  from: string;
  to: string;
}

/** Busca no DJEN as comunicações para a OAB e registra as novas. */
export async function syncDjen(store: AppStore, today: string, fetchFn?: Fetch): Promise<DjenSync> {
  const cnj = store.getSnapshot()?.prefs.cnj;
  if (!djenReady(cnj)) throw new CnjError("Preencha em Configurações o endereço e a senha do intermediário e a sua OAB.");
  const last = cnj.lastRun && cnj.lastRun <= today ? cnj.lastRun : undefined;
  const from = last ? addDays(last, -OVERLAP_DAYS) : addDays(today, -FIRST_DAYS);
  const items = await djenSearch(cnj, from, today, fetchFn);
  const notices = items.map(djenNotice).filter((n): n is A.DjenNotice => !!n);
  const res = run(store, A.importDjen, notices, { day: today });
  return { ...res, found: items.length, from, to: today };
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 intimações novas registradas, 1 processo cadastrado" */
export function djenSummary(r: A.DjenImport): string {
  const parts: string[] = [];
  if (r.notices) parts.push(plural(r.notices, "intimação nova registrada", "intimações novas registradas"));
  if (r.cases) parts.push(plural(r.cases, "processo cadastrado", "processos cadastrados"));
  if (r.events) parts.push(plural(r.events, "distribuição nos andamentos", "distribuições nos andamentos"));
  if (r.failed) parts.push(`${plural(r.failed, "comunicação não pôde ser registrada", "comunicações não puderam ser registradas")} (confira no DJEN)`);
  return parts.join(", ") || "nenhuma intimação nova";
}

/** Busca sozinha ao abrir o app (e quando o dia vira com o app aberto), se a pessoa ligou a busca automática. */
export function useDjenAutoSync() {
  const ds = useDatasetOrNull();
  const store = useStore();
  const ui = useUI();
  const today = useToday();
  const tried = useRef("");
  const cnj = ds?.prefs.cnj;
  const due = !!cnj?.auto && djenReady(cnj) && cnj.lastRun !== today;
  useEffect(() => {
    if (!due || tried.current === today) return;
    // sem internet agora: tenta de novo na próxima vez que o app abrir
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    tried.current = today;
    syncDjen(store, today)
      .then((r) => {
        if (!r.notices && !r.cases && !r.events && !r.failed) return;
        ui.toast(`DJEN: ${djenSummary(r)}. Confira o ato e o prazo de cada uma.`, { action: { label: "Conferir", onClick: () => navigate("/") } });
        const now = store.getSnapshot();
        if (now && r.notices)
          notifyNews(now, `${plural(r.notices, "intimação nova", "intimações novas")} no DJEN`, `Abra o ${APP_NAME} para conferir o ato e o prazo.`, `djen:${today}`);
      })
      .catch((e) => ui.toast(`Busca no DJEN: ${e instanceof CnjError ? e.message : "não deu certo. Tente pelo botão em Configurações."}`, { kind: "error" }));
  }, [due, today, store, ui]);
}
