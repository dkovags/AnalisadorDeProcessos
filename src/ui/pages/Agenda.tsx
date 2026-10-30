import { Bell, CalendarClock, CalendarDays, Calculator } from "lucide-react";
import { useState } from "react";
import { APP_NAME } from "../../config";
import { agendaToIcs } from "../../domain/exports";
import { caseLabel } from "../../domain/select";
import { AgendaList, useAgenda } from "../components/Agenda";
import { Empty } from "../components/basics";
import { PageHeader } from "../components/Shell";
import { useData, useRun, useToday, useUI } from "../context";
import { downloadFile } from "../download";
import * as A from "../../store/actions";
import { notifySupported, requestNotify } from "../notify";

export function AgendaPage() {
  const ds = useData();
  const ui = useUI();
  const today = useToday();
  const runAction = useRun();
  const items = useAgenda();
  const [kind, setKind] = useState<"todos" | "peticoes" | "audiencias">("todos");
  const [caseId, setCaseId] = useState("");
  const list = items
    .filter((i) => (kind === "peticoes" ? i.kind !== "hearing" : kind === "audiencias" ? i.kind === "hearing" : true))
    .filter((i) => !caseId || i.caseId === caseId);
  const casesWithItems = [...new Set(items.map((i) => i.caseId))].map((id) => ds.cases[id]).filter(Boolean);

  return (
    <div className="page">
      <PageHeader
        title="Prazos e audiências"
        subtitle={`Prazo interno: ${ds.prefs.marginDays} ${ds.prefs.marginDays === 1 ? "dia útil" : "dias úteis"} antes do fatal (mude em Configurações).`}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => ui.open({ type: "calculator" })}>
              <Calculator size={17} /> Calculadora
            </button>
            {notifySupported() && !ds.prefs.notify && (
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  if (await requestNotify()) {
                    runAction(A.savePrefs, { notify: true });
                    ui.toast(`Avisos ligados: o navegador avisa dos prazos do dia quando o ${APP_NAME} estiver aberto.`);
                  } else ui.toast("O navegador não permitiu os avisos.", { kind: "error" });
                }}
              >
                <Bell size={17} /> <span className="hide-sm">Ligar avisos</span>
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={!items.some((i) => i.due)}
              onClick={() => {
                downloadFile(`prazos-${today}.ics`, agendaToIcs(ds, today), "text/calendar;charset=utf-8");
                ui.toast("Abra o arquivo baixado para adicionar os prazos à sua agenda (Google, Outlook, celular).");
              }}
            >
              <CalendarDays size={17} /> <span className="hide-sm">Exportar para a agenda</span>
            </button>
          </>
        }
      />
      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Mostrar">
          {(
            [
              ["todos", "Tudo"],
              ["peticoes", "Prazos"],
              ["audiencias", "Audiências"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        {casesWithItems.length > 1 && (
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Processo">
            <option value="">Todos os processos</option>
            {casesWithItems.map((c) => (
              <option key={c.id} value={c.id}>
                {caseLabel(c)}
              </option>
            ))}
          </select>
        )}
      </div>
      <AgendaList
        items={list}
        empty={
          <Empty icon={<CalendarClock size={30} />} title="Nenhum prazo em aberto">
            Registre os expedientes nos processos (aba Expedientes e prazos): o {APP_NAME} calcula o vencimento e avisa o que precisa ser feito.
          </Empty>
        }
      />
    </div>
  );
}
