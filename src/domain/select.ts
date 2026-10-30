import { cachedCalendar, noticeDeadline, taskDue, taskInternalDue, urgencyOf, type Urgency } from "./deadlines";
import type { Case, Dataset, Doc, ID, Notice, Task } from "./types";

// Consultas sobre os dados: agenda de prazos e audiências, documentos e expedientes de cada processo.

export interface AgendaItem {
  key: string;
  kind: "task" | "notice" | "hearing";
  id: ID;
  caseId: ID;
  title: string;
  /** Prazo fatal ou data da audiência. */
  due?: string;
  /** Prazo interno (antecedência das configurações). */
  internal?: string;
  time?: string;
  place?: string;
  urgency: Urgency;
  /** Urgência pelo prazo interno (para avisar antes). */
  internalUrgency: Urgency;
  /** Documentos para instruir a petição ainda não marcados. */
  missingDocs: number;
  totalDocs: number;
  /** A ciência ainda pode acontecer (prazo calculado com a ciência ficta). */
  provisional?: boolean;
  /** Por que não há vencimento. */
  pending?: string;
  noticeId?: ID;
  petition: boolean;
}

const cache = new WeakMap<Dataset, Map<string, AgendaItem[]>>();

/** Prazos abertos e audiências marcadas, do mais urgente ao mais distante. */
export function agenda(ds: Dataset, today: string): AgendaItem[] {
  let byDay = cache.get(ds);
  if (!byDay) cache.set(ds, (byDay = new Map()));
  const hit = byDay.get(today);
  if (hit) return hit;
  const items: AgendaItem[] = [];
  const openTasks = Object.values(ds.tasks).filter((t) => (t.status === "pendente" || t.status === "elaboracao") && ds.cases[t.caseId]);
  const withTask = new Set(openTasks.map((t) => t.noticeId).filter(Boolean));
  const hearingTask = new Set(openTasks.filter((t) => t.kind === "audiencia").map((t) => t.noticeId).filter(Boolean));
  for (const t of openTasks) {
    const n = t.noticeId ? ds.notices[t.noticeId] : undefined;
    const due = taskDue(ds, t, today);
    const internal = taskInternalDue(ds, t, today);
    const dl = n && !t.due ? noticeDeadline(ds, n, today) : undefined;
    const hearing = t.kind === "audiencia";
    items.push({
      key: `t:${t.id}`,
      kind: hearing ? "hearing" : "task",
      id: t.id,
      caseId: t.caseId,
      title: t.title,
      due,
      internal: hearing ? undefined : internal,
      time: hearing ? n?.hearing?.time : undefined,
      place: hearing ? n?.hearing?.place : undefined,
      urgency: urgencyOf(today, due),
      internalUrgency: urgencyOf(today, hearing ? due : internal),
      missingDocs: t.checklist.filter((i) => !i.done).length,
      totalDocs: t.checklist.length,
      provisional: dl?.provisional,
      pending: !due ? dl?.pending : undefined,
      noticeId: t.noticeId,
      petition: !hearing && t.kind !== "outro",
    });
  }
  for (const n of Object.values(ds.notices)) {
    if (n.status !== "aberto" || !ds.cases[n.caseId]) continue;
    if (n.hearing && !hearingTask.has(n.id) && n.hearing.date >= today)
      items.push({
        key: `h:${n.id}`,
        kind: "hearing",
        id: n.id,
        caseId: n.caseId,
        title: n.hearing.kind || "Audiência",
        due: n.hearing.date,
        time: n.hearing.time,
        place: n.hearing.place,
        urgency: urgencyOf(today, n.hearing.date),
        internalUrgency: urgencyOf(today, n.hearing.date),
        missingDocs: 0,
        totalDocs: 0,
        noticeId: n.id,
        petition: false,
      });
    if (withTask.has(n.id) || (!n.days && !n.dueOverride)) continue;
    const dl = noticeDeadline(ds, n, today);
    items.push({
      key: `n:${n.id}`,
      kind: "notice",
      id: n.id,
      caseId: n.caseId,
      title: n.act || "Prazo do expediente",
      due: dl.due,
      urgency: urgencyOf(today, dl.due),
      internalUrgency: urgencyOf(today, dl.due),
      missingDocs: 0,
      totalDocs: 0,
      provisional: dl.provisional,
      pending: dl.due ? undefined : dl.pending,
      noticeId: n.id,
      petition: !!n.petition,
    });
  }
  items.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (a.time || "").localeCompare(b.time || ""));
  byDay.set(today, items);
  return items;
}

/** Próximo prazo de cada processo. */
export function nextDueByCase(ds: Dataset, today: string): Map<ID, AgendaItem> {
  const out = new Map<ID, AgendaItem>();
  for (const item of agenda(ds, today)) if (item.due && !out.has(item.caseId)) out.set(item.caseId, item);
  return out;
}

export function docsOfCase(ds: Dataset, caseId: ID): Doc[] {
  return Object.values(ds.docs)
    .filter((d) => d.caseId === caseId)
    .sort((a, b) => (b.date || b.createdAt.slice(0, 10)).localeCompare(a.date || a.createdAt.slice(0, 10)) || b.createdAt.localeCompare(a.createdAt));
}

export function noticesOfCase(ds: Dataset, caseId: ID): Notice[] {
  return Object.values(ds.notices)
    .filter((n) => n.caseId === caseId)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt) || b.createdAt.localeCompare(a.createdAt));
}

export function tasksOfCase(ds: Dataset, caseId: ID): Task[] {
  return Object.values(ds.tasks)
    .filter((t) => t.caseId === caseId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Nome curto do processo: o apelido, ou as partes principais. */
export function caseLabel(c: Case): string {
  if (c.title) return c.title;
  const a = c.parties.find((p) => p.pole === "ativo")?.name;
  const p = c.parties.find((x) => x.pole === "passivo")?.name;
  if (a && p) return `${a} x ${p}`;
  return a || p || c.number;
}

/** Cliente do escritório no processo (a parte marcada como cliente). */
export function clientOf(c: Case) {
  return c.parties.find((p) => p.client);
}

/** O expediente se dirige ao cliente? (sem cliente marcado ou sem destinatário, considera que sim) */
export function noticeForClient(c: Case, n: Notice): boolean {
  const client = clientOf(c);
  if (!client || !n.recipients.length) return true;
  return n.recipients.includes(client.id);
}

/** Calendário do processo, para telas que mostram dias úteis. */
export function caseCalendar(ds: Dataset, c?: Case) {
  return cachedCalendar(ds, c);
}
