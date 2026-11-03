import { CalendarClock, FileStack, Files, ScanText, Scissors, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { APP_NAME } from "../../config";
import { analyze, classifyText } from "../../domain/analysis";
import { courtRef, firstStampedPage, parseCaseFile, type CaseFileInfo } from "../../domain/casefile";
import { checkCaseNumber, cnjInFileName } from "../../domain/cnj";
import { formatDate } from "../../domain/dates";
import { findDates } from "../../domain/text";
import { DOC_TYPES, POLES } from "../../domain/labels";
import { pageMap, pagesToCut, representationOf, type RepresentationKind } from "../../domain/representation";
import { caseLabel } from "../../domain/select";
import type { DocType, FileMeta } from "../../domain/types";
import * as A from "../../store/actions";
import { kindOf, paginate, type Extracted } from "../../store/extract";
import { newId } from "../../store/ids";
import { loadPdfJs, persistStorage, readFileText, sha256 } from "../../store/ingest";
import { ocrMinutes, ocrPdfPages } from "../../store/ocr";
import { cutPdf, PdfCutError } from "../../store/pdfcut";
import { run } from "../../store/store";
import { Field, fileSize, Modal } from "../components/basics";
import { DropZone } from "../components/DropZone";
import { useData, useStore, useToday, useUI } from "../context";
import { casePath, navigate } from "../router";
import { isReloading, isStaleChunk, reloadForUpdate } from "../update";

type Mode = "processo" | "documento" | "expediente";

interface ReadFile {
  key: string;
  file: File | null;
  name: string;
  mime: string;
  size: number;
  text: Extracted;
  sha?: string;
  duplicateOf?: string;
  title: string;
  type: DocType;
  date: string;
  caseId: string;
  /** Páginas cujo texto veio da leitura das imagens (OCR). */
  ocrPages?: number[];
  /** Páginas digitalizadas em que só as margens (o carimbo do tribunal) foram lidas. */
  marginPages?: number[];
}

/** Leitura do texto das imagens: a capa (as primeiras páginas), só o carimbo de cada página, ou tudo. */
type OcrScope = "capa" | "margens" | "todas";

const OCR_LABEL: Record<OcrScope, string> = {
  capa: "Lendo a capa do processo",
  margens: "Separando os documentos: lendo o carimbo de cada página",
  todas: "Lendo o texto das imagens",
};

/** Páginas que cada leitura ainda tem a ler. */
function ocrTargets(it: ReadFile, scope: OcrScope): number[] {
  if (scope === "capa") return it.text.empty.filter((p) => p <= 6).slice(0, 4);
  if (scope === "margens") {
    const done = new Set(it.marginPages);
    return it.text.empty.filter((p) => !done.has(p));
  }
  return it.text.empty;
}

const MODES: { id: Mode; title: string; text: string; icon: ReactNode }[] = [
  { id: "processo", title: "Processo integral", text: "O PDF do processo inteiro, baixado do PJe, do eproc ou do e-SAJ. Lê a capa e as partes e separa cada documento.", icon: <FileStack size={22} /> },
  { id: "documento", title: "Documentos", text: "Petições, decisões, provas, contratos (PDF, Word, texto). Cada arquivo vira um documento da base.", icon: <Files size={22} /> },
  { id: "expediente", title: "Expediente", text: "Intimação, citação ou publicação do DJEN. Guarda o texto e abre o registro do prazo.", icon: <CalendarClock size={22} /> },
];

/** Tempo que falta na leitura das imagens, pelo ritmo das páginas já lidas. */
function ocrLeft(o: { done: number; total: number; started: number }): string {
  if (!o.done) return "preparando a leitura…";
  const seconds = ((Date.now() - o.started) / 1000 / o.done) * (o.total - o.done);
  if (seconds < 60) return "menos de 1 minuto para terminar";
  const min = Math.round(seconds / 60);
  return `cerca de ${min} ${min === 1 ? "minuto" : "minutos"} para terminar`;
}

/** Data do documento: a da assinatura eletrônica ou a última data do texto (sem datas futuras). */
function guessDate(pages: string[], today: string): string {
  for (const page of pages) {
    const signed = page.match(/Assinado eletronicamente por:.*?(\d{2}\/\d{2}\/\d{4})/);
    if (signed) return findDates(signed[1])[0]?.iso || "";
  }
  const dates = findDates(pages.slice(-2).join("\n").slice(-3000)).filter((d) => d.iso <= today);
  return dates.at(-1)?.iso || "";
}

function niceTitle(name: string, type: DocType): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return base.replace(/[^\p{L}]/gu, "").length >= 3 ? base : DOC_TYPES[type];
}

