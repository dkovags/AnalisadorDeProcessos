import { Scissors } from "lucide-react";
import { useMemo, useState } from "react";
import { courtRef } from "../../domain/casefile";
import { DOC_TYPES } from "../../domain/labels";
import { pageMap, pagesToCut, representationOf } from "../../domain/representation";
import type { FileMeta, ID } from "../../domain/types";
import * as A from "../../store/actions";
import { kindOf } from "../../store/extract";
import { newId } from "../../store/ids";
import { cutPdf, PdfCutError } from "../../store/pdfcut";
import { Modal } from "../components/basics";
import { useData, useRun, useStore, useUI } from "../context";

/**
 * Corta documentos de um processo integral já guardado (substabelecimentos, cartas de preposição, atos constitutivos
 * e o que mais a pessoa escolher) e, se ela quiser, refaz o PDF sem essas páginas.
 */
export function CutDialog({ docId, onClose }: { docId: ID; onClose: () => void }) {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const runAction = useRun();
  const parent = ds.docs[docId];
  const file = parent ? ds.files[parent.fileId] : undefined;
  const kids = useMemo(
    () => Object.values(ds.docs).filter((d) => d.parentId === docId).sort((a, b) => (a.pages?.[0] || 0) - (b.pages?.[0] || 0)),
    [ds.docs, docId],
  );
  const [chosen, setChosen] = useState<Set<ID>>(() => new Set(kids.filter((d) => representationOf(d) === "representacao").map((d) => d.id)));
  const [fromPdf, setFromPdf] = useState(true);
  const [busy, setBusy] = useState(false);
  const isPdf = !!file && kindOf(file.name, file.mime) === "pdf";

  if (!parent || !file) return null;

  const toggle = (id: ID, on: boolean) =>
    setChosen((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const cut = async () => {
    const remove = kids.filter((d) => chosen.has(d.id));
    if (!remove.length) return;
    setBusy(true);
    try {
      let newFile: FileMeta | undefined;
      let map: number[] | undefined;
      let note = "";
      if (fromPdf && isPdf) {
        const others = Object.values(ds.docs).filter((d) => d.fileId === file.id && !chosen.has(d.id) && d.pages);
        const pages = await store.pages(file.id);
        const total = pages.length;
        const cutSet = pagesToCut(total, remove.flatMap((d) => (d.pages ? [d.pages] : [])), others.map((d) => d.pages!));
        const blob = await store.blob(file.id);
        if (cutSet.size && cutSet.size < total && blob) {
          try {
            map = pageMap(total, cutSet);
            const bytes = await cutPdf(new Uint8Array(await blob.arrayBuffer()), map);
            const m = map;
            newFile = {
              ...file,
              id: newId("f"),
              size: bytes.byteLength,
              pageCount: total - cutSet.size,
              emptyPages: file.emptyPages?.filter((p) => m[p]).map((p) => m[p]),
            };
            await store.saveFile(newFile, new Blob([bytes as BlobPart], { type: "application/pdf" }), pages.filter((_, i) => m[i + 1]));
            note = ` ${cutSet.size === 1 ? "1 página cortada" : `${cutSet.size} páginas cortadas`} do PDF.`;
          } catch (e) {
            console.error(e);
            newFile = undefined;
            map = undefined;
            note = ` O PDF ficou inteiro (${e instanceof PdfCutError ? e.message : "não deu para cortar"}).`;
          }
        }
      }
      const n = runAction(A.cutDocs, { fileId: file.id, remove: remove.map((d) => d.id), file: newFile, map });
      if (n === undefined) return;
      onClose();
      ui.toast(`${n === 1 ? "1 documento cortado" : `${n} documentos cortados`} da base.${note}`);
    } finally {
      setBusy(false);
    }
  };

  const reps = kids.filter((d) => representationOf(d) === "representacao").length;
  return (
    <Modal
      title="Cortar documentos"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={cut} disabled={busy || !chosen.size}>
            <Scissors size={16} /> {busy ? "Cortando…" : chosen.size === 1 ? "Cortar 1 documento" : `Cortar ${chosen.size} documentos`}
          </button>
        </>
      }
    >
      <p className="muted small">
        Marque os documentos que saem da base deste processo.{" "}
        {reps
          ? "Os substabelecimentos, as cartas de preposição e os atos constitutivos já vêm marcados;"
          : "Nenhum substabelecimento, carta de preposição ou ato constitutivo foi reconhecido pelo nome;"}{" "}
        as procurações ficam a seu critério (a do cliente pode servir para instruir petições).
      </p>
      <div className="doc-preview tall">
        {kids.map((d) => {
          const kind = representationOf(d);
          return (
            <label key={d.id} className={`doc-preview-row ${chosen.has(d.id) ? "out" : ""}`}>
              <input type="checkbox" checked={chosen.has(d.id)} onChange={(e) => toggle(d.id, e.target.checked)} aria-label={`Cortar ${d.title}`} />
              <span className="chip tone-muted">{DOC_TYPES[d.type]}</span>
              <span>
                {d.title}
                {kind && <span className="chip tone-info">{kind === "procuracao" ? "procuração" : "representação"}</span>}
              </span>
              <span className="muted small">{[courtRef(d.courtId), d.pages && `p. ${d.pages[0]}${d.pages[1] > d.pages[0] ? `–${d.pages[1]}` : ""}`].filter(Boolean).join(" · ")}</span>
            </label>
          );
        })}
      </div>
      {isPdf && (
        <label className="check">
          <input type="checkbox" checked={fromPdf} onChange={(e) => setFromPdf(e.target.checked)} /> Cortar também do PDF guardado (o arquivo fica menor; o original
          continua no sistema do tribunal)
        </label>
      )}
    </Modal>
  );
}
