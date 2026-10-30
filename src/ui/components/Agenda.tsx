import { CalendarClock, CircleCheck, FileText, Gavel, Hourglass, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { formatDate, parts } from "../../domain/dates";
import { URGENCY_LABEL, type Urgency } from "../../domain/deadlines";
import { agenda, caseLabel, type AgendaItem } from "../../domain/select";
import * as A from "../../store/actions";
import { useData, useRun, useToday, useUI } from "../context";
import { casePath, href } from "../router";
import { DueBadge } from "./basics";

const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

function DateTile({ iso, urgency }: { iso?: string; urgency: Urgency }) {
  if (!iso)
    return (
      <div className="date-tile tone-muted">
        <Hourglass size={18} />
      </div>
    );
  const { m, d } = parts(iso);
  return (
    <div className={`date-tile u-${urgency}`}>
      <span className="date-mon">{MONTHS[m - 1]}</span>
      <span className="date-day">{d}</span>
    </div>
  );
}

export function AgendaRow({ item, showCase = true }: { item: AgendaItem; showCase?: boolean }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const today = useToday();
  const c = ds.cases[item.caseId];
  const open = () => {
    if (item.kind === "task" || (item.kind === "hearing" && ds.tasks[item.id])) ui.open({ type: "task", taskId: item.id });
    else ui.open({ type: "notice", noticeId: item.noticeId || item.id });
  };
  const internalSoon = item.kind === "task" && item.internal && item.internal !== item.due && (item.internalUrgency === "vencido" || item.internalUrgency === "hoje");
  return (
    <div className={`agenda-row ${item.urgency === "vencido" ? "overdue" : ""}`}>
      <DateTile iso={item.due} urgency={item.urgency} />
      <button className="agenda-main" onClick={open}>
        <div className="agenda-title">
          {item.kind === "hearing" ? <Gavel size={15} /> : item.petition ? <FileText size={15} /> : <CalendarClock size={15} />}
          <span>{item.title}</span>
          {item.time && <span className="agenda-time">{item.time}</span>}
        </div>
        {showCase && c && (
          <div className="agenda-case">
            {caseLabel(c)} <span className="muted">· {c.number}</span>
          </div>
        )}
        <div className="agenda-meta">
          {item.due ? (
            <DueBadge due={item.due} today={today} urgency={item.urgency} label={item.kind === "hearing" ? undefined : "prazo fatal"} />
          ) : (
            <span className="badge tone-muted">{item.pending || "sem vencimento"}</span>
          )}
          {item.kind === "task" && item.internal && item.internal !== item.due && (
            <span className={`badge ${internalSoon ? "tone-warn" : "tone-muted"}`}>prazo interno {formatDate(item.internal)}</span>
          )}
          {item.totalDocs > 0 && (
            <span className={`badge ${item.missingDocs ? "tone-warn" : "tone-ok"}`}>
              {item.kind === "hearing"
                ? `preparação: ${item.totalDocs - item.missingDocs} de ${item.totalDocs}`
                : item.missingDocs
                  ? `instruir: ${item.missingDocs === 1 ? "falta 1" : `faltam ${item.missingDocs}`} de ${item.totalDocs} ${item.totalDocs === 1 ? "documento" : "documentos"}`
                  : "documentos prontos"}
            </span>
          )}
          {item.provisional && <span className="badge tone-info">ciência ficta: confira a data da ciência</span>}
          {item.place && (
            <span className="badge tone-muted">
              <MapPin size={12} /> {item.place.length > 40 ? "link da sala virtual" : item.place}
            </span>
          )}
        </div>
      </button>
      {item.kind === "task" && (
        <button
          className="btn btn-ghost btn-sm agenda-done"
          title="Marcar como protocolada"
          onClick={() => runAction(A.setTaskStatus, item.id, "protocolada") && ui.toast(`"${item.title}" marcada como protocolada.`)}
        >
          <CircleCheck size={16} />
          <span className="hide-sm">Protocolada</span>
        </button>
      )}
      {showCase && c && (
        <a className="sr-only" href={href(casePath(c.id, "prazos"))}>
          Abrir o processo
        </a>
      )}
    </div>
  );
}

const ORDER: Urgency[] = ["vencido", "hoje", "amanha", "semana", "futuro", "sem"];

/** Prazos e audiências agrupados por urgência. */
export function AgendaList({ items, showCase = true, empty }: { items: AgendaItem[]; showCase?: boolean; empty?: ReactNode }) {
  if (!items.length) return <>{empty}</>;
  const groups = ORDER.map((u) => ({ u, list: items.filter((i) => i.urgency === u) })).filter((g) => g.list.length);
  return (
    <div className="agenda">
      {groups.map((g) => (
        <section key={g.u} className="agenda-group">
          <h3 className={`agenda-group-title u-${g.u}`}>
            {URGENCY_LABEL[g.u]} <span className="muted">({g.list.length})</span>
          </h3>
          {g.list.map((i) => (
            <AgendaRow key={i.key} item={i} showCase={showCase} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function useAgenda(): AgendaItem[] {
  const ds = useData();
  const today = useToday();
  return agenda(ds, today);
}
