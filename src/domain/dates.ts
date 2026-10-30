// Datas no formato AAAA-MM-DD (sem fuso horário), usadas em prazos, expedientes e documentos.

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
/** Abreviaturas da ABNT (NBR 6023), usadas nas referências de jurisprudência. */
const MONTHS_ABNT = ["jan.", "fev.", "mar.", "abr.", "maio", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const WEEKDAYS_SHORT = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

const pad = (n: number) => String(n).padStart(2, "0");

export function monthName(m: number): string {
  return MONTHS[m - 1];
}

/** Data local de hoje. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function isValidISO(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parts(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Data válida de calendário (ex.: 31/02 não existe). */
export function validDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  const iso = toISO(y, m, d);
  return isValidISO(iso) ? iso : null;
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Dias corridos de a até b (positivo se b for depois). */
export function diffDays(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(iso: string): number {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[weekday(iso)];
}

/** "14/10/2026" */
export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const { y, m, d } = parts(iso);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** "14/10" */
export function formatDayMonth(iso: string): string {
  const { m, d } = parts(iso);
  return `${pad(d)}/${pad(m)}`;
}

/** "ter., 14/10/2026" */
export function formatDateWeek(iso: string): string {
  return `${WEEKDAYS_SHORT[weekday(iso)]}, ${formatDate(iso)}`;
}

/** "14 de outubro de 2026" */
export function formatDateLong(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${d === 1 ? "1º" : d} de ${MONTHS[m - 1]} de ${y}`;
}

/** "14 out. 2026" (ABNT) */
export function formatDateAbnt(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS_ABNT[m - 1]} ${y}`;
}

/** "14/10/2026 às 10:30" a partir de um carimbo de data e hora (ISO completo). */
export function formatDateTime(ts: string): string {
  const t = new Date(ts);
  return `${formatDate(todayISO(t))} às ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** "hoje", "amanhã", "ontem", "em 3 dias", "há 2 dias" */
export function relativeDay(iso: string, today: string): string {
  const n = diffDays(today, iso);
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "ontem";
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

/** Converte "dd/mm/aaaa" (ou com pontos e traços) digitado pela pessoa em AAAA-MM-DD. */
export function parseTypedDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return isValidISO(s.trim()) ? s.trim() : null;
}
