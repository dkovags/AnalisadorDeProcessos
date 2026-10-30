import { ChevronDown, CircleCheck, FileText, Gavel, Pencil, RotateCcw, Trash } from "lucide-react";
import { useState } from "react";
import { courtRef } from "../../domain/casefile";
import { formatDate, formatDateWeek } from "../../domain/dates";
import { CHANNELS, deadlineReport, NOTICE_KINDS, noticeDeadline, taskDue, taskInternalDue, urgencyOf, type DeadlineResult } from "../../domain/deadlines";
import { DOC_TYPES, TASK_KINDS, TASK_STATUS } from "../../domain/labels";
import { clientOf, docsOfCase, noticeForClient } from "../../domain/select";
import { excerpt, fold } from "../../domain/text";
import type { Doc, DocType, Notice, Task, TaskStatus } from "../../domain/types";
import * as A from "../../store/actions";
import { useData, useRun, useToday, useUI } from "../context";
import { CopyButton, DueBadge } from "./basics";

/** Memória de cálculo do prazo. */
export function DeadlineMemo({ r }: { r: DeadlineResult }) {
  const holidays = r.skipped.filter((s) => !/^(sábado|domingo)$/.test(s.text));
  return (
    <div className="memo">
      <ol>
        {r.steps.map((s, i) => (
          <li key={i}>
            <span className="memo-date">{formatDateWeek(s.date)}</span> {s.text}
          </li>
        ))}
      </ol>
      {holidays.length > 0 && (
        <div className="memo-skip">
          Não contados (além dos fins de semana): {holidays.map((s) => `${formatDate(s.date)} (${s.text})`).join("; ")}.
        </div>
      )}
      {r.due && <CopyButton text={deadlineReport(r)} label="Copiar a memória de cálculo" />}
    </div>
  );
}

const DOC_HINTS: [RegExp, DocType][] = [
  [/procura/, "procuracao"],
  [/contrato/, "contrato"],
  [/laudo|parecer do assistente/, "laudo"],
  [/comprovante|guia|preparo|custas|deposito/, "comprovante"],
  [/identidade|\brg\b|\bcpf\b|\bcnh\b|documento de identifica|documentos pessoais/, "pessoal"],
  [/certid/, "certidao"],
];

/** Documento da base que provavelmente atende o item da lista (ex.: "Procuração" → a procuração já juntada). */
export function suggestDoc(label: string, docs: Doc[]): Doc | undefined {
  const f = fold(label);
  const type = DOC_HINTS.find(([re]) => re.test(f))?.[1];
  if (!type) return undefined;
  return docs.find((d) => d.type === type);
}

