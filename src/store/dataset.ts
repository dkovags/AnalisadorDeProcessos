import { APP_NAME } from "../config";
import { DEFAULT_FORENSIC } from "../domain/calendar";
import type { Collection, Dataset, Prefs } from "../domain/types";

export const COLLECTIONS: Collection[] = ["cases", "notices", "tasks", "docs", "files", "precedents"];

export function defaultPrefs(): Prefs {
  return {
    theme: "auto",
    holidays: [],
    forensic: { ...DEFAULT_FORENSIC },
    marginDays: 2,
    citationStyle: "forense",
    quoteSummary: true,
  };
}

export function emptyDataset(): Dataset {
  return { version: 1, cases: {}, notices: {}, tasks: {}, docs: {}, files: {}, precedents: {}, prefs: defaultPrefs() };
}

/** Completa dados antigos ou vindos de um arquivo de cópia (campos que faltam recebem o padrão). */
export function normalizeDataset(raw: unknown): Dataset {
  if (!raw || typeof raw !== "object") throw new Error(`Arquivo sem dados do ${APP_NAME}.`);
  const r = raw as Partial<Dataset>;
  const ds = emptyDataset();
  for (const c of COLLECTIONS) {
    const src = (r[c] || {}) as Record<string, unknown>;
    if (typeof src !== "object") continue;
    for (const [id, v] of Object.entries(src)) if (v && typeof v === "object") (ds[c] as Record<string, unknown>)[id] = { ...(v as object), id };
  }
  for (const c of Object.values(ds.cases)) {
    c.parties ||= [];
    c.history ||= [];
    c.rite ||= "civel";
    c.status ||= "ativo";
  }
  for (const n of Object.values(ds.notices)) {
    n.recipients ||= [];
    n.counting ||= "uteis";
    n.status ||= "aberto";
  }
  for (const t of Object.values(ds.tasks)) {
    t.checklist ||= [];
    t.status ||= "pendente";
  }
  for (const p of Object.values(ds.precedents)) {
    p.parties ||= [];
    p.caseIds ||= [];
    p.standing ||= "vigente";
    p.binding ||= "";
  }
  const prefs = { ...defaultPrefs(), ...(r.prefs || {}) } as Prefs;
  prefs.forensic = { ...DEFAULT_FORENSIC, ...(r.prefs?.forensic || {}) };
  prefs.holidays = Array.isArray(prefs.holidays) ? prefs.holidays : [];
  ds.prefs = prefs;
  return ds;
}
