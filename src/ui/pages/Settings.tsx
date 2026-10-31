import { CalendarX, CircleCheck, DatabaseBackup, Download, Globe, HardDrive, Moon, Plus, RefreshCw, Trash, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { APP_NAME, SERVER_GUIDE_URL } from "../../config";
import { makeCalendar, yearHolidays } from "../../domain/calendar";
import { addDays, formatDate, formatDateWeek, parts } from "../../domain/dates";
import { UFS } from "../../domain/cnj";
import type { CitationStyle, CnjPrefs, Holiday, Prefs } from "../../domain/types";
import * as A from "../../store/actions";
import { makeBackup, readBackup } from "../../store/backup";
import { CnjError, cnjPing, cnjReady, oabNumber } from "../../store/cnjapi";
import { emptyDataset } from "../../store/dataset";
import { persistStorage, storageInfo } from "../../store/ingest";
import { djenSummary, FIRST_DAYS, OVERLAP_DAYS, plural, syncDjen } from "../cnjsync";
import { Field, fileSize } from "../components/basics";
import { STYLE_LABEL } from "../components/PrecedentCard";
import { PageHeader } from "../components/Shell";
import { useData, useRun, useStore, useToday, useUI } from "../context";
import { downloadFile } from "../download";
import { notifySupported, requestNotify } from "../notify";

const FORENSIC: { key: keyof Prefs["forensic"]; label: string; hint?: string }[] = [
  { key: "carnaval", label: "Segunda e terça de Carnaval" },
  { key: "cinzas", label: "Quarta-feira de Cinzas com expediente reduzido", hint: "não pode ser o primeiro nem o último dia (CPC, art. 224, § 1º)" },
  { key: "quintaSanta", label: "Quinta-feira Santa" },
  { key: "paixao", label: "Sexta-feira da Paixão" },
  { key: "corpus", label: "Corpus Christi" },
  { key: "federal", label: "Feriados da Justiça Federal", hint: "Lei 5.010/1966, art. 62: Semana Santa, 11/08, 01/11 e 08/12" },
];

function HolidayForm() {
  const runAction = useRun();
  const ui = useUI();
  const [h, setH] = useState({ date: "", end: "", yearly: false, label: "", kind: "feriado" as Holiday["kind"], courts: "" });
  const add = () => {
    if (
      runAction(A.addHoliday, {
        date: h.date,
        end: h.end || undefined,
        yearly: h.yearly,
        label: h.label,
        kind: h.kind,
        courts: h.courts.split(",").map((c) => c.trim()).filter(Boolean),
      })
    ) {
      setH({ ...h, date: "", end: "", label: "" });
      ui.toast("Incluído no calendário.");
    }
  };
  return (
    <div className="form-grid holiday-form">
      <Field label="Data">
        <input type="date" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} />
      </Field>
      <Field label="Até (para períodos)">
        <input type="date" value={h.end} onChange={(e) => setH({ ...h, end: e.target.value })} />
      </Field>
      <Field label="Tipo">
        <select value={h.kind} onChange={(e) => setH({ ...h, kind: e.target.value as Holiday["kind"] })}>
          <option value="feriado">Feriado (sem expediente)</option>
          <option value="suspensao">Suspensão de prazos</option>
          <option value="parcial">Expediente reduzido</option>
        </select>
      </Field>
      <Field label="Tribunais" hint="Em branco: todos.">
        <input value={h.courts} onChange={(e) => setH({ ...h, courts: e.target.value.toUpperCase() })} placeholder="TJRN, TRT21" />
      </Field>
      <Field label="Motivo" className="span-3">
        <input value={h.label} onChange={(e) => setH({ ...h, label: e.target.value })} placeholder="Ex.: feriado municipal de Natal; Portaria 123/2026 (indisponibilidade do PJe)" />
      </Field>
      <label className="check">
        <input type="checkbox" checked={h.yearly} onChange={(e) => setH({ ...h, yearly: e.target.checked })} /> Repete todo ano
      </label>
      <button className="btn btn-primary" onClick={add}>
        <Plus size={16} /> Incluir
      </button>
    </div>
  );
}

