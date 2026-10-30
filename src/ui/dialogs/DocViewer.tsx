import { CalendarPlus, Download, ExternalLink, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { courtRef } from "../../domain/casefile";
import { formatDate } from "../../domain/dates";
import { DOC_TYPES, ORDER_TYPES } from "../../domain/labels";
import { compile, highlight } from "../../domain/search";
import type { DocType } from "../../domain/types";
import * as A from "../../store/actions";
import { CopyButton, Field, Highlighted, Modal } from "../components/basics";
import { useData, usePages, useRun, useStore, useUI } from "../context";
import { downloadFile, openBlob } from "../download";
import { handOff } from "../handoff";
import { docRange } from "../searchDocs";
import { navigate } from "../router";

/** Leitura de um documento da base: texto por página, pesquisa com destaque e o arquivo original. */
export function DocViewer({ docId, q: initialQ, page, onClose }: { docId: string; q?: string; page?: number; onClose: () => void }) {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const runAction = useRun();
  const d = ds.docs[docId];
  const file = d ? ds.files[d.fileId] : undefined;
  const pages = usePages(d?.fileId);
  const [q, setQ] = useState(initialQ || "");
  const [edit, setEdit] = useState(false);
  const [meta, setMeta] = useState({ title: d?.title || "", type: (d?.type || "outro") as DocType, date: d?.date || "" });
  const body = useRef<HTMLDivElement>(null);
  const m = useMemo(() => compile(q), [q]);

  useEffect(() => {
    if (!pages || !page) return;
    const el = body.current?.querySelector(`[data-page="${page}"]`);
    el?.scrollIntoView({ block: "start" });
  }, [pages, page]);

  if (!d) return null;
  const [a, b] = pages ? docRange(d, pages.length) : [1, 1];
  const shown = pages ? pages.slice(a - 1, b).map((text, i) => ({ n: a + i, text })) : [];
  const text = shown.map((p) => p.text).join("\n\n");
  const hits = m.empty ? 0 : shown.reduce((n, p) => n + highlight(p.text, m).filter((s) => s.hit).length, 0);
  const pdf = file?.mime === "application/pdf";

  const open = async () => {
    const blob = await store.blob(d.fileId);
    if (!blob) return ui.toast("O arquivo original não está guardado neste aparelho.", { kind: "error" });
    openBlob(blob, pdf ? a : undefined);
  };
  const download = async () => {
    const blob = await store.blob(d.fileId);
    if (blob) downloadFile(file?.name || `${d.title}.txt`, blob, blob.type);
  };

  return (
    <Modal title={d.title} onClose={onClose} wide className="viewer">
      <div className="viewer-bar">
        <div className="doc-meta">
          <span className="chip tone-muted">{DOC_TYPES[d.type]}</span>
          {d.date && <span>{formatDate(d.date)}</span>}
          {courtRef(d.courtId) && <span>{courtRef(d.courtId)}</span>}
          {d.signer && <span>{d.signer}</span>}
          {d.pages && <span>páginas {d.pages[0]} a {d.pages[1]} do arquivo</span>}
        </div>
        <div className="viewer-actions">
          {file && (
            <button className="btn btn-ghost btn-sm" onClick={open} title={pdf ? "Abrir o PDF na primeira página do documento" : "Abrir o arquivo"}>
              <ExternalLink size={15} /> Abrir {pdf ? "o PDF" : "o arquivo"}
            </button>
          )}
          {file && (
            <button className="btn btn-ghost btn-sm" onClick={download}>
              <Download size={15} /> Baixar
            </button>
          )}
          {text && <CopyButton text={text} label="Copiar o texto" />}
          {ORDER_TYPES.includes(d.type) && d.caseId && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onClose();
                ui.open({ type: "notice", caseId: d.caseId, docId: d.id });
              }}
            >
              <CalendarPlus size={15} /> Registrar expediente
            </button>
          )}
          {text && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                handOff(text);
                onClose();
                navigate("/citacoes");
              }}
              title="Conferir as citações de jurisprudência deste documento"
            >
              <ShieldCheck size={15} /> Verificar citações
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setEdit(!edit)}>
            Editar dados
          </button>
        </div>
      </div>
      {edit && (
        <div className="form-grid viewer-edit">
          <Field label="Nome" className="span-2">
            <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </Field>
          <Field label="Tipo">
            <select value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value as DocType })}>
              {(Object.keys(DOC_TYPES) as DocType[]).map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPES[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data">
            <input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => runAction(A.updateDoc, d.id, { title: meta.title, type: meta.type, date: meta.date || undefined }) && (setEdit(false), ui.toast("Documento atualizado."))}
          >
            Salvar
          </button>
        </div>
      )}
      <div className="search-box viewer-search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar neste documento" aria-label="Procurar neste documento" />
        {!m.empty && <span className="muted small">{hits} ocorrências</span>}
      </div>
      <div className="viewer-body" ref={body}>
        {!pages && <p className="muted">Carregando o texto…</p>}
        {pages && !text.trim() && (
          <p className="muted">
            Este documento não tem texto pesquisável (imagem digitalizada). Abra o arquivo original para ler.
          </p>
        )}
        {shown.map((p) => (
          <section key={p.n} className="viewer-page" data-page={p.n}>
            <div className="viewer-page-n">Página {p.n}</div>
            <div className="pre">{m.empty ? p.text : <Highlighted segments={highlight(p.text, m)} />}</div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
