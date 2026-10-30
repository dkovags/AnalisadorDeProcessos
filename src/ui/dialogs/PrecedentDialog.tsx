import { Plus, Sparkles, Trash } from "lucide-react";
import { useState } from "react";
import { BINDINGS, POLES, STANDINGS } from "../../domain/labels";
import { formatCitation, parsePrecedentText, precedentNumberCheck } from "../../domain/precedents";
import { caseLabel } from "../../domain/select";
import type { Binding, ID, Pole, Precedent, PrecedentParty, Standing } from "../../domain/types";
import * as A from "../../store/actions";
import { Field, Modal } from "../components/basics";
import { STYLE_LABEL } from "../components/PrecedentCard";
import { useData, useRun, useToday, useUI } from "../context";
import { href, navigate } from "../router";

const COURTS = ["STF", "STJ", "TST", "TSE", "STM", "TNU", "TRF1", "TRF2", "TRF3", "TRF4", "TRF5", "TRF6", "TJSP", "TJRJ", "TJMG", "TJRS", "TJPR", "TJSC", "TJBA", "TJPE", "TJCE", "TJRN", "TJDFT", "TJGO"];
const CLASSES = ["REsp", "AgInt no AREsp", "AgInt no REsp", "AREsp", "EREsp", "RE", "ARE", "ARE AgR", "HC", "RHC", "MS", "RMS", "ADI", "ADPF", "RR", "AIRR", "Súmula", "Súmula Vinculante", "Tema", "Apelação Cível", "Agravo de Instrumento", "Recurso Inominado", "Embargos de Declaração"];

type Form = Omit<Precedent, "id" | "createdAt" | "updatedAt">;

const blank = (caseId?: ID): Form => ({
  court: "",
  className: "",
  number: "",
  binding: "",
  standing: "vigente",
  parties: [],
  caseIds: caseId ? [caseId] : [],
});

