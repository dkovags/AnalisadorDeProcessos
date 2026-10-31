import { CalendarClock, CircleCheck, Clock3, FileText, Landmark, NotebookPen, RefreshCw, Trash } from "lucide-react";
import { useState, type ReactNode } from "react";
import { checkCaseNumber, digitsOf } from "../../../domain/cnj";
import { formatDate } from "../../../domain/dates";
import { NOTICE_KINDS } from "../../../domain/deadlines";
import { DOC_TYPES } from "../../../domain/labels";
import { docsOfCase, noticesOfCase, tasksOfCase } from "../../../domain/select";
import { fold } from "../../../domain/text";
import type { Case, Doc, HistoryEntry } from "../../../domain/types";
import * as A from "../../../store/actions";
import { CnjError, cnjReady, datajudMovements } from "../../../store/cnjapi";
import { plural } from "../../cnjsync";
import { Empty } from "../../components/basics";
import { useData, useRun, useUI } from "../../context";

interface Event {
  key: string;
  date: string;
  icon: ReactNode;
  text: string;
  sub?: string;
  /** No mesmo dia, os eventos mais novos do processo vêm antes. */
  order?: number;
  onClick?: () => void;
  onDelete?: () => void;
}

/** Número do evento do eproc na referência do documento ("Evento 12, PET1") ou do andamento ("evento:12"). */
const eventOf = (ref?: string) => Number(ref?.match(/^evento[ :](\d+)/i)?.[1]) || undefined;

/** Hora da movimentação do DataJud ("datajud:51:2026-03-13T175750" → 175750), para ordenar as do mesmo dia. */
const timeOf = (ref?: string) => Number(ref?.match(/^datajud:.*T(\d{6})$/)?.[1]) || undefined;

/** Origem do andamento, mostrada embaixo do texto. */
function sourceOf(h: HistoryEntry): string | undefined {
  if (h.ref?.startsWith("datajud:")) return "DataJud";
  if (h.ref?.startsWith("djen:")) return "DJEN";
  return h.kind === "nota" ? "Anotação" : undefined;
}

/** Busca as movimentações do processo no DataJud (pelo intermediário) e registra as novas nos andamentos. */
function DatajudButton({ c }: { c: Case }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const [busy, setBusy] = useState(false);
  const cnj = ds.prefs.cnj;
  const court = c.court || checkCaseNumber(c.number)?.court;
  if (!cnjReady(cnj) || !court || digitsOf(c.number).length !== 20) return null;
  const update = async () => {
    setBusy(true);
    try {
      const r = await datajudMovements(cnj, court, c.number);
      if (!r.found) {
        ui.toast("O DataJud não tem este processo (o CNJ demora a incluir os novos, e os em segredo de justiça não aparecem).", { kind: "error" });
        return;
      }
      const added = runAction(A.importMovements, c.id, r.entries);
      if (added === undefined) return;
      const when = r.updatedAt ? ` Dados do CNJ atualizados em ${formatDate(r.updatedAt.slice(0, 10))}.` : "";
      ui.toast(`${added ? plural(added, "andamento novo", "andamentos novos") : "Nenhum andamento novo"} no DataJud.${when}`);
    } catch (e) {
      ui.toast(e instanceof CnjError ? e.message : "Não foi possível buscar os andamentos.", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn-ghost" onClick={update} disabled={busy} title="Movimentações registradas pelo tribunal no DataJud, do CNJ">
      <RefreshCw size={17} className={busy ? "spin" : ""} /> {busy ? "Buscando no DataJud…" : "Atualizar andamentos (DataJud)"}
    </button>
  );
}

/**
 * Linha do tempo: movimentações do processo (eventos do eproc), documentos juntados, expedientes, providências
 * protocoladas, mudanças de situação e anotações. Os documentos de um evento aparecem junto com ele.
 */
export function CaseTimeline({ c }: { c: Case }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const events: Event[] = [];
  const docs = docsOfCase(ds, c.id).filter((d) => d.type !== "processo");
  const docsOfEvent = new Map<number, Doc[]>();
  for (const d of docs) {
    const n = eventOf(d.courtId);
    if (n) docsOfEvent.set(n, [...(docsOfEvent.get(n) || []), d]);
  }
  const shown = new Set<number>();
  for (const h of c.history) {
    const n = h.kind === "evento" ? eventOf(h.ref) : undefined;
    const own = n ? docsOfEvent.get(n) : undefined;
    if (n) shown.add(n);
    events.push({
      key: `h${h.id}`,
      date: h.date,
      icon: h.kind === "status" ? <Clock3 size={16} /> : h.kind === "evento" ? <Landmark size={16} /> : <NotebookPen size={16} />,
      text: h.text,
      sub: own ? own.map((d) => d.title).join(" · ") : sourceOf(h),
      order: n ?? timeOf(h.ref),
      onClick: own ? () => ui.open({ type: "doc", docId: own[0].id }) : undefined,
      onDelete: () => runAction(A.deleteHistory, c.id, h.id),
    });
  }
  for (const d of docs) {
    const n = eventOf(d.courtId);
    if (!d.date || (n && shown.has(n))) continue;
    // "Petição inicial: Petição inicial (INIC1)" fica só "Petição inicial (INIC1)"
    const text = fold(d.title).startsWith(fold(DOC_TYPES[d.type])) ? d.title : `${DOC_TYPES[d.type]}: ${d.title}`;
    events.push({ key: `d${d.id}`, date: d.date, icon: <FileText size={16} />, text, sub: d.signer, onClick: () => ui.open({ type: "doc", docId: d.id }) });
  }
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
  events.sort((a, b) => b.date.localeCompare(a.date) || (b.order ?? 0) - (a.order ?? 0));
  return (
    <div className="tab-body">
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => ui.open({ type: "note", caseId: c.id })}>
          <NotebookPen size={17} /> Nova anotação
        </button>
        <DatajudButton c={c} />
      </div>
      {!events.length ? (
        <Empty icon={<Clock3 size={28} />} title="Nada registrado ainda">
          As movimentações do processo, os documentos com data, os expedientes, as petições protocoladas e as mudanças de situação aparecem
          aqui, em ordem.
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