export function TaskCard({ task }: { task: Task }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const today = useToday();
  const due = taskDue(ds, task, today);
  const internal = taskInternalDue(ds, task, today);
  const open = task.status === "pendente" || task.status === "elaboracao";
  const docs = docsOfCase(ds, task.caseId);
  const done = task.checklist.filter((i) => i.done).length;
  const notice = task.noticeId ? ds.notices[task.noticeId] : undefined;
  const hearing = task.kind === "audiencia";
  return (
    <article className={`item-card ${open ? "" : "closed"}`}>
      <header className="item-head">
        <div className="item-title">
          {hearing ? <Gavel size={16} /> : <FileText size={16} />}
          <strong>{task.title}</strong>
          <span className="chip tone-muted">{TASK_KINDS[task.kind]}</span>
        </div>
        <select
          className="mini-select"
          value={task.status}
          onChange={(e) => runAction(A.setTaskStatus, task.id, e.target.value as TaskStatus)}
          aria-label="Andamento da providência"
        >
          {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS[s]}
            </option>
          ))}
        </select>
      </header>
      <div className="item-dates">
        {due ? (
          <>
            <span>
              {hearing ? "Data" : "Prazo fatal"}: <strong>{formatDateWeek(due)}</strong>
              {hearing && notice?.hearing?.time ? ` às ${notice.hearing.time}` : ""}
            </span>
            {open && <DueBadge due={due} today={today} urgency={urgencyOf(today, due)} />}
            {!hearing && internal && internal !== due && <span className="muted">Prazo interno: {formatDate(internal)}</span>}
          </>
        ) : (
          <span className="muted">Sem vencimento calculado (confira as datas do expediente).</span>
        )}
        {task.doneAt && <span className="chip tone-ok">protocolada em {formatDate(task.doneAt)}</span>}
      </div>
      {task.checklist.length > 0 && (
        <div className="checklist">
          <div className="checklist-title">
            {hearing ? "Preparação" : "Documentos para instruir a petição"} <span className="muted">({done} de {task.checklist.length})</span>
          </div>
          {task.checklist.map((i) => {
            const hint = !i.done ? suggestDoc(i.label, docs) : undefined;
            const linked = i.docId ? ds.docs[i.docId] : undefined;
            return (
              <div key={i.id} className="check-item">
                <label>
                  <input type="checkbox" checked={i.done} onChange={(e) => runAction(A.toggleCheck, task.id, i.id, e.target.checked)} />
                  <span className={i.done ? "done" : ""}>{i.label}</span>
                </label>
                {linked && (
                  <button className="link-btn small" onClick={() => ui.open({ type: "doc", docId: linked.id })}>
                    {linked.title}
                  </button>
                )}
                {hint && (
                  <button className="link-btn small" onClick={() => runAction(A.toggleCheck, task.id, i.id, true, hint.id)} title="Marcar com o documento que já está na base">
                    já está nos autos: {hint.title}
                    {courtRef(hint.courtId) ? ` (${courtRef(hint.courtId)})` : ""}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {(task.basis || task.notes) && (
        <div className="item-notes">
          {task.basis && <span className="muted">Fundamento: {task.basis}</span>}
          {task.notes && <p className="pre">{task.notes}</p>}
        </div>
      )}
      <footer className="item-actions">
        {open && !hearing && (
          <button className="btn btn-primary btn-sm" onClick={() => runAction(A.setTaskStatus, task.id, "protocolada") && ui.toast("Providência marcada como protocolada.")}>
            <CircleCheck size={15} /> Protocolada
          </button>
        )}
        {open && hearing && (
          <button className="btn btn-primary btn-sm" onClick={() => runAction(A.setTaskStatus, task.id, "protocolada") && ui.toast("Audiência marcada como realizada.")}>
            <CircleCheck size={15} /> Realizada
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => ui.open({ type: "task", taskId: task.id })}>
          <Pencil size={14} /> Editar
        </button>
        {notice && (
          <button className="btn btn-ghost btn-sm" onClick={() => ui.open({ type: "notice", noticeId: notice.id })}>
            Ver o expediente
          </button>
        )}
      </footer>
    </article>
  );
}

export function NoticeCard({ notice }: { notice: Notice }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const today = useToday();
  const [memo, setMemo] = useState(false);
  const [full, setFull] = useState(false);
  const c = ds.cases[notice.caseId];
  const r = noticeDeadline(ds, notice, today);
  const names = notice.recipients.map((id) => c?.parties.find((p) => p.id === id)?.name).filter(Boolean);
  const forClient = c ? noticeForClient(c, notice) : true;
  const client = c && clientOf(c);
  const open = notice.status === "aberto";
  const doc = notice.docId ? ds.docs[notice.docId] : undefined;
  return (
    <article className={`item-card ${open ? "" : "closed"}`}>
      <header className="item-head">
        <div className="item-title">
          <strong>
            {NOTICE_KINDS[notice.kind]}
            {notice.act ? `: ${notice.act}` : ""}
          </strong>
          <span className="chip tone-muted">{CHANNELS[notice.channel].label.split(" (")[0]}</span>
          {client && notice.recipients.length > 0 && (
            <span className={`chip ${forClient ? "tone-info" : "tone-muted"}`}>{forClient ? "para o cliente" : "para a parte contrária"}</span>
          )}
          {!open && <span className="chip tone-ok">{notice.status === "cumprido" ? "cumprido" : "encerrado"}</span>}
        </div>
      </header>
      {names.length > 0 && <div className="item-sub">Destinatário: {names.join(", ")}</div>}
      <div className="item-dates">
        <span>
          {notice.channel === "audiencia" ? "Audiência" : "Expedição"}: {formatDate(notice.sentAt)}
        </span>
        {notice.readAt && <span>Ciência: {formatDate(notice.readAt)}</span>}
        {notice.days ? (
          <span>
            Prazo: {notice.days} dias {notice.counting === "uteis" ? "úteis" : "corridos"}
            {notice.double ? " (em dobro)" : ""}
          </span>
        ) : (
          <span className="muted">Sem prazo</span>
        )}
        {r.due ? (
          <span>
            Vencimento: <strong>{formatDateWeek(r.due)}</strong>
          </span>
        ) : (
          r.pending && <span className="muted">{r.pending}</span>
        )}
        {open && r.due && <DueBadge due={r.due} today={today} urgency={urgencyOf(today, r.due)} />}
        {open && r.provisional && <span className="badge tone-info">ciência ficta prevista: se houver consulta antes, informe a data</span>}
      </div>
      {notice.hearing && (
        <div className="item-sub">
          <Gavel size={14} /> {notice.hearing.kind || "Audiência"}: {formatDateWeek(notice.hearing.date)}
          {notice.hearing.time ? ` às ${notice.hearing.time}` : ""}
          {notice.hearing.place ? ` · ${notice.hearing.place}` : ""}
        </div>
      )}
      {notice.content && (
        <div className="item-content">
          <p className="pre">{full ? notice.content : excerpt(notice.content, 260)}</p>
          {notice.content.length > 260 && (
            <button className="link-btn small" onClick={() => setFull(!full)}>
              {full ? "Mostrar menos" : "Mostrar tudo"}
            </button>
          )}
        </div>
      )}
      {memo && <DeadlineMemo r={r} />}
      <footer className="item-actions">
        {open && notice.days && (
          <button className="btn btn-ghost btn-sm" onClick={() => setMemo(!memo)}>
            <ChevronDown size={14} className={memo ? "rot" : ""} /> Memória de cálculo
          </button>
        )}
        {open ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => runAction(A.setNoticeStatus, notice.id, "cumprido")}>
              <CircleCheck size={14} /> Cumprido
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => runAction(A.setNoticeStatus, notice.id, "encerrado") && ui.toast("Expediente encerrado (sem manifestação ou só ciência).")}
            >
              Encerrar
            </button>
          </>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => runAction(A.setNoticeStatus, notice.id, "aberto")}>
            <RotateCcw size={14} /> Reabrir
          </button>
        )}
        {doc && (
          <button className="btn btn-ghost btn-sm" onClick={() => ui.open({ type: "doc", docId: doc.id })}>
            <FileText size={14} /> {DOC_TYPES[doc.type]}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => ui.open({ type: "notice", noticeId: notice.id })}>
          <Pencil size={14} /> Editar
        </button>
        <button
          className="icon-btn small"
          aria-label="Apagar o expediente"
          title="Apagar o expediente"
          onClick={() =>
            ui.open({
              type: "confirm",
              title: "Apagar o expediente?",
              message: "As providências criadas a partir dele também serão apagadas. O documento continua na base.",
              confirmLabel: "Apagar",
              danger: true,
              onConfirm: () => runAction(A.deleteNotice, notice.id),
            })
          }
        >
          <Trash size={15} />
        </button>
      </footer>
    </article>
  );
}