export function PrecedentDialog({ precedentId, text, caseId, onClose }: { precedentId?: ID; text?: string; caseId?: ID; onClose: () => void }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const today = useToday();
  const prev = precedentId ? ds.precedents[precedentId] : undefined;
  const [f, setF] = useState<Form>(() => {
    if (prev) {
      const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = prev;
      return rest;
    }
    const base = blank(caseId);
    return text ? fill(base, text) : base;
  });
  const [paste, setPaste] = useState(text || "");
  const [topics, setTopics] = useState((prev?.topics || []).join(", "));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  function fill(base: Form, t: string): Form {
    const p = parsePrecedentText(t);
    const next: Form = { ...base };
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) (next as unknown as Record<string, unknown>)[k] = v;
    return next;
  }

  const read = (t: string) => {
    if (!t.trim()) return;
    const next = fill(f, t);
    setF(next);
    ui.toast(next.className && next.number ? `Lido: ${next.court || ""} ${next.className} ${next.number}${next.parties.length ? `, ${next.parties.length} partes` : ""}.` : "Não achei a classe e o número: preencha à mão.");
  };

  const dup = f.court && f.className && f.number ? A.findPrecedent(ds, { court: f.court.toUpperCase(), className: f.className, number: f.number }, precedentId) : undefined;
  const numberIssue = f.number ? precedentNumberCheck({ number: f.number, court: f.court }) : null;
  const preview = f.court && f.className && f.number ? formatCitation({ ...f, id: "", createdAt: "", updatedAt: "", court: f.court.toUpperCase() } as Precedent, ds.prefs.citationStyle) : "";
  const setParty = (i: number, patch: Partial<PrecedentParty>) => set("parties", f.parties.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const save = () => {
    const id = runAction(A.savePrecedent, { ...f, id: precedentId, topics: topics.split(",").map((t) => t.trim()).filter(Boolean) });
    if (!id) return;
    onClose();
    ui.toast(precedentId ? "Jurisprudência atualizada." : "Jurisprudência guardada na base.");
    if (!precedentId && !caseId) navigate(`/jurisprudencia/${id}`);
  };

  return (
    <Modal
      title={precedentId ? "Editar jurisprudência" : "Nova jurisprudência"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!!dup}>
            Salvar
          </button>
        </>
      }
    >
      {!prev && (
        <>
          <Field label="Colar a decisão" hint="Cole o cabeçalho e a ementa do acórdão, o resultado da pesquisa do tribunal ou o texto da súmula: os dados e as partes são preenchidos.">
            <textarea
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              onPaste={(e) => {
                const t = e.clipboardData.getData("text");
                if (!paste.trim() && t.trim()) setTimeout(() => read(t));
              }}
              placeholder="Ex.: RECURSO ESPECIAL Nº 1.234.567 - SP · RELATORA : MINISTRA ... · RECORRENTE : ... · EMENTA ..."
            />
          </Field>
          <button className="btn btn-ghost btn-sm" disabled={!paste.trim()} onClick={() => read(paste)}>
            <Sparkles size={15} /> Ler e preencher
          </button>
        </>
      )}
      <div className="form-grid">
        <Field label="Tribunal">
          <input value={f.court} onChange={(e) => set("court", e.target.value.toUpperCase())} list="courts" placeholder="STJ" />
        </Field>
        <Field label="Classe">
          <input value={f.className} onChange={(e) => set("className", e.target.value)} list="classes" placeholder="REsp, Súmula, Apelação Cível" />
        </Field>
        <Field label="Número" hint={numberIssue ? <span className="field-error">{numberIssue}</span> : undefined}>
          <input value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="1.234.567" />
        </Field>
        <Field label="UF de origem">
          <input value={f.uf || ""} onChange={(e) => set("uf", e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" />
        </Field>
        <Field label={f.female ? "Relatora" : "Relator"} className="span-2">
          <input value={f.rapporteur || ""} onChange={(e) => set("rapporteur", e.target.value)} placeholder="Nome, sem o título" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={!!f.female} onChange={(e) => set("female", e.target.checked)} /> Relatora (feminino)
        </label>
        <Field label="Relator(a) para o acórdão">
          <input value={f.rapporteurForJudgment || ""} onChange={(e) => set("rapporteurForJudgment", e.target.value)} />
        </Field>
        <Field label="Órgão julgador" className="span-2">
          <input value={f.body || ""} onChange={(e) => set("body", e.target.value)} placeholder="Terceira Turma, 22ª Câmara de Direito Privado" />
        </Field>
        <Field label="Julgamento">
          <input type="date" value={f.judgedAt || ""} onChange={(e) => set("judgedAt", e.target.value || undefined)} />
        </Field>
        <Field label="Publicação">
          <input type="date" value={f.publishedAt || ""} onChange={(e) => set("publishedAt", e.target.value || undefined)} />
        </Field>
        <Field label="Fonte">
          <input value={f.source || ""} onChange={(e) => set("source", e.target.value)} placeholder="DJe" />
        </Field>
        <Field label="Precedente qualificado">
          <select value={f.binding} onChange={(e) => set("binding", e.target.value as Binding)}>
            {(Object.keys(BINDINGS) as Binding[]).map((b) => (
              <option key={b} value={b}>
                {BINDINGS[b]}
              </option>
            ))}
          </select>
        </Field>
        {(f.binding === "repetitivo" || f.binding === "repercussao" || f.binding === "irdr" || f.binding === "iac") && (
          <Field label="Número do tema">
            <input value={f.bindingNumber || ""} onChange={(e) => set("bindingNumber", e.target.value)} />
          </Field>
        )}
        <Field label="Situação">
          <select value={f.standing} onChange={(e) => set("standing", e.target.value as Standing)}>
            {(Object.keys(STANDINGS) as Standing[]).map((s) => (
              <option key={s} value={s}>
                {STANDINGS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {dup && (
        <p className="field-error">
          Esta decisão já está na base: <a href={href(`/jurisprudencia/${dup.id}`)} onClick={onClose}>abrir o cadastro</a>.
        </p>
      )}
      <Field label="Ementa (ou texto da súmula)">
        <textarea rows={6} value={f.summary || ""} onChange={(e) => set("summary", e.target.value)} />
      </Field>
      <Field label="Tese" hint="O entendimento em uma frase, para achar depressa.">
        <textarea rows={2} value={f.thesis || ""} onChange={(e) => set("thesis", e.target.value)} />
      </Field>

      <h3 className="form-section">Partes</h3>
      {f.parties.map((p, i) => (
        <div key={i} className="party-form compact">
          <input value={p.role} onChange={(e) => setParty(i, { role: e.target.value })} placeholder="Recorrente" aria-label="Papel" />
          <input className="party-name-input" value={p.name} onChange={(e) => setParty(i, { name: e.target.value })} placeholder="Nome" aria-label="Nome" />
          <select value={p.pole} onChange={(e) => setParty(i, { pole: e.target.value as Pole })} aria-label="Polo">
            {(Object.keys(POLES) as Pole[]).map((k) => (
              <option key={k} value={k}>
                {POLES[k]}
              </option>
            ))}
          </select>
          <button className="icon-btn small" aria-label="Tirar" onClick={() => set("parties", f.parties.filter((_, j) => j !== i))}>
            <Trash size={14} />
          </button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => set("parties", [...f.parties, { name: "", role: "", pole: "ativo" }])}>
        <Plus size={14} /> Parte
      </button>

      <div className="form-grid">
        <Field label="Temas (separados por vírgula)" className="span-2">
          <input value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="dano moral, consumidor, prescrição" />
        </Field>
        <Field label="Endereço na internet" className="span-2">
          <input value={f.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://" inputMode="url" />
        </Field>
      </div>
      {Object.keys(ds.cases).length > 0 && (
        <fieldset className="recipients">
          <legend>Usada nos processos</legend>
          {Object.values(ds.cases)
            .sort((a, b) => caseLabel(a).localeCompare(caseLabel(b), "pt-BR"))
            .map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={f.caseIds.includes(c.id)}
                  onChange={(e) => set("caseIds", e.target.checked ? [...f.caseIds, c.id] : f.caseIds.filter((x) => x !== c.id))}
                />
                {caseLabel(c)}
              </label>
            ))}
        </fieldset>
      )}
      <label className="check">
        <input type="checkbox" checked={!!f.checkedAt} onChange={(e) => set("checkedAt", e.target.checked ? today : undefined)} /> Conferi os dados na fonte oficial (site do
        tribunal ou diário)
      </label>
      <Field label="Observações">
        <textarea rows={2} value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {preview && (
        <div className="preview-cite">
          <div className="muted small">Citação ({STYLE_LABEL[ds.prefs.citationStyle]}):</div>
          <div>{preview}</div>
        </div>
      )}
      <datalist id="courts">
        {COURTS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="classes">
        {CLASSES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </Modal>
  );
}
