import { CalendarPlus, ClipboardPaste, ListChecks, UserCheck } from "lucide-react";
import { useState } from "react";
import { APP_NAME } from "../../../config";
import { formatDate } from "../../../domain/dates";
import { noticeDeadline, urgencyOf } from "../../../domain/deadlines";
import { POLES } from "../../../domain/labels";
import { noticesOfCase, tasksOfCase } from "../../../domain/select";
import type { Case, Dataset, Notice } from "../../../domain/types";
import { DueBadge, Empty } from "../../components/basics";
import { NoticeCard, TaskCard } from "../../components/Cards";
import { useData, useToday, useUI } from "../../context";

/** Expedientes de cada parte: quantos em aberto, a última ciência e o próximo vencimento. */
function ByParty({ c, ds, notices }: { c: Case; ds: Dataset; notices: Notice[] }) {
  const today = useToday();
  const rows = c.parties
    .map((p) => {
      const mine = notices.filter((n) => n.recipients.includes(p.id));
      const open = mine.filter((n) => n.status === "aberto");
      const dues = open.map((n) => noticeDeadline(ds, n, today).due).filter(Boolean).sort() as string[];
      const lastRead = mine.map((n) => n.readAt || n.sentAt).sort().at(-1);
      return { p, total: mine.length, open: open.length, next: dues[0], lastRead };
    })
    .filter((r) => r.total > 0);
  if (!rows.length) return null;
  return (
    <section className="card by-party">
      <div className="card-head">
        <h2>Expedientes por parte</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Parte</th>
              <th>Em aberto</th>
              <th>Último expediente</th>
              <th>Próximo vencimento</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, total, open, next, lastRead }) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  {p.client && <UserCheck size={14} className="client-icon" aria-label="cliente" />}
                  <div className="muted small">
                    {p.role || POLES[p.pole]} · {total} {total === 1 ? "expediente" : "expedientes"}
                  </div>
                </td>
                <td>{open}</td>
                <td>{lastRead ? formatDate(lastRead) : "–"}</td>
                <td>{next ? <DueBadge due={next} today={today} urgency={urgencyOf(today, next)} /> : <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CaseDeadlines({ c }: { c: Case }) {
  const ds = useData();
  const ui = useUI();
  const [showClosed, setShowClosed] = useState(false);
  const tasks = tasksOfCase(ds, c.id);
  const notices = noticesOfCase(ds, c.id);
  const openTasks = tasks.filter((t) => t.status === "pendente" || t.status === "elaboracao");
  const openNotices = notices.filter((n) => n.status === "aberto");
  const closed = tasks.length - openTasks.length + notices.length - openNotices.length;
  return (
    <div className="tab-body">
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => ui.open({ type: "notice", caseId: c.id })}>
          <CalendarPlus size={17} /> Novo expediente
        </button>
        <button className="btn btn-ghost" onClick={() => ui.open({ type: "notice", caseId: c.id, text: "" })}>
          <ClipboardPaste size={17} /> Colar intimação
        </button>
        <button className="btn btn-ghost" onClick={() => ui.open({ type: "task", caseId: c.id })}>
          <ListChecks size={17} /> Nova providência
        </button>
      </div>
      <ByParty c={c} ds={ds} notices={notices} />
      {!tasks.length && !notices.length && (
        <Empty icon={<CalendarPlus size={28} />} title="Nenhum expediente registrado">
          Registre as intimações, citações e notificações de cada parte. O {APP_NAME} calcula o prazo, diz se é preciso peticionar e lista os documentos para
          instruir a petição.
        </Empty>
      )}
      {openTasks.length > 0 && (
        <section className="section">
          <h3 className="section-title">Providências a fazer</h3>
          {openTasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </section>
      )}
      {openNotices.length > 0 && (
        <section className="section">
          <h3 className="section-title">Expedientes em aberto</h3>
          {openNotices.map((n) => (
            <NoticeCard key={n.id} notice={n} />
          ))}
        </section>
      )}
      {closed > 0 && (
        <section className="section">
          <button className="link-btn" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "Esconder" : "Mostrar"} os concluídos ({closed})
          </button>
          {showClosed && (
            <>
              {tasks
                .filter((t) => !openTasks.includes(t))
                .map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
              {notices
                .filter((n) => !openNotices.includes(n))
                .map((n) => (
                  <NoticeCard key={n.id} notice={n} />
                ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
