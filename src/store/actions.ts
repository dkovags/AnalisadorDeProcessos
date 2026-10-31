import { analyze } from "../domain/analysis";
import type { CaseFileInfo } from "../domain/casefile";
import { checkCaseNumber, digitsOf, normalizeCaseNumber, parseCnj } from "../domain/cnj";
import { formatDate, isValidISO } from "../domain/dates";
import { RITES } from "../domain/deadlines";
import { STATUS } from "../domain/labels";
import { noticeDraft } from "../domain/noticedraft";
import { precedentKey } from "../domain/precedents";
import { fold, isUpper, sameParty, squash, titleCase } from "../domain/text";
import type {
  Case, CaseStatus, ChecklistItem, Dataset, Doc, DocType, FileMeta, HistoryEntry, Holiday, ID, Notice, NoticeStatus, Party, Pole, Precedent, Prefs,
  Rite, Task, TaskKind, TaskStatus,
} from "../domain/types";
import { applyOps, del, put, type Op } from "./ops";

// Ações: funções puras que recebem os dados atuais e devolvem as alterações (ops) e um valor.
// Entradas inválidas geram UserError, com a mensagem para mostrar à pessoa.

export interface Ctx {
  now: string;
  today: string;
  id: (prefix?: string) => string;
}

export interface Result<T> {
  ops: Op[];
  value: T;
}

export class UserError extends Error {}

const clean = (s: string | undefined) => (s && squash(s)) || undefined;
const cleanText = (s: string | undefined) => (s && s.trim()) || undefined;

/* ---------- processos ---------- */

export type CaseInput = Omit<Case, "id" | "history" | "createdAt" | "updatedAt"> & { id?: ID };

