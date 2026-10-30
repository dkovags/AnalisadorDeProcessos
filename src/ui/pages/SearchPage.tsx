import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "../../domain/dates";
import { DOC_TYPES } from "../../domain/labels";
import { compile, highlight } from "../../domain/search";
import { caseLabel } from "../../domain/select";
import { excerpt, fold } from "../../domain/text";
import { Empty, Highlighted } from "../components/basics";
import { PageHeader } from "../components/Shell";
import { useData, useStore, useUI } from "../context";
import { href, navigate } from "../router";
import { searchableDocs, searchDocs, type DocResult } from "../searchDocs";

/** Pesquisa em toda a base: documentos de todos os processos e a jurisprudência cadastrada. */
export function SearchPage({ q: initialQ }: { q?: string }) {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const [q, setQ] = useState(initialQ || "");
  const [results, setResults] = useState<DocResult[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const docs = useMemo(() => searchableDocs(ds, Object.values(ds.docs)), [ds]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      return;
    }
    navigate(`/pesquisa?q=${encodeURIComponent(query)}`, { replace: true });
    const signal = { cancelled: false };
    const t = setTimeout(async () => {
      setProgress({ done: 0, total: docs.length });
      const res = await searchDocs(store, docs, query, (done, total) => !signal.cancelled && setProgress({ done, total }), signal);
      if (!signal.cancelled) {
        setResults(res);
        setProgress(null);
      }
    }, 300);
    return () => {
      signal.cancelled = true;
      clearTimeout(t);
    };
  }, [q, store, docs]);

  const m = useMemo(() => compile(q), [q]);
  const precedents = useMemo(() => {
    if (m.empty) return [];
    return Object.values(ds.precedents).filter((p) => {
      const hay = [p.court, p.className, p.number, p.rapporteur, p.body, p.summary, p.thesis, ...(p.topics || []), ...p.parties.map((x) => x.name)].join(" ");
      return m.parts.every((re) => {
        re.lastIndex = 0;
        return re.test(hay);
      });
    });
  }, [ds, m]);
  const cases = useMemo(() => {
    const f = fold(q).trim();
    if (f.length < 2) return [];
    return Object.values(ds.cases).filter((c) => fold([c.number, c.title, ...c.parties.map((p) => p.name)].join(" ")).includes(f));
  }, [ds, q]);

  return (
    <div className="page">
      <PageHeader title="Pesquisa nos autos" subtitle="Em todos os documentos guardados e na jurisprudência. Sem acentos e sem diferença de maiúsculas." />
      <div className="search-box big">
        <Search size={20} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder='Ex.: "dano moral" negativação -prescrição' aria-label="Pesquisar" />
      </div>
      <p className="muted small">
        Dicas: palavras são procuradas pelo começo (<i>intim</i> acha intimação); use aspas para a frase exata e o sinal de menos para excluir.
      </p>
      {progress && progress.total > 0 && (
        <div className="progress">
          <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
      {q.trim().length < 2 ? (
        <Empty icon={<Search size={30} />} title="O que você procura?">
          {Object.keys(ds.docs).length} documentos e {Object.keys(ds.precedents).length} decisões na base.
        </Empty>
      ) : (
        <div className="search-results">
          {cases.length > 0 && (
            <section className="section">
              <h3 className="section-title">Processos</h3>
              {cases.map((c) => (
                <a key={c.id} className="result" href={href(`/processos/${c.id}`)}>
                  <div className="result-title">{caseLabel(c)}</div>
                  <div className="muted small">{c.number}</div>
                </a>
              ))}
            </section>
          )}
          {precedents.length > 0 && (
            <section className="section">
              <h3 className="section-title">Jurisprudência ({precedents.length})</h3>
              {precedents.slice(0, 20).map((p) => (
                <a key={p.id} className="result" href={href(`/jurisprudencia/${p.id}`)}>
                  <div className="result-title">
                    {p.court} · {p.className} {p.number}
                  </div>
                  {p.summary && (
                    <div className="result-snippet">
                      <Highlighted segments={highlight(excerpt(p.summary, 260), m)} />
                    </div>
                  )}
                </a>
              ))}
            </section>
          )}
          <section className="section">
            <h3 className="section-title">Documentos{results ? ` (${results.length})` : ""}</h3>
            {!results && <p className="muted pad">Pesquisando…</p>}
            {results && !results.length && <p className="muted pad">Nenhum documento com esses termos.</p>}
            {results?.map((r) => {
              const c = r.doc.caseId ? ds.cases[r.doc.caseId] : undefined;
              return (
                <button key={r.doc.id} className="result" onClick={() => ui.open({ type: "doc", docId: r.doc.id, q, page: r.page })}>
                  <div className="result-title">
                    {r.doc.title}
                    <span className="chip tone-muted">{DOC_TYPES[r.doc.type]}</span>
                    {r.doc.date && <span className="muted small">{formatDate(r.doc.date)}</span>}
                  </div>
                  {c && <div className="muted small">{caseLabel(c)} · {c.number}</div>}
                  <div className="result-snippet">
                    <Highlighted segments={r.snippet} />
                  </div>
                </button>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
