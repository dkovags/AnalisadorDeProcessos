import { addDays, parts, toISO, weekday } from "./dates";
import type { Holiday, Prefs } from "./types";

// Calendário forense: fins de semana, feriados nacionais, feriados forenses usuais, recesso e suspensões
// do CPC (art. 220) e os feriados locais cadastrados pela pessoa.

export interface DayInfo {
  /** Há expediente forense (dia útil). */
  expedient: boolean;
  /** Expediente começa depois ou termina antes do normal (CPC, art. 224, § 1º). */
  partial: boolean;
  /** Prazos suspensos (recesso do art. 220 do CPC ou suspensão informada). */
  suspended: boolean;
  reasons: string[];
}

export interface Calendar {
  info(iso: string): DayInfo;
  /** Dia útil: há expediente, mesmo que reduzido. */
  isBusiness(iso: string): boolean;
  /** Próximo dia útil depois de iso (sem contar iso). */
  nextBusiness(iso: string): string;
  /** Dia que entra na contagem em dias úteis: há expediente e os prazos não estão suspensos. */
  counts(iso: string): boolean;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISO(year, month, day);
}

export type Forensic = Prefs["forensic"];

export const DEFAULT_FORENSIC: Forensic = {
  carnaval: true,
  cinzas: true,
  paixao: true,
  quintaSanta: false,
  corpus: false,
  federal: false,
};

interface Fixed {
  date: string;
  label: string;
  kind: Holiday["kind"];
}

/** Feriados nacionais e forenses de um ano (sem os cadastrados pela pessoa). */
export function yearHolidays(year: number, forensic: Forensic = DEFAULT_FORENSIC): Fixed[] {
  const d = (m: number, day: number) => toISO(year, m, day);
  const out: Fixed[] = [
    { date: d(1, 1), label: "Confraternização Universal", kind: "feriado" },
    { date: d(4, 21), label: "Tiradentes", kind: "feriado" },
    { date: d(5, 1), label: "Dia do Trabalho", kind: "feriado" },
    { date: d(9, 7), label: "Independência do Brasil", kind: "feriado" },
    { date: d(10, 12), label: "Nossa Senhora Aparecida", kind: "feriado" },
    { date: d(11, 2), label: "Finados", kind: "feriado" },
    { date: d(11, 15), label: "Proclamação da República", kind: "feriado" },
    { date: d(12, 25), label: "Natal", kind: "feriado" },
  ];
  // Lei 14.759/2023
  if (year >= 2024) out.push({ date: d(11, 20), label: "Dia Nacional de Zumbi e da Consciência Negra", kind: "feriado" });
  const e = easter(year);
  const rel = (n: number) => addDays(e, n);
  if (forensic.carnaval || forensic.federal) {
    out.push({ date: rel(-48), label: "Carnaval (segunda-feira)", kind: "feriado" });
    out.push({ date: rel(-47), label: "Carnaval (terça-feira)", kind: "feriado" });
  }
  if (forensic.cinzas) out.push({ date: rel(-46), label: "Quarta-feira de Cinzas (expediente reduzido)", kind: "parcial" });
  if (forensic.federal) out.push({ date: rel(-4), label: "Semana Santa (Lei 5.010/1966, art. 62, II)", kind: "feriado" });
  if (forensic.quintaSanta || forensic.federal) out.push({ date: rel(-3), label: "Quinta-feira Santa", kind: "feriado" });
  if (forensic.paixao || forensic.federal) out.push({ date: rel(-2), label: "Sexta-feira da Paixão", kind: "feriado" });
  if (forensic.corpus) out.push({ date: rel(60), label: "Corpus Christi", kind: "feriado" });
  if (forensic.federal) {
    out.push({ date: d(8, 11), label: "Feriado forense (Lei 5.010/1966, art. 62, IV)", kind: "feriado" });
    out.push({ date: d(11, 1), label: "Todos os Santos (Lei 5.010/1966, art. 62, IV)", kind: "feriado" });
    out.push({ date: d(12, 8), label: "Dia da Justiça (Lei 5.010/1966, art. 62, IV)", kind: "feriado" });
  }
  return out;
}

/** O feriado cadastrado vale para este dia? */
function holidayHits(h: Holiday, iso: string): boolean {
  if (!h.yearly) return h.end ? iso >= h.date && iso <= h.end : iso === h.date;
  const md = iso.slice(5);
  const start = h.date.slice(5);
  const end = (h.end || h.date).slice(5);
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

export interface CalendarOptions {
  holidays?: Holiday[];
  forensic?: Forensic;
  /** Tribunal do processo, para aplicar só os feriados locais dele. */
  court?: string;
  /** Considerar o recesso e a suspensão de 20/12 a 20/01 (CPC, art. 220; CLT, art. 775-A; CPP, art. 798-A). */
  recess?: boolean;
}

export function makeCalendar(opts: CalendarOptions = {}): Calendar {
  const forensic = opts.forensic || DEFAULT_FORENSIC;
  const recess = opts.recess !== false;
  const court = opts.court?.toUpperCase();
  const local = (opts.holidays || []).filter((h) => !h.courts?.length || (court && h.courts.some((c) => c.toUpperCase() === court)));
  const byYear = new Map<number, Map<string, Fixed[]>>();
  const fixedOf = (iso: string): Fixed[] => {
    const y = parts(iso).y;
    let map = byYear.get(y);
    if (!map) {
      map = new Map();
      for (const f of yearHolidays(y, forensic)) map.set(f.date, [...(map.get(f.date) || []), f]);
      byYear.set(y, map);
    }
    return map.get(iso) || [];
  };
  const cache = new Map<string, DayInfo>();

  const info = (iso: string): DayInfo => {
    const hit = cache.get(iso);
    if (hit) return hit;
    const reasons: string[] = [];
    let expedient = true;
    let partial = false;
    let suspended = false;
    const wd = weekday(iso);
    if (wd === 0 || wd === 6) {
      expedient = false;
      reasons.push(wd === 0 ? "domingo" : "sábado");
    }
    const list: Fixed[] = [...fixedOf(iso), ...local.filter((h) => holidayHits(h, iso))];
    for (const f of list) {
      if (f.kind === "feriado") expedient = false;
      else if (f.kind === "parcial") partial = true;
      else suspended = true;
      if (!reasons.includes(f.label)) reasons.push(f.label);
    }
    if (recess) {
      const md = iso.slice(5);
      if (md >= "12-20" || md <= "01-06") {
        expedient = false;
        suspended = true;
        reasons.push("Recesso forense (20/12 a 06/01)");
      } else if (md >= "01-07" && md <= "01-20") {
        suspended = true;
        reasons.push("Prazos suspensos até 20/01 (CPC, art. 220)");
      }
    }
    const out = { expedient, partial: expedient && partial, suspended, reasons };
    cache.set(iso, out);
    return out;
  };

  return {
    info,
    isBusiness: (iso) => info(iso).expedient,
    nextBusiness: (iso) => {
      let d = addDays(iso, 1);
      for (let i = 0; i < 400 && !info(d).expedient; i++) d = addDays(d, 1);
      return d;
    },
    counts: (iso) => {
      const i = info(iso);
      return i.expedient && !i.suspended;
    },
  };
}