export function ImportDialog({
  caseId,
  precedentId,
  mode: initialMode,
  files: initialFiles,
  onClose,
}: {
  caseId?: string;
  /** Inteiro teor de uma decisão da base de jurisprudência. */
  precedentId?: string;
  mode?: Mode;
  files?: File[];
  onClose: () => void;
}) {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const today = useToday();
  const [mode, setMode] = useState<Mode>(initialMode || (caseId ? "documento" : "processo"));
  const [step, setStep] = useState<"choose" | "reading" | "review" | "saving">("choose");
  const [progress, setProgress] = useState({ file: "", done: 0, total: 0 });
  const [items, setItems] = useState<ReadFile[]>([]);
  const [paste, setPaste] = useState("");
  const [info, setInfo] = useState<CaseFileInfo | null>(null);
  const [target, setTarget] = useState<string>(caseId || "");
  const [numberFromName, setNumberFromName] = useState(false);
  // número digitado, quando não foi achado no arquivo
  const [typedNumber, setTypedNumber] = useState("");
  const typedCheck = typedNumber.trim() ? checkCaseNumber(typedNumber) : null;
  // leitura do texto das imagens (OCR): o andamento e o botão de interromper
  const [ocr, setOcr] = useState<{ done: number; total: number; started: number; label: string } | null>(null);
  // PDF digitalizado: a capa é lida assim que o arquivo abre
  const [autoCover, setAutoCover] = useState(false);
  const ocrCtrl = useRef<AbortController | null>(null);
  useEffect(() => () => ocrCtrl.current?.abort(), []);
  const [clientIdx, setClientIdx] = useState(0);
  // documentos de representação: ficam de fora da base e, se a pessoa quiser, saem do PDF guardado
  const [cutRep, setCutRep] = useState(true);
  const [cutProc, setCutProc] = useState(false);
  const [cutFromPdf, setCutFromPdf] = useState(true);
  const [keep, setKeep] = useState<Record<number, boolean>>({});
  const kinds = useMemo<(RepresentationKind | undefined)[]>(() => info?.docs.map((d) => representationOf(d)) || [], [info]);
  const isOut = (i: number) => (keep[i] !== undefined ? !keep[i] : (kinds[i] === "representacao" && cutRep) || (kinds[i] === "procuracao" && cutProc));
  const outCount = info ? info.docs.filter((_, i) => isOut(i)).length : 0;
  const repCount = kinds.filter((k) => k === "representacao").length;
  const procCount = kinds.filter((k) => k === "procuracao").length;
  /** Liga ou desliga uma categoria, desfazendo as escolhas feitas à mão nos documentos dela. */
  const toggleKind = (kind: RepresentationKind, on: boolean) => {
    (kind === "representacao" ? setCutRep : setCutProc)(on);
    setKeep((k) => Object.fromEntries(Object.entries(k).filter(([i]) => kinds[Number(i)] !== kind)));
  };
  const started = useRef(false);
  const cases = Object.values(ds.cases).sort((a, b) => caseLabel(a).localeCompare(caseLabel(b), "pt-BR"));

  /** Lê a capa, as partes e os documentos do texto (o número, se não estiver na capa, pode vir do nome do arquivo). */
  const parseItem = (it: ReadFile): CaseFileInfo => {
    const parsed = parseCaseFile(it.text.pages, { outline: it.text.outline, layout: it.text.layout });
    // sem o número na capa (ex.: PDF só de imagens), o nome do arquivo baixado do tribunal costuma trazê-lo
    const fromName = parsed.number && !parsed.numberGuessed ? undefined : cnjInFileName(it.name);
    if (fromName) {
      parsed.number = fromName;
      parsed.numberGuessed = false;
    }
    setNumberFromName(!!fromName);
    setInfo(parsed);
    setKeep({});
    setClientIdx(0);
    return parsed;
  };

  const read = async (files: File[], text?: string) => {
    setStep("reading");
    const out: ReadFile[] = [];
    try {
      const sources: { file: File | null; name: string; mime: string; size: number; get: () => Promise<Extracted> }[] = text
        ? [{ file: null, name: "Texto colado.txt", mime: "text/plain", size: new Blob([text]).size, get: async () => ({ pages: paginate(text), empty: [], kind: "text" as const }) }]
        : files.map((f) => ({ file: f, name: f.name, mime: f.type || "application/octet-stream", size: f.size, get: () => readFileText(f, (done, total) => setProgress({ file: f.name, done, total })) }));
      for (const s of sources) {
        setProgress({ file: s.name, done: 0, total: 0 });
        const extracted = await s.get();
        const sha = s.file ? await sha256(s.file) : undefined;
        const dup = sha ? Object.values(ds.files).find((x) => x.sha === sha) : undefined;
        // A análise usa só o começo; não junte o texto inteiro de milhares de páginas.
        let all = "";
        for (const page of extracted.pages) {
          all += page.slice(0, 40000 - all.length) + "\n";
          if (all.length >= 40000) break;
        }
        const a = analyze(all.slice(0, 40000));
        const type: DocType = mode === "expediente" ? (a.kind === "citacao" ? "citacao" : a.docType === "outro" || a.docType === "peticao" ? "intimacao" : a.docType) : classifyText(all);
        const detected = a.caseNumber ? A.findCaseByNumber(ds, a.caseNumber)?.id : undefined;
        out.push({
          key: newId("k"),
          file: s.file,
          name: s.name,
          mime: s.mime,
          size: s.size,
          text: extracted,
          sha,
          duplicateOf: dup?.name,
          title: niceTitle(s.name, type),
          type,
          date: guessDate(extracted.pages, today),
          caseId: caseId || target || detected || "",
        });
      }
    } catch (e) {
      console.error(e);
      // aba aberta antes de uma versão nova: o leitor de PDF desta versão não está mais no site
      if (isStaleChunk(e) && (isReloading() || reloadForUpdate())) return;
      ui.toast(
        isStaleChunk(e)
          ? `O ${APP_NAME} foi atualizado e precisa ser recarregado: recarregue a página e envie o arquivo de novo.`
          : `Não foi possível ler o arquivo: ${(e as Error).message || e}`,
        { kind: "error" },
      );
      setStep("choose");
      return;
    }
    setItems(out);
    if (mode === "processo" && out[0]) {
      const parsed = parseItem(out[0]);
      const existing = caseId || (parsed.number ? A.findCaseByNumber(ds, parsed.number)?.id : undefined) || "";
      setTarget(existing);
      setTypedNumber("");
      // a primeira página é imagem: a capa (número, partes, índice dos documentos) só sai lendo a imagem
      setAutoCover(!!out[0].file && out[0].text.kind === "pdf" && out[0].text.empty.includes(1));
    }
    setStep("review");
  };

  useEffect(() => {
    if (initialFiles?.length && !started.current) {
      started.current = true;
      void read(initialFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Uma leitura das imagens: devolve o arquivo com o texto lido juntado ao das páginas. */
  const ocrPass = async (it: ReadFile, targets: number[], margins: boolean, label: string, signal: AbortSignal): Promise<{ it: ReadFile; read: number }> => {
    if (!targets.length || signal.aborted) return { it, read: 0 };
    setOcr({ done: 0, total: targets.length, started: Date.now(), label });
    const found = await ocrPdfPages(it.file!, targets, loadPdfJs, { signal, margins, onPage: (_p, _t, done) => setOcr((o) => (o ? { ...o, done } : o)) });
    if (!found.size) return { it, read: 0 };
    if (margins) {
      // só o carimbo: a página continua sem o texto inteiro (e pode ser lida inteira depois)
      const pages = it.text.pages.map((t, i) => {
        const f = found.get(i + 1);
        return f === undefined ? t : t.trim() ? `${t}\n${f}` : f;
      });
      const marginPages = [...new Set([...(it.marginPages || []), ...found.keys()])].sort((a, b) => a - b);
      return { it: { ...it, text: { ...it.text, pages }, marginPages }, read: found.size };
    }
    const pages = it.text.pages.map((t, i) => found.get(i + 1) ?? t);
    const empty = it.text.empty.filter((p) => (found.get(p) ?? "").replace(/\s/g, "").length < 15);
    const ocrPages = [...new Set([...(it.ocrPages || []), ...found.keys()])].sort((a, b) => a - b);
    return { it: { ...it, text: { ...it.text, pages, empty }, ocrPages }, read: found.size };
  };

  /** Lê o texto das páginas que são imagem: a capa, só o carimbo de cada página (para separar os documentos) ou tudo. */
  const runOcr = async (scope: OcrScope) => {
    const idx = items.findIndex((it) => it.file && it.text.kind === "pdf" && it.text.empty.length);
    if (idx < 0) return;
    let it = items[idx];
    const ctrl = new AbortController();
    ocrCtrl.current = ctrl;
    let read = 0;
    try {
      const first = await ocrPass(it, ocrTargets(it, scope), scope === "margens", OCR_LABEL[scope], ctrl.signal);
      it = first.it;
      read = first.read;
      // Preserve a primeira passagem mesmo se a leitura seguinte da capa falhar.
      const firstRead = it;
      setItems((list) => list.map((x, i) => (i === idx ? firstRead : x)));
      if (read && mode === "processo" && idx === 0) parseItem(firstRead);
      let coverRead = 0;
      if (scope === "margens") {
        // a capa e o índice (as páginas antes do primeiro carimbo) são lidos inteiros: deles vêm o número, as
        // partes e o nome de cada documento
        const stamped = firstStampedPage(it.text.pages);
        const whole = new Set(it.ocrPages);
        const cover = it.text.empty.filter((p) => (stamped ? p < stamped : p <= 4) && !whole.has(p)).slice(0, 12);
        const r = await ocrPass(it, cover, false, OCR_LABEL.capa, ctrl.signal);
        it = r.it;
        coverRead = r.read;
      }
      if (!read && !coverRead) return;
      const done = it;
      setItems((list) => list.map((x, i) => (i === idx ? done : x)));
      let parsed: CaseFileInfo | undefined;
      if (mode === "processo" && idx === 0) {
        // com o texto, a capa, as partes e os carimbos das páginas podem ser lidos
        parsed = parseItem(done);
        if (!caseId && !target && parsed.number) setTarget(A.findCaseByNumber(ds, parsed.number)?.id || "");
      }
      const docs = parsed && parsed.docs.length > 1 ? ` ${parsed.docs.length} documentos separados.` : "";
      ui.toast(
        ctrl.signal.aborted
          ? `Leitura interrompida: ${read} de ${ocrTargets(items[idx], scope).length} páginas lidas.${docs}`
          : scope === "capa"
            ? `Capa lida${parsed?.number ? "" : " (o número do processo não apareceu nela)"}. Confira os dados: a leitura de imagens pode ter erros.`
            : scope === "margens"
              ? `Carimbo lido em ${read === 1 ? "1 página" : `${read} páginas`}.${docs || " Nenhum carimbo de tribunal apareceu: os documentos continuam juntos."}`
              : `Texto lido em ${read === 1 ? "1 página" : `${read} páginas`}. Confira os dados: a leitura de imagens pode ter erros.`,
      );
    } catch (e) {
      console.error(e);
      if (isStaleChunk(e) && (isReloading() || reloadForUpdate())) return;
      ui.toast(`Não foi possível ler o texto das imagens: ${(e as Error).message || e}`, { kind: "error" });
    } finally {
      ocrCtrl.current = null;
      setOcr(null);
    }
  };

  useEffect(() => {
    if (step !== "review" || !autoCover) return;
    setAutoCover(false);
    void runOcr("capa");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, autoCover]);

  /** Fechar no meio da leitura perde o que foi lido: pergunta antes. */
  const close = () => {
    if (!ocr) return onClose();
    ui.open({
      type: "confirm",
      title: "Interromper a leitura?",
      message: "O texto das imagens lido até agora se perde se você fechar a janela.",
      confirmLabel: "Fechar mesmo assim",
      danger: true,
      onConfirm: () => {
        ocrCtrl.current?.abort();
        onClose();
      },
    });
  };

  const saveFileOf = async (it: ReadFile): Promise<FileMeta> => {
    const meta: FileMeta = {
      id: newId("f"),
      name: it.name,
      mime: it.mime,
      size: it.size,
      pageCount: it.text.pages.length,
      emptyPages: it.text.empty.length ? it.text.empty : undefined,
      ocrPages: it.ocrPages?.length ? it.ocrPages : undefined,
      sha: it.sha,
      createdAt: new Date().toISOString(),
    };
    const blob = it.file || new Blob([it.text.pages.join("\n")], { type: "text/plain" });
    await store.saveFile(meta, blob, it.text.pages);
    return meta;
  };

  const save = async () => {
    setStep("saving");
    void persistStorage();
    try {
      if (mode === "processo" && info && items[0]) {
        const number = info.number || typedCheck?.formatted || "";
        if (!target && !number) {
          ui.toast("Digite o número do processo (ou escolha um processo já cadastrado em “Guardar em”).", { kind: "error" });
          setStep("review");
          return;
        }
        const out = info.docs.filter((_, i) => isOut(i));
        const docs = info.docs.filter((_, i) => !isOut(i));
        const it = items[0];
        // primeiro guarda o processo com o PDF inteiro; o corte vem depois, para um aparelho sem memória não perder a importação
        const meta = await saveFileOf(it);
        const res = run(store, A.importCaseFile, {
          file: meta,
          info: { ...info, docs },
          drop: out,
          caseId: target || undefined,
          create: target
            ? undefined
            : {
                number,
                court: undefined,
                system: info.system,
                body: info.body,
                className: info.className,
                subjects: info.subjects,
                rite: /juizado/i.test(`${info.className} ${info.body}`) ? "juizado" : /criminal|penal|acao penal/i.test(`${info.className}`) ? "penal" : "civel",
                status: "ativo",
                filedAt: info.filedAt,
                value: info.value,
                freeJustice: info.freeJustice,
                secret: info.secret,
                parties: info.parties.map((p, i) => ({
                  id: "",
                  name: p.name,
                  pole: p.pole,
                  role: p.role,
                  lawyers: p.lawyers.join("\n") || undefined,
                  doc: p.doc,
                  kind: p.kind,
                  doubleTerm: p.kind === "publico" || undefined,
                  client: i === clientIdx,
                })),
              },
        });
        let cutPages = 0;
        let cutNote = "";
        if (out.length && cutFromPdf && it.file && kindOf(it.name, it.mime) === "pdf") {
          const total = it.text.pages.length;
          const cut = pagesToCut(total, out.map((d) => d.pages), docs.map((d) => d.pages));
          if (cut.size && cut.size < total) {
            try {
              // só corta depois que o processo estiver gravado no aparelho
              await store.flush();
              const map = pageMap(total, cut);
              const smallerPdf = await cutPdf(it.file, map);
              const remap = (list?: number[]) => (list?.length ? list.filter((p) => map[p]).map((p) => map[p]) : undefined);
              const smaller: FileMeta = { ...meta, id: newId("f"), size: smallerPdf.size, pageCount: total - cut.size, emptyPages: remap(meta.emptyPages), ocrPages: remap(meta.ocrPages) };
              await store.saveFile(smaller, smallerPdf, it.text.pages.filter((_, i) => map[i + 1]));
              // os documentos guardados passam para o PDF menor, com as páginas renumeradas, e o inteiro sai
              run(store, A.cutDocs, { fileId: meta.id, remove: [], file: smaller, map });
              cutPages = cut.size;
            } catch (e) {
              console.error(e);
              cutNote = ` O PDF ficou inteiro (${e instanceof PdfCutError ? e.message : "não deu para cortar"}): os documentos saíram da lista, mas as páginas continuam no arquivo.`;
            }
          }
        }
        onClose();
        const left = out.length
          ? ` ${out.length === 1 ? "1 documento de representação ficou" : `${out.length} documentos de representação ficaram`} de fora${cutPages ? ` (${cutPages === 1 ? "1 página cortada" : `${cutPages} páginas cortadas`} do PDF)` : ""}.`
          : "";
        ui.toast(`Processo integral guardado: ${res.added} documentos novos${res.updated ? `, ${res.updated} atualizados` : ""}.${left}${cutNote}`, cutNote ? { kind: "error" } : undefined);
        navigate(casePath(res.caseId, "documentos"));
        return;
      }
      if (precedentId) {
        const it = items[0];
        const meta = await saveFileOf(it);
        const [docId] = run(store, A.addDocs, { file: meta, precedentId, docs: [{ title: it.title, type: "jurisprudencia", date: it.date || undefined }] });
        run(store, A.setPrecedentDoc, precedentId, docId);
        onClose();
        ui.toast("Inteiro teor guardado e pesquisável.");
        return;
      }
      if (items.some((it) => !it.caseId)) {
        ui.toast("Escolha o processo de cada arquivo.", { kind: "error" });
        setStep("review");
        return;
      }
      let lastDoc = "";
      for (const it of items) {
        const meta = await saveFileOf(it);
        const ids = run(store, A.addDocs, { file: meta, caseId: it.caseId, docs: [{ title: it.title, type: it.type, date: it.date || undefined }], origin: it.file ? "arquivo" : "texto" });
        lastDoc = ids[0];
      }
      onClose();
      if (mode === "expediente") {
        ui.open({ type: "notice", caseId: items[items.length - 1].caseId, docId: lastDoc });
        return;
      }
      ui.toast(items.length === 1 ? "Documento guardado na base." : `${items.length} documentos guardados na base.`);
      if (!caseId) navigate(casePath(items[0].caseId, "documentos"));
    } catch (e) {
      console.error(e);
      ui.toast(`Não foi possível guardar: ${(e as Error).message || e}`, { kind: "error" });
      setStep("review");
    }
  };

  const setItem = (key: string, patch: Partial<ReadFile>) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const scanned = items.reduce((n, it) => n + it.text.empty.length, 0);
  const pagesTotal = items.reduce((n, it) => n + it.text.pages.length, 0);
  const canOcr = items.some((it) => it.file && it.text.kind === "pdf" && it.text.empty.length);
  const scanItem = items.find((it) => it.file && it.text.kind === "pdf" && it.text.empty.length);
  // páginas digitalizadas cujo carimbo ainda não foi lido: no processo integral, dá para separar os documentos por ele
  const pendingMargins = scanItem ? ocrTargets(scanItem, "margens").length : 0;
  const canSplit = mode === "processo" && scanItem === items[0] && pendingMargins > 2;
  const coverPending = !!scanItem && scanItem.text.empty.includes(1) && !scanItem.ocrPages?.includes(1);

  return (
    <Modal
      title={step === "review" && mode === "processo" ? "Conferir o processo" : "Enviar para a base de conhecimento"}
      onClose={close}
      wide
      footer={
        step === "review" ? (
          <>
            <button className="btn btn-ghost" onClick={() => setStep("choose")} disabled={!!ocr}>
              Voltar
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!!ocr}>
              {mode === "processo" ? (target ? "Atualizar o processo" : "Criar o processo") : mode === "expediente" ? "Guardar e registrar o prazo" : "Guardar"}
            </button>
          </>
        ) : step === "choose" ? (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            {mode !== "processo" && (
              <button className="btn btn-primary" disabled={!paste.trim()} onClick={() => read([], paste)}>
                Usar o texto colado
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {step === "choose" && (
        <>
          {precedentId ? (
            <p className="muted">Envie o PDF (ou o texto) do inteiro teor da decisão. Ele fica guardado na base e entra na pesquisa.</p>
          ) : (
          <div className="mode-cards" role="radiogroup" aria-label="O que você vai enviar">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={mode === m.id} className={`mode-card ${mode === m.id ? "selected" : ""}`} onClick={() => setMode(m.id)}>
                {m.icon}
                <strong>{m.title}</strong>
                <span>{m.text}</span>
              </button>
            ))}
          </div>
          )}
          {!caseId && !precedentId && mode !== "processo" && (
            <Field label="Processo" hint={`Se ficar em branco, o ${APP_NAME} procura o número do processo dentro do arquivo.`}>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Descobrir pelo número no arquivo</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {caseLabel(c)} · {c.number}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <DropZone
            onFiles={(files) => {
              if (mode === "processo" && files.length > 1) ui.toast("No processo integral, envie um PDF por vez. Vou usar o primeiro.");
              void read(mode === "processo" ? files.slice(0, 1) : files);
            }}
          >
            {mode === "processo" ? (
              <>
                <strong>Arraste o PDF do processo</strong> ou toque para escolher
              </>
            ) : (
              <>
                <strong>Arraste os arquivos</strong> (PDF, Word, texto, HTML) ou toque para escolher
              </>
            )}
          </DropZone>
          {mode !== "processo" && (
            <Field label="Ou cole o texto" hint={mode === "expediente" ? "Copie o teor da intimação no DJEN ou no sistema do tribunal e cole aqui." : undefined}>
              <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Cole aqui o texto do documento" />
            </Field>
          )}
          <p className="muted small">Os arquivos ficam guardados só neste aparelho. O texto é lido aqui mesmo, sem enviar nada para a internet.</p>
        </>
      )}

      {step === "reading" && (
        <div className="reading">
          <div className="spinner" />
          <div>
            Lendo <strong>{progress.file}</strong>
            {progress.total ? ` · página ${progress.done} de ${progress.total}` : "…"}
          </div>
          {progress.total > 0 && (
            <div className="progress">
              <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {step === "saving" && (
        <div className="reading">
          <div className="spinner" />
          <div>Guardando…</div>
        </div>
      )}

      {step === "review" && (
        <>
          {items.some((it) => it.duplicateOf) && (
            <div className="banner warn small">
              <TriangleAlert size={18} />
              <span>Este arquivo já foi enviado antes ({items.find((it) => it.duplicateOf)?.duplicateOf}). Se continuar, ele fica duplicado na base.</span>
            </div>
          )}
          {scanned > 0 &&
            (ocr ? (
              <div className="banner info small ocr-box" role="status">
                <ScanText size={18} />
                <div>
                  <strong>
                    {ocr.label}: página {ocr.done} de {ocr.total}
                  </strong>
                  {" · "}
                  {ocrLeft(ocr)}
                  <div className="progress">
                    <span style={{ width: `${(ocr.done / Math.max(1, ocr.total)) * 100}%` }} />
                  </div>
                  <p className="muted small">
                    Deixe esta janela aberta (dá para usar outros programas enquanto isso). No celular, a leitura é bem mais lenta.
                  </p>
                  <button className="btn btn-ghost btn-sm" onClick={() => ocrCtrl.current?.abort()}>
                    Interromper
                  </button>
                </div>
              </div>
            ) : (
              <div className={`banner small ${scanned === pagesTotal ? "danger" : "warn"}`}>
                <TriangleAlert size={18} />
                <div>
                  <p>
                    {scanned === pagesTotal
                      ? `Nenhuma ${pagesTotal === 1 ? "página" : `das ${pagesTotal} páginas`} tem texto: o PDF foi gerado como imagem (impressão para PDF, digitalização ou cópia da tela). Sem texto, o ${APP_NAME} não lê o número, as partes nem separa os documentos, e a pesquisa não alcança o arquivo.`
                      : `${scanned} de ${pagesTotal} páginas não têm texto (imagem digitalizada): a pesquisa não as alcança.`}{" "}
                    {canOcr
                      ? "Dá para ler o texto das imagens (OCR) aqui mesmo, no seu aparelho; a leitura pode ter erros, então confira o resultado."
                      : "Se puder, baixe o arquivo com texto no sistema do tribunal."}
                  </p>
                  {canSplit && (
                    <p>
                      Para separar os documentos depressa, o {APP_NAME} lê só o carimbo do tribunal no alto e no pé de cada página. Ler o texto
                      inteiro demora mais e serve para a pesquisa alcançar as páginas: dá para fazer em seguida, se quiser.
                    </p>
                  )}
                  {canOcr && (
                    <div className="banner-actions">
                      {canSplit && (
                        <button className="btn btn-primary btn-sm" onClick={() => runOcr("margens")}>
                          <Scissors size={15} /> Separar os documentos (cerca de {ocrMinutes(pendingMargins, undefined, "margins")} min)
                        </button>
                      )}
                      <button className={`btn btn-sm ${canSplit ? "btn-ghost" : "btn-primary"}`} onClick={() => runOcr("todas")}>
                        <ScanText size={15} /> Ler o texto {scanned === 1 ? "da página" : `das ${scanned} páginas`} (cerca de {ocrMinutes(scanned)} min)
                      </button>
                      {coverPending && scanned > 6 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => runOcr("capa")}>
                          Ler só a capa
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          {mode === "processo" && info ? (
            <div className="review">
              <dl className="infos">
                <div className="info-row">
                  <dt>Número</dt>
                  <dd className="mono">
                    {info.number || "não encontrado"}
                    {info.number && numberFromName && <span className="muted small"> (lido do nome do arquivo)</span>}
                    {info.number && info.numberGuessed && <span className="muted small"> (achado no texto do processo: confira)</span>}
                  </dd>
                </div>
                {info.system && (
                  <div className="info-row">
                    <dt>Sistema</dt>
                    <dd>{info.system}</dd>
                  </div>
                )}
                {info.className && (
                  <div className="info-row">
                    <dt>Classe</dt>
                    <dd>{info.className}</dd>
                  </div>
                )}
                {info.body && (
                  <div className="info-row">
                    <dt>Órgão julgador</dt>
                    <dd>{info.body}</dd>
                  </div>
                )}
              </dl>
              <Field label="Guardar em">
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Criar um processo novo com estes dados</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {caseLabel(c)} · {c.number}
                    </option>
                  ))}
                </select>
              </Field>
              {!target && !info.number && (
                <Field
                  label="Número do processo"
                  hint={
                    typedCheck ? (
                      typedCheck.valid ? (
                        `Número válido${typedCheck.court ? ` · ${typedCheck.court}` : ""}`
                      ) : (
                        <span className="field-error">{typedCheck.message}</span>
                      )
                    ) : typedNumber.trim() ? (
                      <span className="field-error">Use o padrão CNJ: 0000000-00.0000.0.00.0000</span>
                    ) : (
                      "Não achei o número no arquivo: digite-o aqui (ele está na capa ou no sistema do tribunal)."
                    )
                  }
                >
                  <input
                    value={typedNumber}
                    onChange={(e) => {
                      setTypedNumber(e.target.value);
                      // o número digitado já é de um processo cadastrado: guarda nele
                      const c = checkCaseNumber(e.target.value);
                      const existing = c ? A.findCaseByNumber(ds, c.formatted) : undefined;
                      if (existing) setTarget(existing.id);
                    }}
                    placeholder="0000000-00.0000.0.00.0000"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={!!ocr}
                  />
                </Field>
              )}
              {!target && info.parties.length > 0 && (
                <fieldset className="client-pick">
                  <legend>Partes encontradas: quem é o seu cliente?</legend>
                  {info.parties.map((p, i) => (
                    <label key={i} className="check">
                      <input type="radio" name="client" checked={clientIdx === i} onChange={() => setClientIdx(i)} />
                      {p.name}{" "}
                      <span className="muted">
                        ({p.role} · {POLES[p.pole].toLowerCase()}){p.kind === "publico" && " · ente público, prazo em dobro"}
                        {p.lawyers.length > 0 && ` · ${p.lawyers.length === 1 ? "procurador" : "procuradores"}: ${p.lawyers.join(", ")}`}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <h3 className="form-section">
                {info.docs.length} {info.docs.length === 1 ? "documento" : "documentos"} em {items[0]?.text.pages.length} páginas
              </h3>
              {info.docs.length > 1 && (
                <div className="cut-box">
                  <div className="cut-title">
                    <Scissors size={16} /> Documentos de representação
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={cutRep} onChange={(e) => toggleKind("representacao", e.target.checked)} /> Deixar de fora substabelecimentos,
                    cartas de preposição e atos constitutivos (contrato social, estatuto, atas, cartão do CNPJ)
                    <span className="muted"> ({repCount === 1 ? "1 encontrado" : `${repCount} encontrados`})</span>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={cutProc} onChange={(e) => toggleKind("procuracao", e.target.checked)} /> Deixar de fora também as procurações
                    <span className="muted"> ({procCount === 1 ? "1 encontrada" : `${procCount} encontradas`}; a do cliente pode servir para instruir petições)</span>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={cutFromPdf} onChange={(e) => setCutFromPdf(e.target.checked)} /> Cortar do PDF guardado as páginas que ficarem de
                    fora (o arquivo fica menor; o original continua no sistema do tribunal)
                  </label>
                  <p className="muted small">
                    {outCount ? `${outCount === 1 ? "1 documento fica" : `${outCount} documentos ficam`} de fora.` : "Nenhum documento fica de fora."} Desmarque na lista
                    abaixo qualquer documento que não quiser guardar, ou marque os que quiser manter.
                  </p>
                </div>
              )}
              {!!info.events?.length && (
                <p className="muted small">
                  {info.events.length === 1 ? "1 movimentação (evento) entra" : `${info.events.length} movimentações (eventos) entram`} nos andamentos do
                  processo.
                </p>
              )}
              <div className="doc-preview">
                {info.docs.map((d, i) => (
                  <label key={i} className={`doc-preview-row ${isOut(i) ? "out" : ""}`}>
                    <input type="checkbox" checked={!isOut(i)} onChange={(e) => setKeep((k) => ({ ...k, [i]: e.target.checked }))} aria-label={`Guardar ${d.title}`} />
                    <span className="chip tone-muted">{DOC_TYPES[d.type]}</span>
                    <span>
                      {d.title}
                      {isOut(i) && <span className="chip tone-warn">fica de fora</span>}
                    </span>
                    <span className="muted small">
                      {[courtRef(d.courtId), d.date && formatDate(d.date), `p. ${d.pages[0]}${d.pages[1] > d.pages[0] ? `–${d.pages[1]}` : ""}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="review">
              {items.map((it) => (
                <div key={it.key} className="review-item">
                  <div className="review-file">
                    <strong>{it.name}</strong>{" "}
                    <span className="muted small">
                      {fileSize(it.size)} · {it.text.pages.length} {it.text.pages.length === 1 ? "página" : "páginas"}
                    </span>
                  </div>
                  <div className="form-grid">
                    <Field label="Nome" className="span-2">
                      <input value={it.title} onChange={(e) => setItem(it.key, { title: e.target.value })} />
                    </Field>
                    <Field label="Tipo">
                      <select value={it.type} onChange={(e) => setItem(it.key, { type: e.target.value as DocType })}>
                        {(Object.keys(DOC_TYPES) as DocType[])
                          .filter((t) => t !== "processo" && t !== "jurisprudencia")
                          .map((t) => (
                            <option key={t} value={t}>
                              {DOC_TYPES[t]}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Data">
                      <input type="date" value={it.date} onChange={(e) => setItem(it.key, { date: e.target.value })} />
                    </Field>
                    {!caseId && !precedentId && (
                      <Field label="Processo" className="span-2">
                        <select value={it.caseId} onChange={(e) => setItem(it.key, { caseId: e.target.value })}>
                          <option value="">Escolha o processo</option>
                          {cases.map((c) => (
                            <option key={c.id} value={c.id}>
                              {caseLabel(c)} · {c.number}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
