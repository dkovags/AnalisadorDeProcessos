import { CalendarClock, FileStack, Files, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_NAME } from "../../config";
import { analyze, classifyText } from "../../domain/analysis";
import { courtRef, parseCaseFile, type CaseFileInfo } from "../../domain/casefile";
import { formatDate } from "../../domain/dates";
import { findDates } from "../../domain/text";
import { DOC_TYPES, POLES } from "../../domain/labels";
import { caseLabel } from "../../domain/select";
import type { DocType, FileMeta } from "../../domain/types";
import * as A from "../../store/actions";
import { paginate, type Extracted } from "../../store/extract";
import { newId } from "../../store/ids";
import { persistStorage, readFileText, sha256 } from "../../store/ingest";
import { run } from "../../store/store";
import { Field, fileSize, Modal } from "../components/basics";
import { DropZone } from "../components/DropZone";
import { useData, useStore, useToday, useUI } from "../context";
import { casePath, navigate } from "../router";

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
}

const MODES: { id: Mode; title: string; text: string; icon: ReactNode }[] = [
  { id: "processo", title: "Processo integral", text: "O PDF do processo inteiro, baixado do PJe, do eproc ou do e-SAJ. Lê a capa e as partes e separa cada documento.", icon: <FileStack size={22} /> },
  { id: "documento", title: "Documentos", text: "Petições, decisões, provas, contratos (PDF, Word, texto). Cada arquivo vira um documento da base.", icon: <Files size={22} /> },
  { id: "expediente", title: "Expediente", text: "Intimação, citação ou publicação do DJEN. Guarda o texto e abre o registro do prazo.", icon: <CalendarClock size={22} /> },
];

/** Data do documento: a da assinatura eletrônica ou a última data do texto (sem datas futuras). */
function guessDate(pages: string[], today: string): string {
  const all = pages.join("\n");
  const signed = all.match(/Assinado eletronicamente por:.*?(\d{2}\/\d{2}\/\d{4})/);
  if (signed) return findDates(signed[1])[0]?.iso || "";
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
  const [clientIdx, setClientIdx] = useState(0);
  const started = useRef(false);
  const cases = Object.values(ds.cases).sort((a, b) => caseLabel(a).localeCompare(caseLabel(b), "pt-BR"));

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
        const all = extracted.pages.join("\n");
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
      ui.toast(`Não foi possível ler o arquivo: ${(e as Error).message || e}`, { kind: "error" });
      setStep("choose");
      return;
    }
    setItems(out);
    if (mode === "processo" && out[0]) {
      const parsed = parseCaseFile(out[0].text.pages, { outline: out[0].text.outline, layout: out[0].text.layout });
      setInfo(parsed);
      const existing = caseId || (parsed.number ? A.findCaseByNumber(ds, parsed.number)?.id : undefined) || "";
      setTarget(existing);
      setClientIdx(0);
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

  const saveFileOf = async (it: ReadFile): Promise<FileMeta> => {
    const meta: FileMeta = {
      id: newId("f"),
      name: it.name,
      mime: it.mime,
      size: it.size,
      pageCount: it.text.pages.length,
      emptyPages: it.text.empty.length ? it.text.empty : undefined,
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
        const meta = await saveFileOf(items[0]);
        const res = run(store, A.importCaseFile, {
          file: meta,
          info,
          caseId: target || undefined,
          create: target
            ? undefined
            : {
                number: info.number || "",
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
        onClose();
        ui.toast(`Processo integral guardado: ${res.added} documentos novos${res.updated ? `, ${res.updated} atualizados` : ""}.`);
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

  return (
    <Modal
      title={step === "review" && mode === "processo" ? "Conferir o processo" : "Enviar para a base de conhecimento"}
      onClose={onClose}
      wide
      footer={
        step === "review" ? (
          <>
            <button className="btn btn-ghost" onClick={() => setStep("choose")}>
              Voltar
            </button>
            <button className="btn btn-primary" onClick={save}>
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
          {scanned > 0 && (
            <div className="banner warn small">
              <TriangleAlert size={18} />
              <span>
                {scanned === pagesTotal ? "O arquivo não tem texto" : `${scanned} de ${pagesTotal} páginas não têm texto`} (imagem digitalizada): elas ficam guardadas, mas a
                pesquisa não as alcança. Se puder, baixe a versão com texto (OCR) no sistema do tribunal.
              </span>
            </div>
          )}
          {mode === "processo" && info ? (
            <div className="review">
              <dl className="infos">
                <div className="info-row">
                  <dt>Número</dt>
                  <dd className="mono">{info.number || "não encontrado"}</dd>
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
              {!target && !info.number && <p className="field-error">Não achei o número do processo no arquivo. Cadastre o processo antes e escolha-o acima.</p>}
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
              {!!info.events?.length && (
                <p className="muted small">
                  {info.events.length === 1 ? "1 movimentação (evento) entra" : `${info.events.length} movimentações (eventos) entram`} nos andamentos do
                  processo.
                </p>
              )}
              <div className="doc-preview">
                {info.docs.slice(0, 60).map((d, i) => (
                  <div key={i} className="doc-preview-row">
                    <span className="chip tone-muted">{DOC_TYPES[d.type]}</span>
                    <span>{d.title}</span>
                    <span className="muted small">
                      {[courtRef(d.courtId), d.date && formatDate(d.date), `p. ${d.pages[0]}${d.pages[1] > d.pages[0] ? `–${d.pages[1]}` : ""}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                ))}
                {info.docs.length > 60 && <div className="muted small">e mais {info.docs.length - 60}…</div>}
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