function sameNumber(a: string, b: string): boolean {
  const da = digitsOf(a);
  return da.length >= 15 ? da === digitsOf(b) : a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function findCaseByNumber(ds: Dataset, number: string): Case | undefined {
  return Object.values(ds.cases).find((c) => sameNumber(c.number, number));
}

function cleanParties(ctx: Ctx, parties: Party[]): Party[] {
  return parties
    .filter((p) => p.name.trim())
    .map((p) => ({ ...p, id: p.id || ctx.id("pt"), name: squash(p.name), role: clean(p.role), doc: clean(p.doc), lawyers: cleanText(p.lawyers) }));
}

export function saveCase(ds: Dataset, ctx: Ctx, input: CaseInput): Result<ID> {
  const number = normalizeCaseNumber(input.number || "");
  if (!number) throw new UserError("Informe o número do processo.");
  const dup = Object.values(ds.cases).find((c) => c.id !== input.id && sameNumber(c.number, number));
  if (dup) throw new UserError(`Já existe um processo com o número ${dup.number}.`);
  if (input.filedAt && !isValidISO(input.filedAt)) throw new UserError("Data de distribuição inválida.");
  const prev = input.id ? ds.cases[input.id] : undefined;
  if (input.id && !prev) throw new UserError("Processo não encontrado.");
  const court = clean(input.court)?.toUpperCase() || checkCaseNumber(number)?.court;
  const history = [...(prev?.history || [])];
  if (prev && prev.status !== input.status)
    history.push({ id: ctx.id("h"), date: ctx.today, at: ctx.now, kind: "status", text: `Situação: ${STATUS[prev.status].label} → ${STATUS[input.status].label}` });
  const c: Case = {
    ...input,
    id: prev?.id || ctx.id("c"),
    number,
    title: clean(input.title),
    court,
    system: clean(input.system),
    body: clean(input.body),
    className: clean(input.className),
    subjects: clean(input.subjects),
    outcome: clean(input.outcome),
    notes: cleanText(input.notes),
    parties: cleanParties(ctx, input.parties || []),
    history,
    createdAt: prev?.createdAt || ctx.now,
    updatedAt: ctx.now,
  };
  return { ops: [put("cases", c)], value: c.id };
}

export function setCaseStatus(ds: Dataset, ctx: Ctx, caseId: ID, status: CaseStatus, note?: string): Result<void> {
  const c = ds.cases[caseId];
  if (!c) throw new UserError("Processo não encontrado.");
  if (c.status === status) return { ops: [], value: undefined };
  const text = `Situação: ${STATUS[c.status].label} → ${STATUS[status].label}${note ? `. ${note.trim()}` : ""}`;
  const next: Case = { ...c, status, history: [...c.history, { id: ctx.id("h"), date: ctx.today, at: ctx.now, kind: "status", text }], updatedAt: ctx.now };
  return { ops: [put("cases", next)], value: undefined };
}

export function addNote(ds: Dataset, ctx: Ctx, caseId: ID, note: { date: string; text: string }): Result<void> {
  const c = ds.cases[caseId];
  if (!c) throw new UserError("Processo não encontrado.");
  if (!note.text.trim()) throw new UserError("Escreva a anotação.");
  if (!isValidISO(note.date)) throw new UserError("Data inválida.");
  const next: Case = { ...c, history: [...c.history, { id: ctx.id("h"), date: note.date, at: ctx.now, kind: "nota", text: note.text.trim() }], updatedAt: ctx.now };
  return { ops: [put("cases", next)], value: undefined };
}

export function deleteHistory(ds: Dataset, ctx: Ctx, caseId: ID, entryId: ID): Result<void> {
  const c = ds.cases[caseId];
  if (!c) return { ops: [], value: undefined };
  const ref = c.history.find((h) => h.id === entryId)?.ref;
  return { ops: [put("cases", { ...c, history: c.history.filter((h) => h.id !== entryId), updatedAt: ctx.now }), ...ignoreOps(ds, [ref])], value: undefined };
}

/** Guarda as origens apagadas pela pessoa, para a busca no CNJ não registrá-las de novo. */
function ignoreOps(ds: Dataset, refs: (string | undefined)[]): Op[] {
  const list = refs.filter((r): r is string => !!r && /^(djen|datajud):/.test(r));
  if (!list.length) return [];
  const cnj = ds.prefs.cnj || {};
  const ignored = [...new Set([...(cnj.ignored || []), ...list])].slice(-1000);
  return [{ t: "prefs", v: { ...ds.prefs, cnj: { ...cnj, ignored } } }];
}

/** Arquivos que deixam de ter documentos depois de apagar os documentos indicados. */
function orphanFiles(ds: Dataset, removedDocs: Set<ID>): ID[] {
  const used = new Set<ID>();
  for (const d of Object.values(ds.docs)) if (!removedDocs.has(d.id)) used.add(d.fileId);
  const candidates = new Set<ID>();
  for (const id of removedDocs) {
    const d = ds.docs[id];
    if (d && !used.has(d.fileId)) candidates.add(d.fileId);
  }
  return [...candidates].filter((id) => ds.files[id]);
}

/** Apaga documentos (com os separados de um processo integral), arquivos sem uso e referências a eles. */
function removeDocsOps(ds: Dataset, ctx: Ctx, ids: ID[]): Op[] {
  const removed = new Set<ID>();
  for (const id of ids) {
    if (!ds.docs[id]) continue;
    removed.add(id);
    for (const d of Object.values(ds.docs)) if (d.parentId === id) removed.add(d.id);
  }
  if (!removed.size) return [];
  const ops: Op[] = [...removed].map((id) => del("docs", id));
  for (const f of orphanFiles(ds, removed)) ops.push(del("files", f));
  for (const n of Object.values(ds.notices)) if (n.docId && removed.has(n.docId)) ops.push(put("notices", { ...n, docId: undefined, updatedAt: ctx.now }));
  for (const p of Object.values(ds.precedents)) if (p.docId && removed.has(p.docId)) ops.push(put("precedents", { ...p, docId: undefined, updatedAt: ctx.now }));
  for (const t of Object.values(ds.tasks))
    if (t.checklist.some((i) => i.docId && removed.has(i.docId)))
      ops.push(put("tasks", { ...t, checklist: t.checklist.map((i) => (i.docId && removed.has(i.docId) ? { ...i, docId: undefined } : i)), updatedAt: ctx.now }));
  return ops;
}

export function deleteCase(ds: Dataset, ctx: Ctx, caseId: ID): Result<void> {
  const c = ds.cases[caseId];
  if (!c) return { ops: [], value: undefined };
  const ops: Op[] = [del("cases", caseId)];
  // as comunicações do DJEN já registradas não voltam; as novas recriam o processo
  const refs = [...c.history.map((h) => h.ref), ...Object.values(ds.notices).filter((n) => n.caseId === caseId).map((n) => n.ref)];
  ops.push(...ignoreOps(ds, refs.filter((r) => r?.startsWith("djen:"))));
  for (const n of Object.values(ds.notices)) if (n.caseId === caseId) ops.push(del("notices", n.id));
  for (const t of Object.values(ds.tasks)) if (t.caseId === caseId) ops.push(del("tasks", t.id));
  const docs = Object.values(ds.docs).filter((d) => d.caseId === caseId).map((d) => d.id);
  const removed = new Set(docs);
  ops.push(...docs.map((id) => del("docs", id)));
  for (const f of orphanFiles(ds, removed)) ops.push(del("files", f));
  for (const p of Object.values(ds.precedents)) if (p.caseIds.includes(caseId)) ops.push(put("precedents", { ...p, caseIds: p.caseIds.filter((x) => x !== caseId), updatedAt: ctx.now }));
  return { ops, value: undefined };
}

/* ---------- expedientes ---------- */

export type NoticeInput = Omit<Notice, "id" | "createdAt" | "updatedAt" | "status"> & { id?: ID; status?: NoticeStatus };

export interface TaskDraft {
  title: string;
  kind: TaskKind;
  basis?: string;
  checklist: string[];
  notes?: string;
  due?: string;
}

function checklistOf(ctx: Ctx, labels: string[]): ChecklistItem[] {
  return labels.map((l) => squash(l)).filter(Boolean).map((label) => ({ id: ctx.id("i"), label, done: false }));
}

export function saveNotice(ds: Dataset, ctx: Ctx, input: NoticeInput, tasks: TaskDraft[] = []): Result<{ id: ID; taskIds: ID[] }> {
  if (!ds.cases[input.caseId]) throw new UserError("Escolha o processo do expediente.");
  if (!isValidISO(input.sentAt)) throw new UserError("Informe a data do expediente (expedição, disponibilização ou audiência).");
  if (input.readAt && !isValidISO(input.readAt)) throw new UserError("Data de ciência inválida.");
  if (input.readAt && input.readAt < input.sentAt) throw new UserError("A ciência não pode ser anterior ao envio.");
  if (input.dueOverride && !isValidISO(input.dueOverride)) throw new UserError("Vencimento inválido.");
  if (input.days !== undefined && (!Number.isInteger(input.days) || input.days < 1 || input.days > 730)) throw new UserError("Prazo em dias inválido.");
  if (input.hearing && !isValidISO(input.hearing.date)) throw new UserError("Data da audiência inválida.");
  const prev = input.id ? ds.notices[input.id] : undefined;
  const n: Notice = {
    ...input,
    id: prev?.id || ctx.id("n"),
    act: clean(input.act),
    basis: clean(input.basis),
    content: cleanText(input.content),
    notes: cleanText(input.notes),
    readAt: input.readAt || undefined,
    dueOverride: input.dueOverride || undefined,
    status: input.status || prev?.status || "aberto",
    createdAt: prev?.createdAt || ctx.now,
    updatedAt: ctx.now,
  };
  const ops: Op[] = [put("notices", n)];
  const taskIds: ID[] = [];
  for (const draft of tasks) {
    if (!draft.title.trim()) continue;
    const t: Task = {
      id: ctx.id("t"),
      caseId: n.caseId,
      noticeId: n.id,
      title: squash(draft.title),
      kind: draft.kind,
      due: draft.due || undefined,
      status: "pendente",
      checklist: checklistOf(ctx, draft.checklist),
      basis: clean(draft.basis),
      notes: cleanText(draft.notes),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    ops.push(put("tasks", t));
    taskIds.push(t.id);
  }
  return { ops, value: { id: n.id, taskIds } };
}

export function setNoticeStatus(ds: Dataset, ctx: Ctx, id: ID, status: NoticeStatus): Result<void> {
  const n = ds.notices[id];
  if (!n) throw new UserError("Expediente não encontrado.");
  const ops: Op[] = [put("notices", { ...n, status, closedAt: status === "aberto" ? undefined : ctx.today, updatedAt: ctx.now })];
  // prazo encerrado sem manifestação: as providências abertas perdem o objeto
  if (status === "encerrado")
    for (const t of Object.values(ds.tasks))
      if (t.noticeId === id && (t.status === "pendente" || t.status === "elaboracao")) ops.push(put("tasks", { ...t, status: "cancelada", updatedAt: ctx.now }));
  return { ops, value: undefined };
}

export function deleteNotice(ds: Dataset, _ctx: Ctx, id: ID): Result<void> {
  const n = ds.notices[id];
  if (!n) return { ops: [], value: undefined };
  const ops: Op[] = [del("notices", id)];
  for (const t of Object.values(ds.tasks)) if (t.noticeId === id) ops.push(del("tasks", t.id));
  ops.push(...ignoreOps(ds, [n.ref]));
  return { ops, value: undefined };
}

/** Expediente registrado pela busca no DJEN, conferido pela pessoa. */
export function reviewNotice(ds: Dataset, ctx: Ctx, id: ID): Result<void> {
  const n = ds.notices[id];
  if (!n) throw new UserError("Expediente não encontrado.");
  return { ops: n.review ? [put("notices", { ...n, review: undefined, updatedAt: ctx.now })] : [], value: undefined };
}

/* ---------- providências ---------- */

export type TaskInput = Omit<Task, "id" | "createdAt" | "updatedAt" | "checklist" | "status"> & {
  id?: ID;
  status?: TaskStatus;
  checklist: (Omit<ChecklistItem, "id"> & { id?: ID })[];
};

export function saveTask(ds: Dataset, ctx: Ctx, input: TaskInput): Result<ID> {
  if (!ds.cases[input.caseId]) throw new UserError("Escolha o processo da providência.");
  if (!input.title.trim()) throw new UserError("Diga qual é a providência (ex.: Réplica).");
  for (const d of [input.due, input.internalDue]) if (d && !isValidISO(d)) throw new UserError("Data inválida.");
  if (!input.due && !input.noticeId && input.kind !== "outro") throw new UserError("Informe o prazo (ou ligue a providência a um expediente).");
  const prev = input.id ? ds.tasks[input.id] : undefined;
  const t: Task = {
    ...input,
    id: prev?.id || ctx.id("t"),
    title: squash(input.title),
    due: input.due || undefined,
    internalDue: input.internalDue || undefined,
    basis: clean(input.basis),
    notes: cleanText(input.notes),
    status: input.status || prev?.status || "pendente",
    checklist: input.checklist.filter((i) => i.label.trim()).map((i) => ({ ...i, id: i.id || ctx.id("i"), label: squash(i.label) })),
    createdAt: prev?.createdAt || ctx.now,
    updatedAt: ctx.now,
  };
  return { ops: [put("tasks", t)], value: t.id };
}

export function setTaskStatus(ds: Dataset, ctx: Ctx, id: ID, status: TaskStatus): Result<void> {
  const t = ds.tasks[id];
  if (!t) throw new UserError("Providência não encontrada.");
  const next: Task = { ...t, status, doneAt: status === "protocolada" ? ctx.today : undefined, updatedAt: ctx.now };
  const ops: Op[] = [put("tasks", next)];
  // todas as providências do expediente resolvidas: expediente cumprido
  const n = t.noticeId ? ds.notices[t.noticeId] : undefined;
  if (n && n.status === "aberto" && status === "protocolada") {
    const siblings = Object.values(ds.tasks).filter((x) => x.noticeId === n.id && x.id !== id);
    if (siblings.every((x) => x.status === "protocolada" || x.status === "cancelada"))
      ops.push(put("notices", { ...n, status: "cumprido", closedAt: ctx.today, updatedAt: ctx.now }));
  }
  return { ops, value: undefined };
}

export function toggleCheck(ds: Dataset, ctx: Ctx, taskId: ID, itemId: ID, done: boolean, docId?: ID): Result<void> {
  const t = ds.tasks[taskId];
  if (!t) throw new UserError("Providência não encontrada.");
  const checklist = t.checklist.map((i) => (i.id === itemId ? { ...i, done, docId: done ? docId ?? i.docId : undefined } : i));
  return { ops: [put("tasks", { ...t, checklist, updatedAt: ctx.now })], value: undefined };
}

export function deleteTask(ds: Dataset, _ctx: Ctx, id: ID): Result<void> {
  return { ops: ds.tasks[id] ? [del("tasks", id)] : [], value: undefined };
}

/* ---------- documentos ---------- */

export interface DocDraft {
  title: string;
  type: DocType;
  date?: string;
  courtId?: string;
  signer?: string;
  pages?: [number, number];
}

/** Registra um arquivo já guardado e os documentos dele. Com vários documentos, cria o "processo integral" que os agrupa. */
export function addDocs(
  ds: Dataset,
  ctx: Ctx,
  input: { file: FileMeta; caseId?: ID; precedentId?: ID; docs: DocDraft[]; origin?: Doc["origin"] },
): Result<ID[]> {
  if (input.caseId && !ds.cases[input.caseId]) throw new UserError("Processo não encontrado.");
  if (!input.docs.length) throw new UserError("Nenhum documento para guardar.");
  const ops: Op[] = [put("files", input.file)];
  const ids: ID[] = [];
  const base = { caseId: input.caseId, precedentId: input.precedentId, fileId: input.file.id, createdAt: ctx.now };
  for (const d of input.docs) {
    const doc: Doc = {
      ...base,
      id: ctx.id("d"),
      title: squash(d.title) || input.file.name,
      type: d.type,
      date: d.date && isValidISO(d.date) ? d.date : undefined,
      courtId: d.courtId,
      signer: d.signer,
      pages: d.pages,
      origin: input.origin || "arquivo",
    };
    ops.push(put("docs", doc));
    ids.push(doc.id);
  }
  return { ops, value: ids };
}

/**
 * Importa o processo integral: cria (ou completa) o processo com os dados da capa e guarda cada documento.
 * Documentos que já estavam na base (mesmo Id. do tribunal) passam a apontar para o arquivo novo.
 */
export function importCaseFile(
  ds: Dataset,
  ctx: Ctx,
  input: { file: FileMeta; info: CaseFileInfo; caseId?: ID; create?: CaseInput },
): Result<{ caseId: ID; added: number; updated: number }> {
  const ops: Op[] = [];
  let caseId = input.caseId;
  const { info } = input;
  // movimentações (eventos do eproc) que ainda não estão nos andamentos
  const withEvents = (c: Case): Case => {
    const seen = new Set(c.history.map((h) => h.ref));
    const extra: HistoryEntry[] = (info.events || [])
      .filter((e) => !seen.has(`evento:${e.n}`))
      .map((e) => ({ id: ctx.id("h"), date: e.date, at: ctx.now, kind: "evento", text: `Evento ${e.n}: ${e.text}`, ref: `evento:${e.n}` }));
    return extra.length ? { ...c, history: [...c.history, ...extra] } : c;
  };
  if (caseId) {
    const c = ds.cases[caseId];
    if (!c) throw new UserError("Processo não encontrado.");
    // completa as partes já cadastradas (CPF/CNPJ, tipo de pessoa, procuradores) sem mudar o que foi digitado
    const parties = c.parties.map((x) => {
      const f = info.parties.find((p) => sameParty(x.name, p.name));
      if (!f) return x;
      return {
        ...x,
        doc: x.doc || f.doc,
        kind: x.kind || f.kind,
        doubleTerm: x.doubleTerm ?? (f.kind === "publico" ? true : undefined),
        lawyers: x.lawyers || f.lawyers.join("\n") || undefined,
      };
    });
    for (const p of info.parties)
      if (!parties.some((x) => sameParty(x.name, p.name)))
        parties.push({
          id: ctx.id("pt"),
          name: p.name,
          role: p.role,
          pole: p.pole,
          lawyers: p.lawyers.join("\n") || undefined,
          doc: p.doc,
          kind: p.kind,
          doubleTerm: p.kind === "publico" || undefined,
        });
    ops.push(
      put("cases", withEvents({
        ...c,
        className: c.className || info.className,
        body: c.body || info.body,
        subjects: c.subjects || info.subjects,
        filedAt: c.filedAt || info.filedAt,
        value: c.value ?? info.value,
        system: c.system || info.system,
        freeJustice: c.freeJustice ?? info.freeJustice,
        secret: c.secret ?? info.secret,
        parties,
        updatedAt: ctx.now,
      })),
    );
  } else {
    if (!input.create) throw new UserError("Faltam os dados do processo.");
    const r = saveCase(ds, ctx, input.create);
    ops.push(...r.ops.map((o) => (o.t === "put" && o.c === "cases" ? put("cases", withEvents(o.v as Case)) : o)));
    caseId = r.value;
  }

  ops.push(put("files", input.file));
  const parent: Doc = {
    id: ctx.id("d"),
    caseId,
    fileId: input.file.id,
    title: `Processo integral${info.system ? ` (${info.system}${info.part ? `, parte ${info.part}` : ""})` : ""}`,
    type: "processo",
    origin: "arquivo",
    createdAt: ctx.now,
  };
  ops.push(put("docs", parent));
  // documento já na base: mesmo Id. do tribunal ou, sem Id. (capa), mesmo nome
  const keyOf = (d: { courtId?: string; title: string }) => d.courtId || `nome:${d.title}`;
  const existing = new Map<string, Doc>();
  for (const d of Object.values(ds.docs)) if (d.caseId === caseId && (d.courtId || d.origin === "processo")) existing.set(keyOf(d), d);
  let added = 0;
  let updated = 0;
  const repointed = new Set<ID>();
  for (const fd of info.docs) {
    if (fd.type === "processo") continue;
    const old = existing.get(keyOf(fd));
    if (old) {
      ops.push(put("docs", { ...old, fileId: input.file.id, pages: fd.pages, parentId: parent.id }));
      repointed.add(old.id);
      updated++;
    } else {
      ops.push(
        put("docs", {
          id: ctx.id("d"),
          caseId,
          fileId: input.file.id,
          pages: fd.pages,
          parentId: parent.id,
          title: fd.title,
          type: fd.type,
          date: fd.date,
          courtId: fd.courtId,
          signer: fd.signer,
          origin: "processo",
          createdAt: ctx.now,
        }),
      );
      added++;
    }
  }
  // processos integrais antigos que ficaram sem documentos próprios saem da base
  const stillUsed = new Set<ID>();
  for (const d of Object.values(ds.docs)) if (!repointed.has(d.id) && d.type !== "processo") stillUsed.add(d.fileId);
  for (const d of Object.values(ds.docs))
    if (d.caseId === caseId && d.type === "processo" && !stillUsed.has(d.fileId)) ops.push(del("docs", d.id), del("files", d.fileId));
  return { ops, value: { caseId: caseId!, added, updated } };
}

export function updateDoc(ds: Dataset, _ctx: Ctx, id: ID, patch: Partial<Pick<Doc, "title" | "type" | "date" | "caseId">>): Result<void> {
  const d = ds.docs[id];
  if (!d) throw new UserError("Documento não encontrado.");
  if (patch.date && !isValidISO(patch.date)) throw new UserError("Data inválida.");
  if (patch.title !== undefined && !patch.title.trim()) throw new UserError("Dê um nome ao documento.");
  return { ops: [put("docs", { ...d, ...patch, title: patch.title !== undefined ? squash(patch.title) : d.title })], value: undefined };
}

export function deleteDoc(ds: Dataset, ctx: Ctx, id: ID): Result<void> {
  return { ops: removeDocsOps(ds, ctx, [id]), value: undefined };
}

/* ---------- jurisprudência ---------- */

export type PrecedentInput = Omit<Precedent, "id" | "createdAt" | "updatedAt"> & { id?: ID };

export function findPrecedent(ds: Dataset, p: Pick<Precedent, "court" | "className" | "number">, exceptId?: ID): Precedent | undefined {
  const key = precedentKey(p);
  return Object.values(ds.precedents).find((x) => x.id !== exceptId && precedentKey(x) === key);
}

export function savePrecedent(ds: Dataset, ctx: Ctx, input: PrecedentInput): Result<ID> {
  const court = clean(input.court)?.toUpperCase().replace(/^TJ-/, "TJ");
  if (!court) throw new UserError("Informe o tribunal.");
  if (!clean(input.className)) throw new UserError("Informe a classe (ex.: REsp, Apelação Cível, Súmula).");
  if (!clean(input.number)) throw new UserError("Informe o número.");
  for (const d of [input.judgedAt, input.publishedAt, input.checkedAt]) if (d && !isValidISO(d)) throw new UserError("Data inválida.");
  if (input.judgedAt && input.publishedAt && input.publishedAt < input.judgedAt) throw new UserError("A publicação não pode ser anterior ao julgamento.");
  const dup = findPrecedent(ds, { court, className: input.className, number: input.number }, input.id);
  if (dup) throw new UserError(`Esta decisão já está na base (${dup.className} ${dup.number}).`);
  const prev = input.id ? ds.precedents[input.id] : undefined;
  const p: Precedent = {
    ...input,
    id: prev?.id || ctx.id("j"),
    court,
    className: squash(input.className),
    number: squash(input.number),
    uf: clean(input.uf)?.toUpperCase(),
    rapporteur: clean(input.rapporteur),
    rapporteurForJudgment: clean(input.rapporteurForJudgment),
    body: clean(input.body),
    source: clean(input.source),
    summary: cleanText(input.summary),
    thesis: cleanText(input.thesis),
    bindingNumber: clean(input.bindingNumber),
    url: clean(input.url),
    notes: cleanText(input.notes),
    topics: (input.topics || []).map((t) => squash(t)).filter(Boolean),
    parties: (input.parties || []).filter((x) => x.name.trim()).map((x) => ({ ...x, name: squash(x.name), role: squash(x.role) || "Parte" })),
    caseIds: [...new Set(input.caseIds || [])].filter((id) => ds.cases[id]),
    createdAt: prev?.createdAt || ctx.now,
    updatedAt: ctx.now,
  };
  return { ops: [put("precedents", p)], value: p.id };
}

export function deletePrecedent(ds: Dataset, ctx: Ctx, id: ID): Result<void> {
  const p = ds.precedents[id];
  if (!p) return { ops: [], value: undefined };
  const docs = Object.values(ds.docs).filter((d) => d.precedentId === id).map((d) => d.id);
  return { ops: [del("precedents", id), ...removeDocsOps(ds, ctx, docs)], value: undefined };
}

export function linkPrecedent(ds: Dataset, ctx: Ctx, id: ID, caseId: ID, linked: boolean): Result<void> {
  const p = ds.precedents[id];
  if (!p || !ds.cases[caseId]) throw new UserError("Decisão ou processo não encontrado.");
  const caseIds = linked ? [...new Set([...p.caseIds, caseId])] : p.caseIds.filter((x) => x !== caseId);
  return { ops: [put("precedents", { ...p, caseIds, updatedAt: ctx.now })], value: undefined };
}

/** Liga o inteiro teor (documento da base) à decisão. */
export function setPrecedentDoc(ds: Dataset, ctx: Ctx, id: ID, docId: ID | undefined): Result<void> {
  const p = ds.precedents[id];
  if (!p) throw new UserError("Decisão não encontrada.");
  return { ops: [put("precedents", { ...p, docId, updatedAt: ctx.now })], value: undefined };
}

export function setChecked(ds: Dataset, ctx: Ctx, id: ID, checked: boolean): Result<void> {
  const p = ds.precedents[id];
  if (!p) throw new UserError("Decisão não encontrada.");
  return { ops: [put("precedents", { ...p, checkedAt: checked ? ctx.today : undefined, updatedAt: ctx.now })], value: undefined };
}

/* ---------- preferências ---------- */

export function savePrefs(ds: Dataset, _ctx: Ctx, patch: Partial<Prefs>): Result<void> {
  const next = { ...ds.prefs, ...patch };
  if (!Number.isInteger(next.marginDays) || next.marginDays < 0 || next.marginDays > 30) throw new UserError("Antecedência inválida (0 a 30 dias úteis).");
  return { ops: [{ t: "prefs", v: next }], value: undefined };
}

export function addHoliday(ds: Dataset, ctx: Ctx, h: Omit<Holiday, "id">): Result<void> {
  if (!isValidISO(h.date) || (h.end && !isValidISO(h.end))) throw new UserError("Data inválida.");
  if (h.end && h.end < h.date) throw new UserError("O fim do período é anterior ao início.");
  if (!h.label.trim()) throw new UserError("Diga o motivo (ex.: feriado municipal, suspensão de prazos).");
  const holiday: Holiday = { ...h, id: ctx.id("f"), label: squash(h.label), end: h.end || undefined, courts: h.courts?.map((c) => c.trim().toUpperCase()).filter(Boolean) };
  return { ops: [{ t: "prefs", v: { ...ds.prefs, holidays: [...ds.prefs.holidays, holiday].sort((a, b) => a.date.localeCompare(b.date)) } }], value: undefined };
}

export function removeHoliday(ds: Dataset, _ctx: Ctx, id: ID): Result<void> {
  return { ops: [{ t: "prefs", v: { ...ds.prefs, holidays: ds.prefs.holidays.filter((h) => h.id !== id) } }], value: undefined };
}

/* ---------- busca no CNJ (DJEN e DataJud) ---------- */

/** Comunicação do DJEN já lida (store/cnjapi: djenNotice). */
export interface DjenNotice {
  /** Identificador da comunicação no DJEN. */
  id: string;
  /** Disponibilização (AAAA-MM-DD). */
  date: string;
  number: string;
  court?: string;
  /** Intimação, Edital, Lista de distribuição... */
  kind?: string;
  /** Despacho, Decisão, Sentença... */
  docKind?: string;
  /** Órgão julgador. */
  body?: string;
  className?: string;
  /** Publicada na Plataforma Nacional de Editais (e não no DJEN). */
  edital: boolean;
  link?: string;
  /** Teor, já sem HTML. */
  text: string;
  recipients: { name: string; pole: Pole }[];
  lawyers: { name: string; oab?: string; uf?: string }[];
  /** Cancelada pelo tribunal. */
  cancelled: boolean;
}

export interface DjenImport {
  /** Expedientes registrados. */
  notices: number;
  /** Processos cadastrados (não estavam na base). */
  cases: number;
  /** Distribuições registradas nos andamentos. */
  events: number;
  /** Já registradas antes, apagadas pela pessoa ou canceladas pelo tribunal. */
  skipped: number;
  /** Comunicações que não deu para registrar (dados fora do esperado); a próxima busca tenta de novo. */
  failed: number;
}

const POLE_TEXT: Record<Pole, string> = { ativo: "polo ativo", passivo: "polo passivo", terceiro: "terceiro" };

const niceName = (s: string) => (isUpper(s) ? titleCase(s) : squash(s));

/** Linha "Tipo de comunicação", no formato que a análise entende ("Intimação (Sentença)"). */
function djenKindLine(n: DjenNotice): string {
  const kind = n.kind || "Intimação";
  return `Tipo de comunicação: ${kind}${n.docKind && fold(n.docKind) !== fold(kind) ? ` (${n.docKind})` : ""}`;
}

const recipientsLine = (n: DjenNotice) => `Destinatários: ${n.recipients.map((r) => `${r.name} (${POLE_TEXT[r.pole]})`).join("; ")}`;

/** Teor do expediente: os dados da comunicação no alto e o texto publicado. */
export function djenContent(n: DjenNotice): string {
  const lines = [
    djenKindLine(n),
    `Processo: ${normalizeCaseNumber(n.number)}${n.className ? ` (${niceName(n.className)})` : ""}`,
    n.body ? `Órgão: ${n.body}` : "",
    `Data de disponibilização: ${formatDate(n.date)} (${n.edital ? "Plataforma Nacional de Editais" : "DJEN"})`,
    n.recipients.length ? recipientsLine(n) : "",
    n.lawyers.length ? `Advogados: ${n.lawyers.map((l) => `${l.name}${l.oab ? ` (OAB ${l.oab}${l.uf ? `/${l.uf}` : ""})` : ""}`).join("; ")}` : "",
  ].filter(Boolean);
  return `${lines.join("\n")}\n\n${n.text}`.trim();
}

/** Rito provável, pelo ramo da Justiça (número CNJ), pelo órgão e pela classe. */
function djenRite(n: DjenNotice): Rite {
  const f = fold(`${n.body || ""} ${n.className || ""}`);
  if (parseCnj(n.number.replace(/\s/g, ""))?.j === "5") return "trabalho";
  if (/criminal|\bpena(l|is)\b|\bcrimes?\b|\bjuri\b|violencia domestica/.test(f)) return "penal";
  if (/juizado|turma recursal/.test(f)) return "juizado";
  return "civel";
}

/** Processo que ainda não está na base: as partes vêm dos destinatários da comunicação. */
function caseFromDjen(n: DjenNotice, today: string): CaseInput {
  const parties: Party[] = [];
  for (const r of n.recipients) {
    const name = niceName(r.name);
    if (/^sigil/.test(fold(name)) || parties.some((p) => sameParty(p.name, name))) continue;
    parties.push({ id: "", name, pole: r.pole });
  }
  // comunicação dirigida a uma só parte, pela OAB de quem usa: é o cliente
  if (parties.length === 1) parties[0].client = true;
  return {
    number: n.number,
    court: n.court,
    body: n.body,
    className: n.className ? niceName(n.className) : undefined,
    rite: djenRite(n),
    status: "ativo",
    parties,
    notes: `Cadastrado pela busca no DJEN em ${formatDate(today)}: confira as partes, o cliente e o rito.`,
  };
}

/** Expediente (e providências) de uma comunicação, com o ato e o prazo que a análise do texto sugere. */
function djenNoticeOps(ds: Dataset, ctx: Ctx, c: Case, n: DjenNotice, ref: string): Op[] {
  const head = [djenKindLine(n), n.recipients.length ? recipientsLine(n) : ""].filter(Boolean).join("\n");
  const a = analyze(`${head}\n\n${n.text}`.slice(0, 40000), { rite: c.rite });
  const d = noticeDraft(a, c);
  const notes: string[] = [];
  const twin = Object.values(ds.notices).find((x) => x.caseId === c.id && !x.ref && x.sentAt === n.date && (x.channel === "djen" || x.channel === "diario"));
  if (twin) notes.push(`Pode ser o mesmo expediente já registrado à mão${twin.act ? ` (${twin.act})` : ""}: confira e apague o repetido.`);
  if (d.status) notes.push(`O texto sugere mudar a situação do processo para "${STATUS[d.status].label}".`);
  if (n.link) notes.push(`Documento: ${n.link}`);
  const days = d.days && Number.isInteger(d.days) && d.days >= 1 && d.days <= 730 ? d.days : undefined;
  const hearing = d.hearing && isValidISO(d.hearing.date) ? d.hearing : undefined;
  const input: NoticeInput = {
    caseId: c.id,
    kind: d.kind || "intimacao",
    channel: n.edital ? "edital" : "djen",
    recipients: d.recipients,
    sentAt: n.date,
    days,
    counting: d.counting || RITES[c.rite].counting,
    double: d.double || undefined,
    fromHearing: d.fromHearing && hearing ? true : undefined,
    act: d.act,
    basis: d.basis,
    petition: !!d.petition,
    content: djenContent(n),
    hearing,
    notes: notes.join("\n") || undefined,
    ref,
    review: true,
  };
  const tasks: TaskDraft[] = d.tasks.filter((t) => t.on).map((t) => ({ title: t.title, kind: t.kind, basis: t.basis, checklist: t.checklist, notes: t.note }));
  try {
    return saveNotice(ds, ctx, input, tasks).ops;
  } catch {
    // algo da análise fora do esperado: registra a comunicação sem prazo, para a pessoa completar
    return saveNotice(ds, ctx, { ...input, days: undefined, hearing: undefined, fromHearing: undefined }, []).ops;
  }
}

/**
 * Registra as comunicações do DJEN. Cada intimação vira um expediente marcado para conferência, com o ato, o prazo e
 * as providências que a análise do texto sugere; a lista de distribuição vai para os andamentos. O processo que não
 * está na base é cadastrado com as partes da comunicação. Ficam de fora as comunicações já registradas, as apagadas
 * pela pessoa e as canceladas pelo tribunal. Com `day`, guarda a data da busca nas configurações.
 */
export function importDjen(ds: Dataset, ctx: Ctx, items: DjenNotice[], opts: { day?: string } = {}): Result<DjenImport> {
  const ops: Op[] = [];
  let cur = ds;
  const commit = (more: Op[]) => {
    ops.push(...more);
    cur = applyOps(cur, more);
  };
  const seen = new Set<string>(ds.prefs.cnj?.ignored || []);
  for (const n of Object.values(ds.notices)) if (n.ref) seen.add(n.ref);
  for (const c of Object.values(ds.cases)) for (const h of c.history) if (h.ref) seen.add(h.ref);
  const out: DjenImport = { notices: 0, cases: 0, events: 0, skipped: 0, failed: 0 };
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, "en", { numeric: true }));
  for (const n of sorted) {
    const ref = `djen:${n.id}`;
    const number = normalizeCaseNumber(n.number || "");
    if (seen.has(ref) || n.cancelled) {
      out.skipped++;
      continue;
    }
    // uma comunicação com dados fora do esperado não impede as outras: desfaz só o que ela começou
    const before = { cur, size: ops.length };
    try {
      if (!number || !isValidISO(n.date)) throw new UserError("Comunicação sem número de processo ou data.");
      let c = findCaseByNumber(cur, number);
      const created = !c;
      if (!c) {
        const r = saveCase(cur, ctx, caseFromDjen({ ...n, number }, ctx.today));
        commit(r.ops);
        c = cur.cases[r.value];
      }
      if (/distribuicao/.test(fold(n.kind || ""))) {
        const entry: HistoryEntry = { id: ctx.id("h"), date: n.date, at: ctx.now, kind: "evento", text: `${n.kind}: ${squash(n.text) || "processo distribuído"}`, ref };
        commit([put("cases", { ...c, history: [...c.history, entry], updatedAt: ctx.now })]);
        out.events++;
      } else {
        commit(djenNoticeOps(cur, ctx, c, n, ref));
        out.notices++;
      }
      if (created) out.cases++;
      seen.add(ref);
    } catch {
      cur = before.cur;
      ops.length = before.size;
      out.failed++;
    }
  }
  if (opts.day) {
    const cnj = cur.prefs.cnj || {};
    commit([{ t: "prefs", v: { ...cur.prefs, cnj: { ...cnj, lastRun: opts.day, lastCount: out.notices } } }]);
  }
  return { ops, value: out };
}

