import { Plus, Trash } from "lucide-react";
import { useState } from "react";
import { checkCaseNumber } from "../../domain/cnj";
import { RITES } from "../../domain/deadlines";
import { POLES, STATUS, STATUS_ORDER } from "../../domain/labels";
import { formatMoney, parseMoney } from "../../domain/text";
import type { CaseStatus, Party, PersonKind, Pole, Rite } from "../../domain/types";
import * as A from "../../store/actions";
import { newId } from "../../store/ids";
import { Field, Modal } from "../components/basics";
import { useData, useRun, useUI } from "../context";
import { casePath, navigate } from "../router";

export const SYSTEMS = ["PJe", "eproc", "e-SAJ", "Projudi", "PJe-JT", "SEEU", "Tucujuris", "Outro"];
const ROLES: Record<Pole, string[]> = {
  ativo: ["Autor", "Autora", "Requerente", "Reclamante", "Exequente", "Impetrante", "Apelante", "Agravante", "Embargante", "Recorrente"],
  passivo: ["Réu", "Ré", "Requerido", "Requerida", "Reclamado", "Reclamada", "Executado", "Executada", "Impetrado", "Apelado", "Agravado", "Embargado", "Recorrido"],
  terceiro: ["Terceiro interessado", "Ministério Público", "Assistente", "Litisconsorte", "Amicus curiae", "Perito"],
};
export const PERSON_KINDS: Record<PersonKind, string> = { pf: "Pessoa física", pj: "Empresa", me: "Micro ou pequena empresa", publico: "Ente público" };

function blankParty(pole: Pole): Party {
  return { id: newId("pt"), name: "", pole, role: ROLES[pole][0] };
}

