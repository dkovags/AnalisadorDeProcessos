import { ChevronDown, FileStack, FileText, Search, Sparkles, Trash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { courtRef } from "../../../domain/casefile";
import { formatDate } from "../../../domain/dates";
import { DOC_TYPES, ORDER_TYPES } from "../../../domain/labels";
import { docsOfCase } from "../../../domain/select";
import type { Case, Doc, DocType } from "../../../domain/types";
import * as A from "../../../store/actions";
import { Empty, Highlighted } from "../../components/basics";
import { DropZone } from "../../components/DropZone";
import { useData, useRun, useStore, useUI } from "../../context";
import { searchableDocs, searchDocs, type DocResult } from "../../searchDocs";

function DocRow({ d, child }: { d: Doc; child?: boolean }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const file = ds.files[d.fileId];
  const pages = d.pages ? d.pages[1] - d.pages[0] + 1 : file?.pageCount;
  return (
    <div className={`doc-row ${child ? "child" : ""}`}>
      <button className="doc-main" onClick={() => ui.open({ type: "doc", docId: d.id })}>
        <FileText size={16} />
        <div>
          <div className="doc-title">{d.title}</div>
          <div className="doc-meta">
            <span className="chip tone-muted">{DOC_TYPES[d.type]}</span>
            {d.date && <span>{formatDate(d.date)}</span>}
            {courtRef(d.courtId) && <span>{courtRef(d.courtId)}</span>}
            {d.signer && <span className="hide-sm">{d.signer}</span>}
            {pages ? <span>{pages === 1 ? "1 página" : `${pages} páginas`}</span> : null}
          </div>
        </div>
      </button>
      {ORDER_TYPES.includes(d.type) && (
        <button className="btn btn-ghost btn-sm" title="Ler a ordem e registrar o expediente com o prazo" onClick={() => ui.open({ type: "notice", caseId: d.caseId, docId: d.id })}>
          <Sparkles size={14} /> <span className="hide-sm">Analisar</span>
        </button>
      )}
      <button
        className="icon-btn small"
        aria-label="Apagar o documento"
        title="Apagar o documento"
        onClick={() =>
          ui.open({
            type: "confirm",
            title: "Apagar o documento?",
            message: d.type === "processo" ? "Apaga o processo integral e todos os documentos separados dele." : `Apaga "${d.title}" da base de conhecimento.`,
            confirmLabel: "Apagar",
            danger: true,
            onConfirm: () => runAction(A.deleteDoc, d.id),
          })
        }
      >
        <Trash size={15} />
      </button>
    </div>
  );
}

export function CaseDocuments({ c, q: initialQ }: { c: Case; q?: string }) {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const [q, setQ] = useState(initialQ || "");
  const [type, setType] = useState<DocType | "">("");
  const [results, setResults] = useState<DocResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const docs = docsOfCase(ds, c.id);
  const searchable = useMemo(() => searchableDocs(ds, docs), [ds, docs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      return;
    }
    const signal = { cancelled: false };
    const t = setTimeout(async () => {
      setBusy(true);
      const res = await searchDocs(store, searchable, query, undefined, signal);
      if (!signal.cancelled) {
        setResults(res);
        setBusy(false);
      }
    }, 250);
    return () => {
      signal.cancelled = true;
      clearTimeout(t);
    };
  }, [q, store, searchable]);

  const parents = docs.filter((d) => d.type === "processo");
  const children = (id: string) =>
    docs.filter((d) => d.parentId === id).sort((a, b) => (a.pages?.[0] || 0) - (b.pages?.[0] || 0));
  const loose = docs.filter((d) => d.type !== "processo" && !d.parentId);
  const types = [...new Set(docs.map((d) => d.type))];
  const filtered = type ? docs.filter((d) => d.type === type) : null;

  return (
    <div className="tab-body">
      <DropZone compact onFiles={(files) => ui.open({ type: "import", caseId: c.id, files })}>
        <strong>Enviar para a base deste processo</strong>: o processo integral, documentos (PDF, Word, texto) ou o expediente.{" "}
        <span className="muted">Arraste os arquivos ou toque aqui.</span>
      </DropZone>
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Pesquisar nos documentos: palavras, "frase exata", -excluir' aria-label="Pesquisar nos documentos do processo" />
        </div>
        {types.length > 1 && !q && (
          <select value={type} onChange={(e) => setType(e.target.value as DocType | "")} aria-label="Tipo de documento">
            <option value="">Todos os tipos</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPES[t]}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-ghost" onClick={() => ui.open({ type: "import", caseId: c.id, mode: "documento" })}>
          Colar texto
        </button>
      </div>

      {q.trim().length >= 2 ? (
        <div className="results">
          {busy && !results && <p className="muted pad">Pesquisando…</p>}
          {results && (
            <p className="muted small">
              {results.length ? `${results.length} ${results.length === 1 ? "documento" : "documentos"} com os termos` : "Nada encontrado nos documentos deste processo."}
            </p>
          )}
          {results?.map((r) => (
            <button key={r.doc.id} className="result" onClick={() => ui.open({ type: "doc", docId: r.doc.id, q, page: r.page })}>
              <div className="result-title">
                {r.doc.title}
                <span className="chip tone-muted">{DOC_TYPES[r.doc.type]}</span>
                {r.doc.date && <span className="muted small">{formatDate(r.doc.date)}</span>}
              </div>
              <div className="result-snippet">
                <Highlighted segments={r.snippet} />
              </div>
              <div className="muted small">
                página {r.page} do arquivo · {r.hit.counts.reduce((a, b) => a + b, 0)} ocorrências
              </div>
            </button>
          ))}
        </div>
      ) : !docs.length ? (
        <Empty icon={<FileStack size={28} />} title="Nenhum documento na base deste processo">
          Envie o PDF do processo inteiro (baixado do PJe, do eproc ou do e-SAJ): ele é separado em documentos e fica pesquisável.
        </Empty>
      ) : filtered ? (
        <div className="doc-list">
          {filtered.map((d) => (
            <DocRow key={d.id} d={d} />
          ))}
        </div>
      ) : (
        <div className="doc-list">
          {parents.map((p) => {
            const kids = children(p.id);
            const isOpen = openGroups[p.id] ?? false;
            return (
              <div key={p.id} className="doc-group">
                <div className="doc-group-head">
                  <DocRow d={p} />
                  {kids.length > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setOpenGroups({ ...openGroups, [p.id]: !isOpen })}>
                      <ChevronDown size={14} className={isOpen ? "rot" : ""} /> {kids.length} documentos
                    </button>
                  )}
                </div>
                {isOpen && kids.map((d) => <DocRow key={d.id} d={d} child />)}
              </div>
            );
          })}
          {loose.map((d) => (
            <DocRow key={d.id} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}
