import { useMemo, useState } from "react";
import { makeCalendar } from "../../domain/calendar";
import { relativeDay, formatDateWeek } from "../../domain/dates";
import { CHANNELS, computeDeadline } from "../../domain/deadlines";
import type { Channel, Counting, ID } from "../../domain/types";
import * as A from "../../store/actions";
import { Field, Modal } from "../components/basics";
import { DeadlineMemo } from "../components/Cards";
import { useData, useRun, useToday, useUI } from "../context";

export function NoteDialog({ caseId, onClose }: { caseId: ID; onClose: () => void }) {
  const today = useToday();
  const ui = useUI();
  const runAction = useRun();
  const [date, setDate] = useState(today);
  const [text, setText] = useState("");
  const save = () => {
    if (runAction(A.addNote, caseId, { date, text })) {
      onClose();
      ui.toast("Anotação registrada.");
    }
  };
  return (
    <Modal
      title="Nova anotação"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <Field label="Data">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Anotação" hint="Andamento, conversa com o cliente, despacho com o juiz, acordo em negociação…">
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Calculadora de prazos avulsa (sem cadastrar expediente). */
export function CalculatorDialog({ onClose }: { onClose: () => void }) {
  const ds = useData();
  const today = useToday();
  const courts = [...new Set(Object.values(ds.cases).map((c) => c.court).filter(Boolean) as string[])].sort();
  const [channel, setChannel] = useState<Channel>("djen");
  const [sentAt, setSentAt] = useState(today);
  const [readAt, setReadAt] = useState("");
  const [days, setDays] = useState("15");
  const [counting, setCounting] = useState<Counting>("uteis");
  const [double, setDouble] = useState(false);
  const [court, setCourt] = useState("");
  const cal = useMemo(() => makeCalendar({ holidays: ds.prefs.holidays, forensic: ds.prefs.forensic, court: court || undefined }), [ds.prefs, court]);
  const r = computeDeadline({ channel, sentAt, readAt: readAt || undefined, days: Number(days) || undefined, counting, double, today }, cal);
  const needsRead = channel !== "djen" && channel !== "diario" && channel !== "audiencia";
  return (
    <Modal title="Calculadora de prazos" onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Meio" hint={CHANNELS[channel].help} className="span-2">
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {(Object.keys(CHANNELS) as Channel[]).map((k) => (
              <option key={k} value={k}>
                {CHANNELS[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={channel === "djen" || channel === "diario" ? "Disponibilização" : channel === "audiencia" ? "Audiência" : "Envio"}>
          <input type="date" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
        </Field>
        {needsRead && (
          <Field label={CHANNELS[channel].read || "Ciência"}>
            <input type="date" value={readAt} onChange={(e) => setReadAt(e.target.value)} />
          </Field>
        )}
        <Field label="Prazo (dias)">
          <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Contagem">
          <select value={counting} onChange={(e) => setCounting(e.target.value as Counting)}>
            <option value="uteis">Dias úteis (CPC, CLT, juizados)</option>
            <option value="corridos">Dias corridos (CPP)</option>
          </select>
        </Field>
        <Field label="Tribunal (feriados locais)">
          <input value={court} onChange={(e) => setCourt(e.target.value.toUpperCase())} list="calc-courts" placeholder="Todos" />
          <datalist id="calc-courts">
            {courts.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <label className="check">
          <input type="checkbox" checked={double} onChange={(e) => setDouble(e.target.checked)} /> Em dobro
        </label>
      </div>
      <div className="deadline-box">
        {r.due ? (
          <>
            <div className="deadline-due">
              Vencimento: <strong>{formatDateWeek(r.due)}</strong> <span className="muted">({relativeDay(r.due, today)})</span>
            </div>
            <DeadlineMemo r={r} />
          </>
        ) : (
          <div className="muted">{r.pending || "Informe as datas e o prazo."}</div>
        )}
      </div>
      <p className="muted small">
        Considera os feriados nacionais, os forenses marcados em Configurações, o recesso de 20/12 a 20/01 e os feriados locais cadastrados. Confira sempre no sistema do
        tribunal.
      </p>
    </Modal>
  );
}