/** "RJ 123.456", "123456/RJ", "OAB/RJ 123.456" → número e UF, para preencher a busca no DJEN. */
function parseOab(s: string | undefined): { number?: string; uf?: string } {
  if (!s) return {};
  const uf = UFS.find((u) => new RegExp(`(^|[^A-Z])${u}([^A-Z]|$)`).test(s.toUpperCase()));
  return { number: oabNumber(s.match(/\d[\d.]*/)?.[0]) || undefined, uf };
}

/** Busca automática das intimações no DJEN e dos andamentos no DataJud, pelo intermediário no Brasil. */
function CnjSettings() {
  const ds = useData();
  const store = useStore();
  const runAction = useRun();
  const today = useToday();
  const cnj = ds.prefs.cnj || {};
  const guess = parseOab(ds.prefs.oab);
  const oab = cnj.oab || guess.number || "";
  const uf = cnj.uf || guess.uf || "";
  const [busy, setBusy] = useState<"" | "test" | "sync">("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (patch: Partial<CnjPrefs>) => runAction(A.savePrefs, { cnj: { ...store.getSnapshot()?.prefs.cnj, ...patch } });
  // a OAB de "Quem usa" vale até a pessoa escrever outra aqui: grava a que está na tela antes de buscar
  const keepOab = () => {
    const now = store.getSnapshot()?.prefs;
    const g = parseOab(now?.oab);
    if ((!now?.cnj?.oab && g.number) || (!now?.cnj?.uf && g.uf)) save({ oab: now?.cnj?.oab || g.number, uf: now?.cnj?.uf || g.uf });
  };

  const test = async () => {
    keepOab();
    const c = store.getSnapshot()?.prefs.cnj;
    if (!cnjReady(c)) return setResult({ ok: false, text: "Preencha o endereço e a senha do intermediário." });
    setBusy("test");
    setResult(null);
    try {
      await cnjPing(c, today);
      setResult({ ok: true, text: "Conexão funcionando: o intermediário aceitou a senha e o DJEN respondeu." });
    } catch (e) {
      setResult({ ok: false, text: e instanceof CnjError ? e.message : "O teste não deu certo. Tente de novo." });
    } finally {
      setBusy("");
    }
  };

  const sync = async () => {
    keepOab();
    setBusy("sync");
    setResult(null);
    try {
      const r = await syncDjen(store, today);
      const skipped = r.skipped ? `; ${plural(r.skipped, "já estava no app ou foi descartada", "já estavam no app ou foram descartadas")}` : "";
      setResult({
        ok: true,
        text: `Busca de ${formatDate(r.from)} a ${formatDate(r.to)}: ${plural(r.found, "comunicação encontrada", "comunicações encontradas")}; ${djenSummary(r)}${skipped}.`,
      });
    } catch (e) {
      setResult({ ok: false, text: e instanceof CnjError ? e.message : "A busca não deu certo. Tente de novo." });
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="card pad stack">
      <h2>
        <Globe size={18} /> Busca automática no DJEN e no DataJud
      </h2>
      <p className="muted small">
        O {APP_NAME} busca as intimações publicadas para a sua OAB no Diário de Justiça Eletrônico Nacional e registra cada uma como expediente, com o ato e o
        prazo lidos do texto, para você conferir. Na aba Andamentos de cada processo, traz as movimentações do DataJud. Como o DJEN só atende consultas feitas do
        Brasil, a busca passa pelo intermediário (a sua função na AWS, em São Paulo). Saem do aparelho só a OAB, as datas e os números dos processos.{" "}
        <a href={SERVER_GUIDE_URL} target="_blank" rel="noreferrer">
          Como criar o intermediário
        </a>
        .
      </p>
      <div className="form-grid">
        <Field label="Endereço do intermediário" className="span-2">
          <input
            type="url"
            inputMode="url"
            defaultValue={cnj.url || ""}
            placeholder="https://….lambda-url.sa-east-1.on.aws/"
            autoComplete="off"
            spellCheck={false}
            onBlur={(e) => e.target.value.trim() !== (cnj.url || "") && save({ url: e.target.value.trim() || undefined })}
          />
        </Field>
        <Field label="Senha do intermediário" className="span-2">
          <input
            type="password"
            defaultValue={cnj.key || ""}
            autoComplete="new-password"
            onBlur={(e) => e.target.value.trim() !== (cnj.key || "") && save({ key: e.target.value.trim() || undefined })}
          />
        </Field>
        <Field label="OAB (número)">
          <input
            inputMode="numeric"
            defaultValue={oab}
            placeholder="123456"
            onBlur={(e) => oabNumber(e.target.value) !== (cnj.oab || "") && save({ oab: oabNumber(e.target.value) || undefined })}
          />
        </Field>
        <Field label="UF da OAB">
          <select value={uf} onChange={(e) => save({ uf: e.target.value || undefined })}>
            <option value="">Escolha</option>
            {UFS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={!!cnj.auto}
          onChange={(e) => {
            keepOab();
            save({ auto: e.target.checked });
          }}
        />{" "}
        Buscar as intimações novas ao abrir o {APP_NAME} (uma vez por dia)
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={!!busy} onClick={sync}>
          <RefreshCw size={16} /> {busy === "sync" ? "Buscando…" : "Buscar intimações agora"}
        </button>
        <button className="btn btn-ghost" disabled={!!busy} onClick={test}>
          {busy === "test" ? "Testando…" : "Testar a conexão"}
        </button>
      </div>
      {result && (
        <div className={`banner small ${result.ok ? "info" : "danger"}`} role="status">
          {result.ok ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
          <span>{result.text}</span>
        </div>
      )}
      {cnj.lastRun && (
        <p className="muted small">
          Última busca: {formatDate(cnj.lastRun)} ({plural(cnj.lastCount ?? 0, "intimação nova", "intimações novas")}). A primeira busca alcança os últimos{" "}
          {FIRST_DAYS} dias; as seguintes recomeçam {OVERLAP_DAYS} dias antes da anterior, sem repetir o que já foi registrado.
        </p>
      )}
    </section>
  );
}

export function SettingsPage() {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const runAction = useRun();
  const today = useToday();
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [busy, setBusy] = useState("");
  const restoreInput = useRef<HTMLInputElement>(null);
  const p = ds.prefs;
  const setPrefs = (patch: Partial<Prefs>) => runAction(A.savePrefs, patch);

  useEffect(() => {
    storageInfo().then(setStorage);
  }, [ds]);

  const cal = makeCalendar({ holidays: p.holidays, forensic: p.forensic });
  const upcoming: { date: string; text: string }[] = [];
  for (let d = today, i = 0; i < 120; i++, d = addDays(d, 1)) {
    const info = cal.info(d);
    const reasons = info.reasons.filter((r) => r !== "sábado" && r !== "domingo");
    if (reasons.length && !(upcoming.length && upcoming[upcoming.length - 1].text === reasons.join(", ") && /Recesso|suspensos/.test(reasons.join()))) upcoming.push({ date: d, text: reasons.join(", ") });
  }
  const nationalCount = yearHolidays(parts(today).y, p.forensic).length;

  const backup = async () => {
    setBusy("backup");
    try {
      await store.flush();
      const zip = await makeBackup({ ds, blob: (id) => store.blob(id), pages: (id) => store.pages(id) }, __APP_VERSION__);
      downloadFile(`analisador-de-processos-copia-${today}.zip`, zip, "application/zip");
      ui.toast("Cópia de segurança baixada. Guarde-a num lugar seguro (pendrive, nuvem pessoal).");
    } catch (e) {
      ui.toast(`Não foi possível gerar a cópia: ${(e as Error).message}`, { kind: "error" });
    } finally {
      setBusy("");
    }
  };

  const restore = async (file: File) => {
    try {
      const restored = readBackup(new Uint8Array(await file.arrayBuffer()));
      ui.open({
        type: "confirm",
        title: "Restaurar a cópia?",
        message: `Os dados atuais deste aparelho serão substituídos pelos da cópia (${Object.keys(restored.ds.cases).length} processos, ${Object.keys(restored.ds.docs).length} documentos, ${Object.keys(restored.ds.precedents).length} decisões).`,
        confirmLabel: "Restaurar",
        danger: true,
        onConfirm: async () => {
          setBusy("restore");
          await store.replace(restored.ds, restored.files);
          setBusy("");
          ui.toast("Cópia restaurada.");
        },
      });
    } catch (e) {
      ui.toast((e as Error).message, { kind: "error" });
    }
  };

  return (
    <div className="page">
      <PageHeader title="Configurações" />
      <div className="settings">
        <section className="card pad stack">
          <h2>Quem usa</h2>
          <div className="form-grid">
            <Field label="Nome">
              <input defaultValue={p.name || ""} onBlur={(e) => setPrefs({ name: e.target.value.trim() || undefined })} placeholder="Seu nome" />
            </Field>
            <Field label="OAB">
              <input defaultValue={p.oab || ""} onBlur={(e) => setPrefs({ oab: e.target.value.trim() || undefined })} placeholder="RN 1234" />
            </Field>
          </div>
        </section>

        <section className="card pad stack">
          <h2>Prazos</h2>
          <Field label="Antecedência do prazo interno" hint="Dias úteis antes do prazo fatal, para protocolar com folga.">
            <input type="number" min={0} max={30} value={p.marginDays} onChange={(e) => setPrefs({ marginDays: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} />
          </Field>
          <div>
            <div className="field-label">Feriados forenses considerados</div>
            <p className="muted small">
              Os {nationalCount} feriados nacionais e o recesso (20/12 a 20/01: CPC, art. 220; CLT, art. 775-A; CPP, art. 798-A) já entram no cálculo. Marque os forenses
              do seu tribunal e cadastre os locais abaixo. Na dúvida, deixe desmarcado: o prazo calculado fica mais curto, nunca mais longo.
            </p>
            {FORENSIC.map((f) => (
              <label key={f.key} className="check">
                <input type="checkbox" checked={p.forensic[f.key]} onChange={(e) => setPrefs({ forensic: { ...p.forensic, [f.key]: e.target.checked } })} /> {f.label}
                {f.hint && <span className="muted small"> ({f.hint})</span>}
              </label>
            ))}
          </div>
          <div>
            <div className="field-label">Feriados locais e suspensões de prazo</div>
            {p.holidays.length ? (
              <div className="holiday-list">
                {p.holidays.map((h) => (
                  <div key={h.id} className="holiday-row">
                    <span>
                      {h.yearly ? formatDate(h.date).slice(0, 5) : formatDate(h.date)}
                      {h.end ? ` a ${h.yearly ? formatDate(h.end).slice(0, 5) : formatDate(h.end)}` : ""}
                    </span>
                    <span>{h.label}</span>
                    <span className="muted small">
                      {h.kind === "feriado" ? "feriado" : h.kind === "suspensao" ? "suspensão" : "expediente reduzido"}
                      {h.yearly ? " · todo ano" : ""}
                      {h.courts?.length ? ` · ${h.courts.join(", ")}` : ""}
                    </span>
                    <button className="icon-btn small" aria-label="Tirar" onClick={() => runAction(A.removeHoliday, h.id)}>
                      <Trash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">Nenhum cadastrado.</p>
            )}
            <HolidayForm />
          </div>
          {upcoming.length > 0 && (
            <details>
              <summary>
                <CalendarX size={15} /> Próximos dias sem contagem (120 dias)
              </summary>
              <ul className="upcoming">
                {upcoming.slice(0, 20).map((u) => (
                  <li key={u.date}>
                    <strong>{formatDateWeek(u.date)}</strong> {u.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card pad stack">
          <h2>Citações de jurisprudência</h2>
          <Field label="Estilo da referência">
            <select value={p.citationStyle} onChange={(e) => setPrefs({ citationStyle: e.target.value as CitationStyle })}>
              {(Object.keys(STYLE_LABEL) as CitationStyle[]).map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={p.quoteSummary} onChange={(e) => setPrefs({ quoteSummary: e.target.checked })} /> Ao copiar, levar a ementa como citação direta, na
            linha de baixo da referência
          </label>
        </section>

        <section className="card pad stack">
          <h2>Avisos e aparência</h2>
          {notifySupported() && (
            <label className="check">
              <input
                type="checkbox"
                checked={!!p.notify}
                onChange={async (e) => {
                  if (!e.target.checked) return setPrefs({ notify: false });
                  if (await requestNotify()) setPrefs({ notify: true });
                  else ui.toast("O navegador não permitiu os avisos.", { kind: "error" });
                }}
              />{" "}
              Avisar dos prazos vencidos, de hoje e de amanhã quando o {APP_NAME} for aberto
            </label>
          )}
          <Field label={<><Moon size={14} /> Tema</>}>
            <select value={p.theme || "auto"} onChange={(e) => setPrefs({ theme: e.target.value as Prefs["theme"] })}>
              <option value="auto">Automático (como o aparelho)</option>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
            </select>
          </Field>
        </section>

        <CnjSettings />

        <section className="card pad stack">
          <h2>
            <HardDrive size={18} /> Dados
          </h2>
          <p className="muted small">
            Tudo fica guardado só neste navegador, neste aparelho (só as consultas da busca no DJEN e no DataJud, se ligada, vão para a internet). Faça cópias de
            segurança com frequência: se os dados do navegador forem apagados, só a cópia recupera os processos e os arquivos.
          </p>
          <div className="muted small">
            {Object.keys(ds.cases).length} processos · {Object.keys(ds.docs).length} documentos · {Object.keys(ds.files).length} arquivos ·{" "}
            {Object.keys(ds.precedents).length} decisões
            {storage.usage !== undefined && ` · ${fileSize(storage.usage)} usados`}
            {storage.quota ? ` de ${fileSize(storage.quota)} disponíveis` : ""}
          </div>
          {storage.persisted === false && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                const ok = await persistStorage();
                setStorage(await storageInfo());
                ui.toast(ok ? "O navegador vai preservar os dados." : "O navegador não confirmou (instalar o app costuma ajudar).", { kind: ok ? "ok" : "error" });
              }}
            >
              Pedir ao navegador para não apagar os dados
            </button>
          )}
          <div className="row">
            <button className="btn btn-primary" onClick={backup} disabled={!!busy}>
              <Download size={16} /> {busy === "backup" ? "Preparando…" : "Fazer cópia de segurança (.zip)"}
            </button>
            <button className="btn btn-ghost" onClick={() => restoreInput.current?.click()} disabled={!!busy}>
              <Upload size={16} /> {busy === "restore" ? "Restaurando…" : "Restaurar cópia"}
            </button>
            <input
              ref={restoreInput}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void restore(f);
              }}
            />
          </div>
          <div>
            <button
              className="btn btn-ghost danger-text"
              onClick={() =>
                ui.open({
                  type: "confirm",
                  title: "Apagar todos os dados?",
                  message: "Apaga processos, prazos, documentos, arquivos e jurisprudência deste aparelho. Faça uma cópia de segurança antes. Não dá para desfazer.",
                  confirmLabel: "Apagar tudo",
                  danger: true,
                  onConfirm: async () => {
                    await store.replace(emptyDataset());
                    ui.toast("Dados apagados.");
                  },
                })
              }
            >
              <DatabaseBackup size={16} /> Apagar todos os dados
            </button>
          </div>
        </section>

        <p className="muted small center">
          {APP_NAME} {__APP_VERSION__} · os cálculos e as análises são auxiliares: confira sempre os prazos no sistema do tribunal.
        </p>
      </div>
    </div>
  );
}
