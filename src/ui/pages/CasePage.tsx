import { CalendarClock, CircleUser, ExternalLink, FileUp, Pencil, Sparkles, Trash, UserCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { analyze, type Suggestion } from "../../domain/analysis";
import { checkCaseNumber } from "../../domain/cnj";
import { formatDate } from "../../domain/dates";
import { RITES } from "../../domain/deadlines";
import { DOC_TYPES, ORDER_TYPES, POLES, STATUS, STATUS_ORDER } from "../../domain/labels";
import { agenda, caseLabel, docsOfCase, noticesOfCase, tasksOfCase } from "../../domain/select";
import { formatMoney } from "../../domain/text";
import type { Case, CaseStatus, Doc } from "../../domain/types";
import * as A from "../../store/actions";
import { AgendaList } from "../components/Agenda";
import { CopyButton, Empty, Tabs } from "../components/basics";
import { useData, useRun, useStore, useToday, useUI } from "../context";
import { casePath, navigate, type CaseTab } from "../router";
import { CasePrecedents } from "./case/CasePrecedents";
import { CaseDeadlines } from "./case/CaseDeadlines";
import { CaseDocuments } from "./case/CaseDocuments";
import { CaseTimeline } from "./case/CaseTimeline";

function Info({ label, children }: { label: string; children: ReactNode }) {
  if (children === undefined || children === null || children === "") return null;
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Lê a última decisão, despacho ou intimação guardada e mostra o que ela pede. */
function OrderSuggestions({ c }: { c: Case }) {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const [found, setFound] = useState<{ doc: Doc; suggestions: Suggestion[] } | null>(null);
  const linked = new Set(Object.values(ds.notices).map((n) => n.docId).filter(Boolean));
  const latest = docsOfCase(ds, c.id).find((d) => ORDER_TYPES.includes(d.type));
  const pending = latest && !linked.has(latest.id) ? latest : undefined;
  useEffect(() => {
    let alive = true;
    setFound(null);
    if (!pending) return;
    store.pages(pending.fileId).then((pages) => {
      if (!alive) return;
      const [a, b] = pending.pages || [1, pages.length];
      const text = pages.slice(a - 1, b).join("\n");
      const res = analyze(text, { rite: c.rite });
      const suggestions = res.suggestions.filter((s) => s.petition || s.kind === "audiencia");
      if (suggestions.length) setFound({ doc: pending, suggestions });
    });
    return () => {
      alive = false;
    };
  }, [store, pending?.id, pending?.fileId, c.rite]);
  if (!found) return null;
  const s = found.suggestions[0];
  return (
    <div className="banner info suggestion">
      <Sparkles size={20} />
      <div>
        <strong>
          {DOC_TYPES[found.doc.type]}
          {found.doc.date ? ` de ${formatDate(found.doc.date)}` : ""}: parece pedir {s.kind === "audiencia" ? "atenção a uma audiência" : `"${s.act}"`}
          {s.days ? ` em ${s.days} dias${s.counting === "uteis" ? " úteis" : ""}` : ""}.
        </strong>
        {s.docs.length > 0 && <div className="muted">Para instruir: {s.docs.join("; ")}.</div>}
        <div className="banner-actions">
          <button className="btn btn-primary btn-sm" onClick={() => ui.open({ type: "notice", caseId: c.id, docId: found.doc.id })}>
            Registrar o expediente
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => ui.open({ type: "doc", docId: found.doc.id })}>
            Ler o documento
          </button>
        </div>
      </div>
    </div>
  );
}

function Summary({ c }: { c: Case }) {
  const ds = useData();
  const ui = useUI();
  const today = useToday();
  const items = agenda(ds, today).filter((i) => i.caseId === c.id);
  const check = checkCaseNumber(c.number);
  return (
    <div className="case-grid">
      <div className="case-col">
        <OrderSuggestions c={c} />
        <section className="card">
          <div className="card-head">
            <h2>
              <CalendarClock size={18} /> Prazos e audiências
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={() => ui.open({ type: "notice", caseId: c.id })}>
              Novo expediente
            </button>
          </div>
          <AgendaList items={items} showCase={false} empty={<p className="muted pad">Nenhum prazo em aberto neste processo.</p>} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2>
              <CircleUser size={18} /> Partes
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={() => ui.open({ type: "case", caseId: c.id })}>
              Editar
            </button>
          </div>
          {!c.parties.length && <p className="muted pad">Nenhuma parte cadastrada.</p>}
          {(["ativo", "passivo", "terceiro"] as const).map((pole) => {
            const list = c.parties.filter((p) => p.pole === pole);
            if (!list.length) return null;
            return (
              <div key={pole} className="pole">
                <div className="pole-title">{POLES[pole]}</div>
                {list.map((p) => (
                  <div key={p.id} className="party">
                    <div className="party-name">
                      {p.name}
                      {p.role && <span className="muted"> · {p.role}</span>}
                      {p.client && (
                        <span className="chip tone-ok">
                          <UserCheck size={12} /> cliente
                        </span>
                      )}
                      {p.doubleTerm && <span className="chip tone-info">prazo em dobro</span>}
                    </div>
                    {p.doc && <div className="muted small">{p.doc}</div>}
                    {p.lawyers && <div className="party-lawyers">{p.lawyers}</div>}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      </div>
      <div className="case-col">
        <section className="card">
          <div className="card-head">
            <h2>Dados do processo</h2>
          </div>
          <dl className="infos">
            <Info label="Número">
              <span className="mono">{c.number}</span> <CopyButton text={c.number} label="" className="icon-btn small" />
              {check && !check.valid && <div className="field-error">{check.message}</div>}
            </Info>
            <Info label="Tribunal">{[c.court, c.system].filter(Boolean).join(" · ")}</Info>
            <Info label="Órgão julgador">{c.body}</Info>
            <Info label="Classe">{c.className}</Info>
            <Info label="Assuntos">{c.subjects}</Info>
            <Info label="Rito dos prazos">{RITES[c.rite].label}</Info>
            <Info label="Distribuição">{c.filedAt && formatDate(c.filedAt)}</Info>
            <Info label="Valor da causa">{c.value !== undefined ? formatMoney(c.value) : undefined}</Info>
            <Info label="Justiça gratuita">{c.freeJustice ? "Sim" : undefined}</Info>
            <Info label="Segredo de justiça">{c.secret ? "Sim" : undefined}</Info>
            <Info label="Resultado">{c.outcome}</Info>
          </dl>
          <div className="card-links">
            <a className="link" href="https://comunica.pje.jus.br/" target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Consultar intimações no DJEN
            </a>
            <CopyButton text={c.number.replace(/\D/g, "")} label="Copiar só os dígitos" className="link-btn" />
          </div>
        </section>
        {c.notes && (
          <section className="card">
            <div className="card-head">
              <h2>Observações</h2>
            </div>
            <p className="pad pre">{c.notes}</p>
          </section>
        )}
      </div>
    </div>
  );
}

export function CasePage({ id, tab, q }: { id: string; tab: CaseTab; q?: string }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const c = ds.cases[id];
  if (!c)
    return (
      <div className="page">
        <Empty title="Processo não encontrado" action={<a className="btn btn-primary" href="#/processos">Ver os processos</a>}>
          Ele pode ter sido apagado.
        </Empty>
      </div>
    );
  const docs = docsOfCase(ds, id).length;
  const open = tasksOfCase(ds, id).filter((t) => t.status === "pendente" || t.status === "elaboracao").length + noticesOfCase(ds, id).filter((n) => n.status === "aberto").length;
  const precedents = Object.values(ds.precedents).filter((p) => p.caseIds.includes(id)).length;
  const setStatus = (s: CaseStatus) => runAction(A.setCaseStatus, id, s) && ui.toast(`Situação: ${STATUS[s].label}.`);
  return (
    <div className="page">
      <div className="case-header">
        <div className="case-title">
          <h1>{caseLabel(c)}</h1>
          <div className="case-subtitle">
            <span className="mono">{c.number}</span>
            {c.court && <span>· {c.court}</span>}
            {c.body && <span className="hide-sm">· {c.body}</span>}
          </div>
        </div>
        <div className="case-actions">
          <select className={`status-select tone-${STATUS[c.status].tone}`} value={c.status} onChange={(e) => setStatus(e.target.value as CaseStatus)} aria-label="Situação do processo">
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost" onClick={() => ui.open({ type: "import", caseId: id })} title="Enviar documentos ou o processo integral">
            <FileUp size={17} /> <span className="hide-sm">Enviar arquivo</span>
          </button>
          <button className="btn btn-ghost" onClick={() => ui.open({ type: "case", caseId: id })} title="Editar dados e partes">
            <Pencil size={16} /> <span className="hide-sm">Editar</span>
          </button>
          <button
            className="icon-btn"
            title="Apagar o processo"
            aria-label="Apagar o processo"
            onClick={() =>
              ui.open({
                type: "confirm",
                title: "Apagar o processo?",
                message: (
                  <>
                    Apaga <strong>{caseLabel(c)}</strong> com os expedientes, as providências e os documentos guardados ({docs}). A jurisprudência da base continua,
                    só perde o vínculo. Não dá para desfazer.
                  </>
                ),
                confirmLabel: "Apagar",
                danger: true,
                onConfirm: () => {
                  if (runAction(A.deleteCase, id)) {
                    navigate("/processos");
                    ui.toast("Processo apagado.");
                  }
                },
              })
            }
          >
            <Trash size={18} />
          </button>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={(t) => navigate(casePath(id, t), { replace: true })}
        tabs={[
          { id: "resumo", label: "Resumo" },
          { id: "prazos", label: "Expedientes e prazos", count: open },
          { id: "documentos", label: "Documentos", count: docs },
          { id: "andamentos", label: "Andamentos" },
          { id: "jurisprudencia", label: "Jurisprudência", count: precedents },
        ]}
      />
      {tab === "resumo" && <Summary c={c} />}
      {tab === "prazos" && <CaseDeadlines c={c} />}
      {tab === "documentos" && <CaseDocuments c={c} q={q} />}
      {tab === "andamentos" && <CaseTimeline c={c} />}
      {tab === "jurisprudencia" && <CasePrecedents c={c} />}
    </div>
  );
}
