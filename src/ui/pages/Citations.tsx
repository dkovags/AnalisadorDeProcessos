import { CircleAlert, CircleCheck, CircleX, ExternalLink, FileUp, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { APP_NAME } from "../../config";
import { checkCitations, LEVEL_LABEL, type CheckedRef, type Level } from "../../domain/citations";
import { formatDate } from "../../domain/dates";
import { DOC_TYPES } from "../../domain/labels";
import { caseLabel } from "../../domain/select";
import { CopyButton, Empty, Field } from "../components/basics";
import { PageHeader } from "../components/Shell";
import { useData, useStore, useToday, useUI } from "../context";
import { takeHandOff } from "../handoff";
import { readFileText } from "../../store/ingest";
import { ACCEPT } from "../components/DropZone";

const ICON: Record<Level, ReactNode> = {
  ok: <CircleCheck size={18} />,
  alerta: <TriangleAlert size={18} />,
  erro: <CircleX size={18} />,
  desconhecida: <CircleAlert size={18} />,
};

function Result({ r }: { r: CheckedRef }) {
  const ui = useUI();
  const ref = r.ref;
  const label = ref.kind === "sumula" ? `${ref.className} ${ref.number}${ref.court ? ` do ${ref.court}` : ""}` : ref.kind === "tema" ? `Tema ${ref.number}${ref.court ? ` do ${ref.court}` : ""}` : `${ref.court ? ref.court + " · " : ""}${ref.className || "Decisão"} ${ref.number || ""}${ref.uf ? `/${ref.uf}` : ""}`;
  return (
    <article className={`check-card level-${r.level}`}>
      <header className="check-head">
        <span className="check-icon">{ICON[r.level]}</span>
        <strong>{label}</strong>
        <span className={`chip level-${r.level}`}>{LEVEL_LABEL[r.level]}</span>
        {ref.courtInferred && <span className="chip tone-muted" title="O tribunal não estava escrito na citação">tribunal deduzido</span>}
      </header>
      {ref.raw && ref.kind === "acordao" && <blockquote className="check-raw">{ref.raw}</blockquote>}
      {ref.kind === "acordao" && (
        <div className="check-fields">
          {ref.rapporteur && (
            <span>
              {ref.female ? "Relatora" : "Relator"}: {ref.rapporteurTitle ? `${ref.rapporteurTitle} ` : ""}
              {ref.rapporteur}
            </span>
          )}
          {ref.body && <span>{ref.body}</span>}
          {ref.judgedAt && <span>julgado em {formatDate(ref.judgedAt)}</span>}
          {ref.publishedAt && (
            <span>
              {ref.source || "publicado"} {formatDate(ref.publishedAt)}
            </span>
          )}
        </div>
      )}
      {r.issues.length > 0 && (
        <ul className="issues">
          {r.issues.map((i, k) => (
            <li key={k} className={`note-${i.level}`}>
              {i.text}
            </li>
          ))}
        </ul>
      )}
      {r.quote && (
        <div className="quote-check">
          <div className="muted small">
            Trecho entre aspas:{" "}
            {r.quote.status === "fiel"
              ? "idêntico à ementa cadastrada."
              : r.quote.status === "fiel_supressoes"
                ? "fiel à ementa, com supressões indicadas por [...]."
                : `${Math.round(r.quote.similarity * 100)}% das palavras conferem com a ementa.`}
          </div>
          {(r.quote.status === "divergente" || r.quote.status === "nao_corresponde") && (
            <p className="diff">
              {r.quote.diff.map((p, k) => (
                <span key={k} className={`diff-${p.t}`} title={p.t === "add" ? "No texto, mas não na ementa" : p.t === "del" ? "Na ementa, mas não no texto" : undefined}>
                  {p.text}{" "}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      {r.match && r.suggestion && (
        <div className="suggest">
          <div className="muted small">Citação adequada (da base):</div>
          <div className="suggest-row">
            <span>{r.suggestion}</span>
            <CopyButton text={r.suggestion} />
          </div>
        </div>
      )}
      <footer className="item-actions">
        {r.match ? (
          <a className="btn btn-ghost btn-sm" href={`#/jurisprudencia/${r.match.id}`}>
            Abrir na base
          </a>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => ui.open({ type: "precedent", text: ref.raw })}>
            <Plus size={14} /> Cadastrar na base
          </button>
        )}
        {r.search.map((s) => (
          <a key={s.url} className="btn btn-ghost btn-sm" href={s.url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> {s.label}
          </a>
        ))}
      </footer>
    </article>
  );
}

export function CitationsPage() {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const today = useToday();
  const [text, setText] = useState(() => takeHandOff());
  const [results, setResults] = useState<CheckedRef[] | null>(() => (text ? checkCitations(text, Object.values(ds.precedents), { today, style: ds.prefs.citationStyle }) : null));
  const [docId, setDocId] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const docs = Object.values(ds.docs)
    .filter((d) => ["inicial", "contestacao", "replica", "peticao", "recurso", "contrarrazoes", "sentenca", "acordao", "decisao", "parecer", "outro"].includes(d.type))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const verify = (t = text) => setResults(checkCitations(t, Object.values(ds.precedents), { today, style: ds.prefs.citationStyle }));

  const loadDoc = async (id: string) => {
    setDocId(id);
    const d = ds.docs[id];
    if (!d) return;
    const pages = await store.pages(d.fileId);
    const [a, b] = d.pages || [1, pages.length];
    const t = pages.slice(a - 1, b).join("\n");
    setText(t);
    verify(t);
  };

  const counts = (results || []).reduce<Record<Level, number>>((acc, r) => ({ ...acc, [r.level]: acc[r.level] + 1 }), { ok: 0, alerta: 0, erro: 0, desconhecida: 0 });

  return (
    <div className="page">
      <PageHeader
        title="Verificar citações"
        icon={<ShieldCheck size={26} className="page-icon" />}
        subtitle="Confere as citações de jurisprudência de uma petição ou decisão: coerência dos dados, número CNJ, existência na sua base e fidelidade do trecho citado à ementa."
      />
      <div className="card pad stack">
        <div className="toolbar">
          {docs.length > 0 && (
            <select value={docId} onChange={(e) => e.target.value && loadDoc(e.target.value)} aria-label="Documento da base">
              <option value="">Escolher um documento da base…</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {DOC_TYPES[d.type]}: {d.title}
                  {d.caseId && ds.cases[d.caseId] ? ` (${caseLabel(ds.cases[d.caseId])})` : ""}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-ghost" onClick={() => file.current?.click()}>
            <FileUp size={16} /> Abrir arquivo (PDF ou Word)
          </button>
          <input
            ref={file}
            type="file"
            hidden
            accept={ACCEPT}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const out = await readFileText(f);
                const t = out.pages.join("\n");
                setText(t);
                verify(t);
              } catch (err) {
                ui.toast(`Não foi possível ler o arquivo: ${(err as Error).message}`, { kind: "error" });
              }
            }}
          />
        </div>
        <Field label="Texto">
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Cole aqui a petição, a decisão ou só os trechos com as citações." />
        </Field>
        <div>
          <button className="btn btn-primary" disabled={!text.trim()} onClick={() => verify()}>
            <ShieldCheck size={17} /> Verificar
          </button>
        </div>
        <p className="muted small">
          A verificação é feita aqui mesmo, com as regras do {APP_NAME} e a sua base. Citação "fora da base" não quer dizer que esteja errada: confira no site do tribunal e,
          se estiver certa, cadastre. Nada é enviado para a internet.
        </p>
      </div>
      {results &&
        (results.length ? (
          <>
            <div className="stats compact">
              <span className="stat tone-ok">
                <span className="stat-n">{counts.ok}</span>
                <span className="stat-l">conferidas</span>
              </span>
              <span className={`stat ${counts.alerta ? "tone-warn" : ""}`}>
                <span className="stat-n">{counts.alerta}</span>
                <span className="stat-l">para conferir</span>
              </span>
              <span className={`stat ${counts.erro ? "tone-danger" : ""}`}>
                <span className="stat-n">{counts.erro}</span>
                <span className="stat-l">com problema</span>
              </span>
              <span className="stat">
                <span className="stat-n">{counts.desconhecida}</span>
                <span className="stat-l">fora da base</span>
              </span>
            </div>
            <div className="cards">
              {results.map((r, i) => (
                <Result key={i} r={r} />
              ))}
            </div>
          </>
        ) : (
          <Empty icon={<ShieldCheck size={30} />} title="Nenhuma citação de jurisprudência encontrada">
            O {APP_NAME} reconhece acórdãos dos tribunais superiores (REsp, AREsp, RE, ARE, HC...), números CNJ de segundo grau, súmulas e temas.
          </Empty>
        ))}
    </div>
  );
}
