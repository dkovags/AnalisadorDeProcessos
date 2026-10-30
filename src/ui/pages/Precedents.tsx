import { BadgeCheck, FileUp, Library, Pencil, Plus, Search, Trash, Users } from "lucide-react";
import { useState } from "react";
import { APP_NAME } from "../../config";
import { formatDate } from "../../domain/dates";
import { BINDINGS, STANDINGS } from "../../domain/labels";
import { citationBlock, formatCitation, precedentNumberCheck, sharedParties } from "../../domain/precedents";
import { caseLabel } from "../../domain/select";
import { fold } from "../../domain/text";
import type { CitationStyle } from "../../domain/types";
import * as A from "../../store/actions";
import { CopyButton, Empty } from "../components/basics";
import { CiteButtons, PrecedentCard, STYLE_LABEL } from "../components/PrecedentCard";
import { PageHeader } from "../components/Shell";
import { useData, useRun, useUI } from "../context";
import { href, navigate } from "../router";

export function PrecedentsPage({ q: initialQ }: { q?: string }) {
  const ds = useData();
  const ui = useUI();
  const [q, setQ] = useState(initialQ || "");
  const [court, setCourt] = useState("");
  const [onlyBinding, setOnlyBinding] = useState(false);
  const all = Object.values(ds.precedents);
  const courts = [...new Set(all.map((p) => p.court))].sort();
  const f = fold(q).trim();
  const list = all
    .filter((p) => !court || p.court === court)
    .filter((p) => !onlyBinding || p.binding)
    .filter((p) => {
      if (!f) return true;
      const hay = fold([p.court, p.className, p.number, p.uf, p.rapporteur, p.body, p.summary, p.thesis, ...(p.topics || []), ...p.parties.map((x) => `${x.name} ${x.role}`)].join(" "));
      return f.split(/\s+/).every((w) => hay.includes(w));
    })
    .sort((a, b) => (b.judgedAt || b.createdAt).localeCompare(a.judgedAt || a.createdAt));
  return (
    <div className="page">
      <PageHeader
        title="Jurisprudência"
        subtitle="Decisões, súmulas e temas usados nas petições, com as partes de cada julgado e a citação pronta."
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => navigate("/citacoes")}>
              Verificar citações
            </button>
            <button className="btn btn-primary" onClick={() => ui.open({ type: "precedent" })}>
              <Plus size={17} /> Nova jurisprudência
            </button>
          </>
        }
      />
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, tema, parte (ex.: Banco Alfa), relator, palavra da ementa" aria-label="Filtrar jurisprudência" />
        </div>
        {courts.length > 1 && (
          <select value={court} onChange={(e) => setCourt(e.target.value)} aria-label="Tribunal">
            <option value="">Todos os tribunais</option>
            {courts.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={onlyBinding} onChange={(e) => setOnlyBinding(e.target.checked)} /> Só precedentes qualificados
        </label>
      </div>
      {!list.length ? (
        <Empty
          icon={<Library size={30} />}
          title={all.length ? "Nada encontrado" : "A base de jurisprudência está vazia"}
          action={
            !all.length && (
              <button className="btn btn-primary" onClick={() => ui.open({ type: "precedent" })}>
                Cadastrar a primeira decisão
              </button>
            )
          }
        >
          {all.length
            ? "Mude os filtros."
            : `Cole o cabeçalho e a ementa de um acórdão (ou o texto de uma súmula): o ${APP_NAME} lê o tribunal, a classe, o número, o relator, as datas e as partes.`}
        </Empty>
      ) : (
        <div className="cards">
          {list.map((p) => (
            <PrecedentCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PrecedentPage({ id }: { id: string }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const p = ds.precedents[id];
  if (!p)
    return (
      <div className="page">
        <Empty title="Decisão não encontrada" action={<a className="btn btn-primary" href={href("/jurisprudencia")}>Voltar à base</a>} />
      </div>
    );
  const cases = Object.values(ds.cases);
  const shared = sharedParties(p, cases);
  const issue = precedentNumberCheck(p);
  const doc = p.docId ? ds.docs[p.docId] : undefined;
  return (
    <div className="page">
      <PageHeader
        title={`${p.court} · ${p.className} ${p.number}${p.uf ? `/${p.uf}` : ""}`}
        subtitle={[p.rapporteur && `${p.female ? "Relatora" : "Relator"}: ${p.rapporteur}`, p.body, p.judgedAt && `julgado em ${formatDate(p.judgedAt)}`].filter(Boolean).join(" · ")}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => ui.open({ type: "import", mode: "documento", precedentId: id })} title="Guardar o inteiro teor na base">
              <FileUp size={16} /> <span className="hide-sm">Inteiro teor</span>
            </button>
            <button className="btn btn-ghost" onClick={() => ui.open({ type: "precedent", precedentId: id })}>
              <Pencil size={16} /> Editar
            </button>
            <button
              className="icon-btn"
              aria-label="Apagar"
              title="Apagar"
              onClick={() =>
                ui.open({
                  type: "confirm",
                  title: "Apagar a decisão da base?",
                  message: "Os processos perdem o vínculo com ela.",
                  confirmLabel: "Apagar",
                  danger: true,
                  onConfirm: () => runAction(A.deletePrecedent, id) && navigate("/jurisprudencia"),
                })
              }
            >
              <Trash size={18} />
            </button>
          </>
        }
      />
      <div className="case-grid">
        <div className="case-col">
          <section className="card">
            <div className="card-head">
              <h2>Citação</h2>
              <CiteButtons p={p} />
            </div>
            {(["forense", "stj", "abnt"] as CitationStyle[]).map((style) => (
              <div key={style} className="cite-style">
                <div className="muted small">{STYLE_LABEL[style]}</div>
                <div className="cite-text">{formatCitation(p, style)}</div>
                <CopyButton text={citationBlock(p, style, ds.prefs.quoteSummary).text} html={citationBlock(p, style, ds.prefs.quoteSummary).html} />
              </div>
            ))}
            <p className="muted small pad">
              "Copiar com a ementa" traz a referência e, na linha de baixo, a ementa como citação direta (no Word, com recuo de 4 cm e letra menor, como pede a ABNT).
            </p>
          </section>
          {p.summary && (
            <section className="card">
              <div className="card-head">
                <h2>{/sumula/i.test(fold(p.className)) ? "Enunciado" : "Ementa"}</h2>
                <CopyButton text={p.summary} />
              </div>
              <p className="pad summary">{p.summary}</p>
            </section>
          )}
          {p.thesis && (
            <section className="card">
              <div className="card-head">
                <h2>Tese</h2>
              </div>
              <p className="pad">{p.thesis}</p>
            </section>
          )}
        </div>
        <div className="case-col">
          <section className="card">
            <div className="card-head">
              <h2>Situação</h2>
            </div>
            <div className="pad stack">
              <div className="chips">
                {p.binding && <span className="chip tone-info">{BINDINGS[p.binding]}{p.bindingNumber ? ` ${p.bindingNumber}` : ""}</span>}
                <span className={`chip ${p.standing === "vigente" ? "tone-ok" : "tone-danger"}`}>{STANDINGS[p.standing]}</span>
                {p.checkedAt ? (
                  <span className="chip tone-ok">
                    <BadgeCheck size={12} /> conferida em {formatDate(p.checkedAt)}
                  </span>
                ) : (
                  <span className="chip tone-warn">ainda não conferida na fonte oficial</span>
                )}
              </div>
              {issue && <p className="field-error">{issue}</p>}
              {!p.checkedAt && (
                <button className="btn btn-ghost btn-sm" onClick={() => runAction(A.setChecked, id, true) && ui.toast("Marcada como conferida hoje.")}>
                  <BadgeCheck size={15} /> Conferi na fonte oficial
                </button>
              )}
              {p.publishedAt && (
                <div className="muted small">
                  Publicação: {p.source || "DJe"} de {formatDate(p.publishedAt)}
                </div>
              )}
              {p.url && (
                <a className="link" href={p.url} target="_blank" rel="noreferrer">
                  Abrir no site
                </a>
              )}
              {doc && (
                <button className="link-btn" onClick={() => ui.open({ type: "doc", docId: doc.id })}>
                  Ler o inteiro teor
                </button>
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h2>
                <Users size={18} /> Partes
              </h2>
            </div>
            {p.parties.length ? (
              <div className="pad stack">
                {p.parties.map((x, i) => (
                  <div key={i} className="party">
                    <div className="party-name">
                      <span className="muted">{x.role}:</span> {x.name}
                    </div>
                    {x.lawyers && <div className="party-lawyers">{x.lawyers}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted pad">Sem partes cadastradas (cole o cabeçalho do acórdão em Editar para identificá-las).</p>
            )}
            {shared.length > 0 && (
              <div className="banner info small">
                <Users size={16} />
                <div>
                  Parte em comum com os seus processos:
                  {shared.map((s) => (
                    <div key={s.caseId + s.party}>
                      <a className="link" href={href(`/processos/${s.caseId}`)}>
                        {caseLabel(ds.cases[s.caseId])}
                      </a>{" "}
                      ({s.party} · aqui como {s.precedentParty})
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Usada nos processos</h2>
            </div>
            {p.caseIds.length ? (
              <div className="pad stack">
                {p.caseIds.map((cid) => ds.cases[cid] && (
                  <a key={cid} className="link" href={href(`/processos/${cid}/jurisprudencia`)}>
                    {caseLabel(ds.cases[cid])}
                  </a>
                ))}
              </div>
            ) : (
              <p className="muted pad">Nenhum processo vinculado.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