/** Movimentação do DataJud já em texto (store/cnjapi: datajudMovements). */
export interface MovementEntry {
  date: string;
  /** "175750" (para ordenar as do mesmo dia). */
  time?: string;
  /** Nome da movimentação na tabela do CNJ ("Conclusão", "Juntada de Petição"). */
  name: string;
  /** Nome com os complementos ("Juntada de Documento (Petição)"). */
  text: string;
  /** "datajud:<código>:<data e hora>" */
  ref: string;
}

/**
 * Registra nos andamentos as movimentações do DataJud que ainda não estão lá. Num processo importado do eproc, os
 * eventos do arquivo já cobrem as movimentações até o último deles: do DataJud entram só as posteriores.
 */
export function importMovements(ds: Dataset, ctx: Ctx, caseId: ID, entries: MovementEntry[]): Result<number> {
  const c = ds.cases[caseId];
  if (!c) throw new UserError("Processo não encontrado.");
  const skip = new Set<string>(ds.prefs.cnj?.ignored || []);
  for (const h of c.history) if (h.ref) skip.add(h.ref);
  const lastEvent = c.history.reduce((m, h) => (h.ref?.startsWith("evento:") && h.date > m ? h.date : m), "");
  const extra: HistoryEntry[] = [];
  for (const e of entries) {
    if (skip.has(e.ref) || !isValidISO(e.date) || (lastEvent && e.date <= lastEvent)) continue;
    // a mesma movimentação já anotada de outra fonte, no mesmo dia
    const name = fold(e.name);
    if (c.history.some((h) => h.date === e.date && h.kind === "evento" && !h.ref?.startsWith("datajud:") && fold(h.text).includes(name))) continue;
    skip.add(e.ref);
    extra.push({ id: ctx.id("h"), date: e.date, at: ctx.now, kind: "evento", text: e.text, ref: e.ref });
  }
  if (!extra.length) return { ops: [], value: 0 };
  return { ops: [put("cases", { ...c, history: [...c.history, ...extra], updatedAt: ctx.now })], value: extra.length };
}
