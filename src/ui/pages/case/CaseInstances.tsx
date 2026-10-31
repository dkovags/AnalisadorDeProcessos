import { ExternalLink, Link2, Pencil, Plus, Trash } from "lucide-react";
import { useState } from "react";
import { formatDate } from "../../../domain/dates";
import { currentInstance, INSTANCE_LABEL, linkCandidates, looksSeparateAppeal } from "../../../domain/instances";
import { caseLabel } from "../../../domain/select";
import type { Case, CaseInstance, InstanceLevel } from "../../../domain/types";
import * as A from "../../../store/actions";
import { CopyButton, Field } from "../../components/basics";
import { useData, useRun, useUI } from "../../context";
import { casePath, navigate } from "../../router";

const ORDER: Record<InstanceLevel, number> = { origem: 0, recursal: 1, uniformizacao: 2, superior: 3 };
const SOURCE: Record<NonNullable<CaseInstance["source"]>, string> = { djen: "pelo DJEN", datajud: "pelo DataJud", manual: "cadastrada à mão" };

type Draft = { id?: string; level: InstanceLevel; body: string; number: string; className: string; url: string };

function InstanceForm({ c, draft, onDone }: { c: Case; draft: Draft; onDone: () => void }) {
  const runAction = useRun();
  const ui = useUI();
  const [f, setF] = useState(draft);
  const save = () => {
    const ok = runAction(A.saveInstance, c.id, { id: f.id, level: f.level, body: f.body, number: f.number, className: f.className, url: f.url });
    if (ok) {
      onDone();
      ui.toast("Instância guardada.");
    }
  };
  return (
    <div className="inst-form">
      <div className="form-grid">
        <Field label="Instância">
          <select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as InstanceLevel })}>
            {(Object.keys(INSTANCE_LABEL) as InstanceLevel[]).map((l) => (
              <option key={l} value={l}>
                {INSTANCE_LABEL[l]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Órgão" className="span-3">
          <input value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Ex.: 3ª Turma Recursal Cível" />
        </Field>
        <Field label="Número próprio" hint="Só quando o recurso foi autuado à parte (agravo de instrumento, recurso de medida cautelar).">
          <input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder="Em branco: o mesmo do processo" />
        </Field>
        <Field label="Link da consulta pública" className="span-3" hint="Copie da barra de endereço a página do processo no sistema do tribunal, nesta instância.">
          <input type="url" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" spellCheck={false} />
        </Field>
      </div>
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={save}>
          Salvar
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Liga este processo (um recurso autuado à parte) ao processo principal. */
function LinkForm({ c, suggested }: { c: Case; suggested: boolean }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const candidates = linkCandidates(ds, c);
  const [target, setTarget] = useState(candidates[0]?.case.id || "");
  if (!candidates.length) return null;
  const link = () => {
    const to = ds.cases[target];
    if (!to) return;
    ui.open({
      type: "confirm",
      title: "Ligar ao processo principal?",
      message: `Os expedientes, as providências, os documentos e os andamentos deste processo (${c.number}) passam para "${caseLabel(to)}" (${to.number}), e o número dele vira uma instância de lá. Este cadastro separado deixa de existir.`,
      confirmLabel: "Ligar",
      onConfirm: () => {
        if (runAction(A.linkCases, c.id, to.id)) {
          navigate(casePath(to.id));
          ui.toast(`Recurso ligado: o nº ${c.number} agora aparece nas instâncias de ${caseLabel(to)}.`);
        }
      },
    });
  };
  return (
    <div className={suggested ? "banner info small link-form" : "link-form"}>
      {suggested && <Link2 size={18} />}
      <div>
        {suggested && (
          <p>
            Este processo parece ser um recurso autuado à parte{c.className ? ` (${c.className})` : ""}. Se ele pertence a outro processo seu, ligue os dois: os
            expedientes e os andamentos passam para o principal, e as próximas comunicações deste número vão direto para lá.
          </p>
        )}
        <div className="row">
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Processo principal">
            {candidates.map(({ case: x, common }) => (
              <option key={x.id} value={x.id}>
                {caseLabel(x)} · {x.number}
                {common ? ` (${common === 1 ? "1 parte" : `${common} partes`} em comum)` : ""}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={link}>
            <Link2 size={14} /> Ligar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Instâncias do processo (origem, turma recursal, câmara...), com o número e o link da consulta pública de cada uma. */
export function CaseInstances({ c }: { c: Case }) {
  const ui = useUI();
  const runAction = useRun();
  const [editing, setEditing] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const list = [...(c.instances || [])].sort((a, b) => ORDER[a.level] - ORDER[b.level] || (a.since || "").localeCompare(b.since || ""));
  const current = currentInstance(c);
  // sem instâncias cadastradas: a origem, com o órgão do processo, só para guardar o link
  const rows: CaseInstance[] = list.length ? list : [{ id: "", level: "origem", body: c.body }];
  const suggested = looksSeparateAppeal(c);
  const draftOf = (i?: CaseInstance): Draft => ({
    id: i?.id || undefined,
    level: i?.level || "recursal",
    body: i?.body || "",
    number: i?.number || "",
    className: i?.className || "",
    url: i?.url || "",
  });
  return (
    <section className="card">
      <div className="card-head">
        <h2>Instâncias e consulta pública</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing("new")}>
          <Plus size={14} /> Instância
        </button>
      </div>
      {suggested && <LinkForm c={c} suggested />}
      <ul className="instances">
        {rows.map((i) => {
          const isCurrent = !!current && i.id === current.id && list.length > 1;
          return (
            <li key={i.id || "origem"} className={isCurrent ? "current" : ""}>
              {editing === (i.id || "origem") ? (
                <InstanceForm c={c} draft={{ ...draftOf(i), level: i.level }} onDone={() => setEditing(null)} />
              ) : (
                <div className="inst-row">
                  <div className="inst-main">
                    <div>
                      <span className={`chip ${isCurrent ? "tone-info" : "tone-muted"}`}>
                        {INSTANCE_LABEL[i.level]}
                        {isCurrent ? " · atual" : ""}
                      </span>{" "}
                      <strong>{i.body || "Órgão não informado"}</strong>
                    </div>
                    <div className="muted small">
                      {[i.className, i.since && `desde ${formatDate(i.since)}`, i.source && SOURCE[i.source]].filter(Boolean).join(" · ")}
                      {i.number && (
                        <>
                          {" · nº "}
                          <span className="mono">{i.number}</span> <CopyButton text={i.number} label="" className="icon-btn small" />
                        </>
                      )}
                    </div>
                    {isCurrent && !i.url && i.level !== "origem" && (
                      <div className="small inst-hint">Os autos estão nesta instância: se a consulta pública mudou, guarde o link novo.</div>
                    )}
                  </div>
                  <div className="inst-actions">
                    {i.url ? (
                      <a className="btn btn-ghost btn-sm" href={i.url} target="_blank" rel="noreferrer">
                        <ExternalLink size={14} /> Consulta pública
                      </a>
                    ) : (
                      <button className="link-btn small" onClick={() => setEditing(i.id || "origem")}>
                        Guardar o link da consulta
                      </button>
                    )}
                    <button className="icon-btn small" aria-label="Editar a instância" title="Editar" onClick={() => setEditing(i.id || "origem")}>
                      <Pencil size={14} />
                    </button>
                    {i.id && (
                      <button
                        className="icon-btn small"
                        aria-label="Tirar a instância"
                        title="Tirar"
                        onClick={() =>
                          ui.open({
                            type: "confirm",
                            title: "Tirar a instância?",
                            message: `Tira "${i.body || INSTANCE_LABEL[i.level]}" da lista (os expedientes e os andamentos continuam).`,
                            confirmLabel: "Tirar",
                            danger: true,
                            onConfirm: () => runAction(A.removeInstance, c.id, i.id),
                          })
                        }
                      >
                        <Trash size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {editing === "new" && (
          <li>
            <InstanceForm c={c} draft={draftOf()} onDone={() => setEditing(null)} />
          </li>
        )}
      </ul>
      <div className="card-links">
        <a className="link" href="https://comunica.pje.jus.br/" target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> Consultar intimações no DJEN
        </a>
        <CopyButton text={c.number.replace(/\D/g, "")} label="Copiar só os dígitos" className="link-btn" />
        {!suggested && (
          <button className="link-btn small" onClick={() => setLinking(!linking)}>
            <Link2 size={14} /> Ligar a outro processo
          </button>
        )}
      </div>
      {linking && !suggested && (
        <div className="pad-x">
          <p className="muted small">Para recurso autuado à parte (agravo de instrumento, recurso de medida cautelar): escolha o processo principal.</p>
          <LinkForm c={c} suggested={false} />
        </div>
      )}
    </section>
  );
}
