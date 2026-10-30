import { Plus, Trash } from "lucide-react";
import { useState } from "react";
import { formatDateWeek } from "../../domain/dates";
import { noticeDeadline } from "../../domain/deadlines";
import { TASK_KINDS, TASK_STATUS } from "../../domain/labels";
import { caseLabel } from "../../domain/select";
import type { ChecklistItem, ID, TaskKind, TaskStatus } from "../../domain/types";
import * as A from "../../store/actions";
import { newId } from "../../store/ids";
import { Field, Modal } from "../components/basics";
import { useData, useRun, useToday, useUI } from "../context";

export function TaskDialog({ caseId: initialCase, taskId, noticeId, onClose }: { caseId?: ID; taskId?: ID; noticeId?: ID; onClose: () => void }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const today = useToday();
  const prev = taskId ? ds.tasks[taskId] : undefined;
  const [caseId, setCaseId] = useState(prev?.caseId || initialCase || "");
  const [title, setTitle] = useState(prev?.title || "");
  const [kind, setKind] = useState<TaskKind>(prev?.kind || "peticao");
  const [status, setStatus] = useState<TaskStatus>(prev?.status || "pendente");
  const [due, setDue] = useState(prev?.due || "");
  const [internalDue, setInternalDue] = useState(prev?.internalDue || "");
  const [basis, setBasis] = useState(prev?.basis || "");
  const [notes, setNotes] = useState(prev?.notes || "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(prev?.checklist || []);
  const [newItem, setNewItem] = useState("");
  const linkedNotice = prev?.noticeId || noticeId;
  const notice = linkedNotice ? ds.notices[linkedNotice] : undefined;
  const noticeDue = notice ? noticeDeadline(ds, notice, today).due : undefined;
  const cases = Object.values(ds.cases).sort((a, b) => caseLabel(a).localeCompare(caseLabel(b), "pt-BR"));

  const addItem = () => {
    if (!newItem.trim()) return;
    setChecklist([...checklist, { id: newId("i"), label: newItem.trim(), done: false }]);
    setNewItem("");
  };

  const save = () => {
    const id = runAction(A.saveTask, {
      id: taskId,
      caseId,
      noticeId: linkedNotice,
      title,
      kind,
      status,
      due: due || undefined,
      internalDue: internalDue || undefined,
      basis,
      notes,
      checklist,
    });
    if (!id) return;
    onClose();
    ui.toast(taskId ? "Providência atualizada." : "Providência criada.");
  };

  return (
    <Modal
      title={taskId ? "Providência" : "Nova providência"}
      onClose={onClose}
      footer={
        <>
          {taskId && (
            <button
              className="btn btn-ghost danger-text"
              onClick={() =>
                ui.open({
                  type: "confirm",
                  title: "Apagar a providência?",
                  message: `"${prev?.title}" sai da lista de prazos.`,
                  confirmLabel: "Apagar",
                  danger: true,
                  onConfirm: () => {
                    runAction(A.deleteTask, taskId);
                    onClose();
                  },
                })
              }
            >
              Apagar
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      {!initialCase && !prev && (
        <Field label="Processo">
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">Escolha o processo</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {caseLabel(c)} · {c.number}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="form-grid">
        <Field label="Providência" className="span-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Réplica, Juntar procuração, Recolher custas" />
        </Field>
        <Field label="Tipo">
          <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>
            {(Object.keys(TASK_KINDS) as TaskKind[]).map((k) => (
              <option key={k} value={k}>
                {TASK_KINDS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Andamento">
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((k) => (
              <option key={k} value={k}>
                {TASK_STATUS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prazo fatal" hint={noticeDue && !due ? `Do expediente: ${formatDateWeek(noticeDue)}` : notice ? "Em branco: segue o expediente." : undefined}>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Prazo interno" hint={`Em branco: ${ds.prefs.marginDays} dias úteis antes do fatal.`}>
          <input type="date" value={internalDue} onChange={(e) => setInternalDue(e.target.value)} />
        </Field>
        <Field label="Fundamento" className="span-2">
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Ex.: CPC, art. 1.010, § 1º" />
        </Field>
      </div>
      <h3 className="form-section">{kind === "audiencia" ? "Preparação" : "Documentos para instruir a petição"}</h3>
      <div className="checklist edit">
        {checklist.map((i) => (
          <div key={i.id} className="check-item">
            <label>
              <input type="checkbox" checked={i.done} onChange={(e) => setChecklist(checklist.map((x) => (x.id === i.id ? { ...x, done: e.target.checked } : x)))} />
              <input className="inline-input" value={i.label} onChange={(e) => setChecklist(checklist.map((x) => (x.id === i.id ? { ...x, label: e.target.value } : x)))} aria-label="Documento" />
            </label>
            <button className="icon-btn small" aria-label="Tirar da lista" onClick={() => setChecklist(checklist.filter((x) => x.id !== i.id))}>
              <Trash size={14} />
            </button>
          </div>
        ))}
        <div className="check-add">
          <input value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())} placeholder="Acrescentar documento (ex.: Procuração)" />
          <button className="btn btn-ghost btn-sm" onClick={addItem}>
            <Plus size={14} /> Acrescentar
          </button>
        </div>
      </div>
      <Field label="Observações">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
