import { CalendarClock, CircleCheck, Clock3, FileText, NotebookPen, Trash } from "lucide-react";
import type { ReactNode } from "react";
import { formatDate } from "../../../domain/dates";
import { NOTICE_KINDS } from "../../../domain/deadlines";
import { DOC_TYPES } from "../../../domain/labels";
import { docsOfCase, noticesOfCase, tasksOfCase } from "../../../domain/select";
import type { Case } from "../../../domain/types";
import * as A from "../../../store/actions";
import { Empty } from "../../components/basics";
import { useData, useRun, useUI } from "../../context";

interface Event {
  key: string;
  date: string;
  icon: ReactNode;
  text: string;
  sub?: string;
  onClick?: () => void;
  onDelete?: () => void;
}

/** Linha do tempo: documentos juntados, expedientes, providências protocoladas, mudanças de situação e anotações. */
export function CaseTimeline({ c }: { c: Case }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const events: Event[] = [];
  for (const h of c.history)
    events.push({
      key: `h${h.id}`,
      date: h.date,
      icon: h.kind === "status" ? <Clock3 size={16} /> : <NotebookPen size={16} />,
      text: h.text,
      sub: h.kind === "nota" ? "Anotação" : undefined,
      onDelete: () => runAction(A.deleteHistory, c.id, h.id),
    });
  for (const d of docsOfCase(ds, c.id))
    if (d.date && d.type !== "processo")
      events.push({ key: `d${d.id}`, date: d.date, icon: <FileText size={16} />, text: `${DOC_TYPES[d.type]}: ${d.title}`, sub: d.signer, onClick: () => ui.open({ type: "doc", docId: d.id }) });
  for (const n of noticesOfCase(ds, c.id))
    events.push({
      key: `n${n.id}`,
      date: n.sentAt,
      icon: <CalendarClock size={16} />,
      text: `${NOTICE_KINDS[n.kind]}${n.act ? `: ${n.act}` : ""}`,
      onClick: () => ui.open({ type: "notice", noticeId: n.id }),
    });
  for (const t of tasksOfCase(ds, c.id))
    if (t.doneAt)
      events.push({ key: `t${t.id}`, date: t.doneAt, icon: <CircleCheck size={16} />, text: `${t.kind === "audiencia" ? "Realizada" : "Protocolada"}: ${t.title}`, onClick: () => ui.open({ type: "task", taskId: t.id }) });
  events.sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="tab-body">
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => ui.open({ type: "note", caseId: c.id })}>
          <NotebookPen size={17} /> Nova anotação
        </button>
      </div>
      {!events.length ? (
        <Empty icon={<Clock3 size={28} />} title="Nada registrado ainda">
          Os documentos com data, os expedientes, as petições protocoladas e as mudanças de situação aparecem aqui, em ordem.
        </Empty>
      ) : (
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.key}>
              <span className="tl-date">{formatDate(e.date)}</span>
              <span className="tl-icon">{e.icon}</span>
              <div className="tl-body">
                {e.onClick ? (
                  <button className="link-btn" onClick={e.onClick}>
                    {e.text}
                  </button>
                ) : (
                  <span className="pre">{e.text}</span>
                )}
                {e.sub && <div className="muted small">{e.sub}</div>}
              </div>
              {e.onDelete && (
                <button className="icon-btn small" aria-label="Apagar" title="Apagar" onClick={e.onDelete}>
                  <Trash size={14} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
