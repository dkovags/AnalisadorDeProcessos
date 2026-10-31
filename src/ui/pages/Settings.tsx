import { CalendarX, DatabaseBackup, Download, Globe, HardDrive, Moon, Plus, Trash, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "../../config";
import { makeCalendar, yearHolidays } from "../../domain/calendar";
import { addDays, formatDate, formatDateWeek, parts } from "../../domain/dates";
import type { CitationStyle, Holiday, Prefs } from "../../domain/types";
import * as A from "../../store/actions";
import { makeBackup, readBackup } from "../../store/backup";
import { cnjReport, REACH_TEXT, testCnj, type ApiCheck } from "../../store/cnjapi";
import { emptyDataset } from "../../store/dataset";
import { persistStorage, storageInfo } from "../../store/ingest";
import { CopyButton, Field, fileSize } from "../components/basics";
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

/** Testa se as APIs públicas do CNJ (DJEN e DataJud) aceitam consultas feitas direto deste site. */
function CnjTest() {
  const today = useToday();
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<ApiCheck[] | null>(null);
  return (
    <section className="card pad stack">
      <h2>
        <Globe size={18} /> Busca automática no CNJ (em teste)
      </h2>
      <p className="muted small">
        Para buscar sozinho as intimações publicadas no DJEN e os andamentos do DataJud, o {APP_NAME} precisa que as APIs públicas do CNJ aceitem consultas
        feitas direto deste site. O teste faz uma consulta de exemplo, sem nenhum dado seu, e mostra o resultado.
      </p>
      <div className="row">
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setChecks(await testCnj(today));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Testando…" : "Testar conexão com o CNJ"}
        </button>
        {checks && <CopyButton text={cnjReport(checks, today)} label="Copiar o resultado" />}
      </div>
      {checks && (
        <ul className="cnj-checks">
          {checks.map((c) => (
            <li key={c.api}>
              <strong>{c.api}:</strong> {REACH_TEXT[c.reach]}
              {c.status ? ` (HTTP ${c.status})` : ""}
              {!!c.fields?.length && <div className="muted small">campos: {c.fields.join(", ")}</div>}
            </li>
          ))}
        </ul>
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

        <CnjTest />

        <section className="card pad stack">
          <h2>
            <HardDrive size={18} /> Dados
          </h2>
          <p className="muted small">
            Tudo fica guardado só neste navegador, neste aparelho (nada vai para a internet). Faça cópias de segurança com frequência: se os dados do navegador forem
            apagados, só a cópia recupera os processos e os arquivos.
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