export function CaseDialog({ caseId, onClose }: { caseId?: string; onClose: () => void }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const prev = caseId ? ds.cases[caseId] : undefined;
  const [f, setF] = useState({
    number: prev?.number || "",
    title: prev?.title || "",
    court: prev?.court || "",
    system: prev?.system || "PJe",
    body: prev?.body || "",
    className: prev?.className || "",
    subjects: prev?.subjects || "",
    rite: (prev?.rite || "civel") as Rite,
    status: (prev?.status || "ativo") as CaseStatus,
    outcome: prev?.outcome || "",
    filedAt: prev?.filedAt || "",
    value: prev?.value !== undefined ? formatMoney(prev.value).replace("R$ ", "") : "",
    freeJustice: !!prev?.freeJustice,
    secret: !!prev?.secret,
    notes: prev?.notes || "",
  });
  const [parties, setParties] = useState<Party[]>(prev?.parties.length ? prev.parties : [{ ...blankParty("ativo"), client: true }, blankParty("passivo")]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const check = f.number.trim() ? checkCaseNumber(f.number) : null;
  const setParty = (id: string, patch: Partial<Party>) => setParties((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const save = () => {
    const value = f.value.trim() ? parseMoney(f.value) : undefined;
    const id = runAction(A.saveCase, {
      id: caseId,
      number: f.number,
      title: f.title,
      court: f.court || check?.court,
      system: f.system,
      body: f.body,
      className: f.className,
      subjects: f.subjects,
      rite: f.rite,
      status: f.status,
      outcome: f.outcome,
      filedAt: f.filedAt || undefined,
      value: value ?? undefined,
      freeJustice: f.freeJustice || undefined,
      secret: f.secret || undefined,
      parties,
      notes: f.notes,
    });
    if (!id) return;
    onClose();
    ui.toast(caseId ? "Processo atualizado." : "Processo cadastrado.");
    if (!caseId) navigate(casePath(id));
  };

  return (
    <Modal
      title={caseId ? "Editar processo" : "Novo processo"}
      onClose={onClose}
      wide
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
      <div className="form-grid">
        <Field
          label="Número do processo"
          className="span-2"
          hint={check ? (check.valid ? `Número válido${check.court ? ` · ${check.court}` : ""}` : <span className="field-error">{check.message}</span>) : "Padrão CNJ: 0000000-00.0000.0.00.0000"}
        >
          <input value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="0801234-56.2023.8.20.5001" inputMode="numeric" />
        </Field>
        <Field label="Apelido (opcional)" className="span-2" hint="Como você chama o processo. Sem apelido, aparecem as partes.">
          <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: Maria x Banco Alfa (negativação)" />
        </Field>
        <Field label="Tribunal">
          <input value={f.court} onChange={(e) => set("court", e.target.value.toUpperCase())} placeholder={check?.court || "TJSP, TRF3, TRT2…"} />
        </Field>
        <Field label="Sistema">
          <select value={f.system} onChange={(e) => set("system", e.target.value)}>
            {SYSTEMS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Órgão julgador" className="span-2">
          <input value={f.body} onChange={(e) => set("body", e.target.value)} placeholder="Ex.: 3ª Vara Cível da Comarca de Natal" />
        </Field>
        <Field label="Classe" className="span-2">
          <input value={f.className} onChange={(e) => set("className", e.target.value)} placeholder="Ex.: Procedimento Comum Cível" />
        </Field>
        <Field label="Assuntos" className="span-2">
          <input value={f.subjects} onChange={(e) => set("subjects", e.target.value)} />
        </Field>
        <Field label="Regras de prazo" hint={f.rite === "penal" ? "Prazos em dias corridos (CPP, art. 798)." : "Prazos em dias úteis."}>
          <select value={f.rite} onChange={(e) => set("rite", e.target.value as Rite)}>
            {(Object.keys(RITES) as Rite[]).map((r) => (
              <option key={r} value={r}>
                {RITES[r].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Situação">
          <select value={f.status} onChange={(e) => set("status", e.target.value as CaseStatus)}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </select>
        </Field>
        {!STATUS[f.status].active || f.status === "transitado" ? (
          <Field label="Resultado" className="span-2">
            <input value={f.outcome} onChange={(e) => set("outcome", e.target.value)} placeholder="Ex.: procedente, acordo, improcedente" />
          </Field>
        ) : null}
        <Field label="Distribuição">
          <input type="date" value={f.filedAt} onChange={(e) => set("filedAt", e.target.value)} />
        </Field>
        <Field label="Valor da causa (R$)">
          <input value={f.value} onChange={(e) => set("value", e.target.value)} inputMode="decimal" placeholder="0,00" />
        </Field>
        <label className="check span-2">
          <input type="checkbox" checked={f.freeJustice} onChange={(e) => set("freeJustice", e.target.checked)} /> Justiça gratuita
        </label>
        <label className="check span-2">
          <input type="checkbox" checked={f.secret} onChange={(e) => set("secret", e.target.checked)} /> Segredo de justiça
        </label>
      </div>

      <h3 className="form-section">Partes</h3>
      {(["ativo", "passivo", "terceiro"] as Pole[]).map((pole) => (
        <div key={pole} className="party-editor">
          <div className="party-editor-head">
            <strong>{POLES[pole]}</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => setParties((ps) => [...ps, blankParty(pole)])}>
              <Plus size={14} /> Adicionar
            </button>
          </div>
          {parties
            .filter((p) => p.pole === pole)
            .map((p) => (
              <div key={p.id} className="party-form">
                <input className="party-name-input" value={p.name} onChange={(e) => setParty(p.id, { name: e.target.value })} placeholder="Nome" aria-label="Nome da parte" />
                <input value={p.role || ""} onChange={(e) => setParty(p.id, { role: e.target.value })} list={`roles-${pole}`} placeholder="Papel" aria-label="Papel" />
                <select value={p.kind || ""} onChange={(e) => setParty(p.id, { kind: (e.target.value || undefined) as PersonKind | undefined, doubleTerm: e.target.value === "publico" ? true : p.doubleTerm })} aria-label="Tipo de pessoa">
                  <option value="">Tipo de pessoa</option>
                  {(Object.keys(PERSON_KINDS) as PersonKind[]).map((k) => (
                    <option key={k} value={k}>
                      {PERSON_KINDS[k]}
                    </option>
                  ))}
                </select>
                <input value={p.doc || ""} onChange={(e) => setParty(p.id, { doc: e.target.value })} placeholder="CPF ou CNPJ" aria-label="CPF ou CNPJ" />
                <textarea rows={1} value={p.lawyers || ""} onChange={(e) => setParty(p.id, { lawyers: e.target.value })} placeholder="Advogados (um por linha)" aria-label="Advogados" />
                <div className="party-flags">
                  <label className="check">
                    <input type="checkbox" checked={!!p.client} onChange={(e) => setParty(p.id, { client: e.target.checked })} /> Cliente
                  </label>
                  <label className="check" title="Fazenda Pública, Ministério Público e Defensoria (CPC, arts. 180, 183 e 186)">
                    <input type="checkbox" checked={!!p.doubleTerm} onChange={(e) => setParty(p.id, { doubleTerm: e.target.checked })} /> Prazo em dobro
                  </label>
                  <button className="icon-btn small" aria-label="Tirar a parte" onClick={() => setParties((ps) => ps.filter((x) => x.id !== p.id))}>
                    <Trash size={15} />
                  </button>
                </div>
              </div>
            ))}
          <datalist id={`roles-${pole}`}>
            {ROLES[pole].map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
      ))}
      <Field label="Observações">
        <textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
    </Modal>
  );
}
