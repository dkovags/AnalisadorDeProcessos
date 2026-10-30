import { Plus, Sparkles, Trash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { APP_NAME } from "../../config";
import { analyze, type Analysis, type Suggestion } from "../../domain/analysis";
import { CHANNELS, NOTICE_KINDS, RITES, computeDeadline, cachedCalendar } from "../../domain/deadlines";
import { formatDateWeek, relativeDay } from "../../domain/dates";
import { STATUS, TASK_KINDS } from "../../domain/labels";
import { caseLabel, clientOf } from "../../domain/select";
import { checkSummons } from "../../domain/summons";
import { sameParty } from "../../domain/text";
import type { CaseStatus, Channel, Counting, ID, NoticeKind, TaskKind } from "../../domain/types";
import * as A from "../../store/actions";
import { Field, Modal } from "../components/basics";
import { DeadlineMemo } from "../components/Cards";
import { useData, useRun, useStore, useToday, useUI } from "../context";

interface DraftTask {
  key: string;
  on: boolean;
  title: string;
  kind: TaskKind;
  basis?: string;
  checklist: string[];
  note?: string;
  alt?: string;
  fromRule?: string;
}

const READ_LABEL: Partial<Record<Channel, string>> = {
  sistema: "Ciência (consulta)",
  domicilio: "Ciência ou confirmação",
  correio: "Juntada do aviso de recebimento",
  oficial: "Juntada do mandado",
  email: "Confirmação do recebimento",
  pessoal: "Data da ciência",
  edital: "Fim da dilação do edital",
};

let seq = 0;
const key = () => `k${++seq}`;

function draftsFrom(a: Analysis): DraftTask[] {
  const out: DraftTask[] = [];
  a.suggestions.forEach((s: Suggestion, i) => {
    if (!s.petition && s.kind !== "audiencia" && s.kind !== "diligencia") return;
    out.push({
      key: key(),
      on: i === 0 || s.kind === "audiencia",
      title: s.kind === "audiencia" ? a.hearing?.kind || s.act : s.act,
      kind: s.kind,
      basis: s.basis,
      checklist: s.docs,
      note: s.note,
      alt: s.alt,
      fromRule: s.rule,
    });
  });
  return out;
}

export function NoticeDialog({ caseId: initialCase, noticeId, text, docId, onClose }: { caseId?: ID; noticeId?: ID; text?: string; docId?: ID; onClose: () => void }) {
  const ds = useData();
  const store = useStore();
  const ui = useUI();
  const runAction = useRun();
  const today = useToday();
  const prev = noticeId ? ds.notices[noticeId] : undefined;
  const doc = docId ? ds.docs[docId] : prev?.docId ? ds.docs[prev.docId] : undefined;
  const [caseId, setCaseId] = useState<ID>(prev?.caseId || initialCase || doc?.caseId || "");
  const c = ds.cases[caseId];
  const [content, setContent] = useState(prev?.content || text || "");
  const [kind, setKind] = useState<NoticeKind>(prev?.kind || "intimacao");
  const [channel, setChannel] = useState<Channel>(prev?.channel || "djen");
  const [recipients, setRecipients] = useState<ID[]>(prev?.recipients || []);
  const [sentAt, setSentAt] = useState(prev?.sentAt || today);
  const [readAt, setReadAt] = useState(prev?.readAt || "");
  const [days, setDays] = useState(prev?.days ? String(prev.days) : "");
  const [counting, setCounting] = useState<Counting>(prev?.counting || (c ? RITES[c.rite].counting : "uteis"));
  const [double, setDouble] = useState(!!prev?.double);
  const [fromHearing, setFromHearing] = useState(!!prev?.fromHearing);
  const [act, setAct] = useState(prev?.act || "");
  const [basis, setBasis] = useState(prev?.basis || "");
  const [petition, setPetition] = useState(prev ? !!prev.petition : true);
  const [hasHearing, setHasHearing] = useState(!!prev?.hearing);
  const [hearing, setHearing] = useState({ date: prev?.hearing?.date || "", time: prev?.hearing?.time || "", kind: prev?.hearing?.kind || "", place: prev?.hearing?.place || "" });
  const [dueOverride, setDueOverride] = useState(prev?.dueOverride || "");
  const [notes, setNotes] = useState(prev?.notes || "");
  const [drafts, setDrafts] = useState<DraftTask[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [statusSuggestion, setStatusSuggestion] = useState<{ status: CaseStatus; on: boolean } | null>(null);

  const cases = Object.values(ds.cases).sort((a, b) => caseLabel(a).localeCompare(caseLabel(b), "pt-BR"));

  // texto do documento escolhido (expediente enviado ou decisão da base)
  useEffect(() => {
    if (prev || !doc) return;
    let alive = true;
    store.pages(doc.fileId).then((pages) => {
      if (!alive) return;
      const [a, b] = doc.pages || [1, pages.length];
      const t = pages.slice(a - 1, b).join("\n").trim();
      setContent(t);
      apply(t);
      if (doc.date) setSentAt(doc.date);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  useEffect(() => {
    if (!prev && text) apply(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Preenche o formulário a partir do texto. */
  function apply(t: string) {
    if (!t.trim()) return;
    let cs = c;
    const a = analyze(t, { rite: cs?.rite });
    if (!cs && a.caseNumber) {
      const found = A.findCaseByNumber(ds, a.caseNumber);
      if (found) {
        cs = found;
        setCaseId(found.id);
      }
    }
    setAnalysis(a);
    if (a.kind) setKind(a.kind);
    if (a.channel) setChannel(a.channel);
    if (a.sentAt) setSentAt(a.sentAt);
    const main = a.suggestions.find((s) => s.petition) || a.suggestions[0];
    if (main) {
      setAct(main.kind === "audiencia" ? a.hearing?.kind || main.act : main.act);
      setDays(main.days ? String(main.days) : "");
      setCounting(main.counting);
      setBasis(main.basis || "");
      setPetition(main.petition);
    }
    if (a.hearing) {
      setHasHearing(true);
      setHearing({ date: a.hearing.date, time: a.hearing.time || "", kind: a.hearing.kind || "", place: a.hearing.place || "" });
      if (main?.rule === "contestacao" && /concilia/i.test(a.hearing.kind || "")) setFromHearing(true);
    }
    setDrafts(draftsFrom(a));
    if (cs) {
      let rec: ID[] = [];
      if (a.recipients.length) rec = cs.parties.filter((p) => a.recipients.some((n) => sameParty(n, p.name))).map((p) => p.id);
      if (!rec.length && a.target) rec = cs.parties.filter((p) => (a.target === "ambos" ? p.pole !== "terceiro" : p.pole === a.target)).map((p) => p.id);
      if (!rec.length && clientOf(cs)) rec = [clientOf(cs)!.id];
      setRecipients(rec);
      setDouble(cs.parties.some((p) => rec.includes(p.id) && p.doubleTerm));
      if (a.status && a.status.status !== cs.status) setStatusSuggestion({ status: a.status.status, on: true });
    }
  }

  const cal = c ? cachedCalendar(ds, c) : cachedCalendar(ds);
  const daysN = days.trim() ? Number(days) : undefined;
  const result = useMemo(
    () =>
      computeDeadline(
        {
          channel,
          kind,
          sentAt,
          readAt: readAt || undefined,
          days: daysN,
          counting,
          double,
          hearingDate: fromHearing && hasHearing ? hearing.date || undefined : undefined,
          rite: c?.rite,
          today,
        },
        cal,
      ),
    [channel, kind, sentAt, readAt, daysN, counting, double, fromHearing, hasHearing, hearing.date, c?.rite, today, cal],
  );
  const due = dueOverride || result.due;
  const recipientParties = c?.parties.filter((p) => recipients.includes(p.id)) || [];
  const summons =
    kind === "citacao" && c
      ? checkSummons({ kind: recipientParties[0]?.kind, channel, sentAt, readAt: readAt || undefined, today, rite: c.rite, cal })
      : [];

  const save = () => {
    if (!caseId) return ui.toast("Escolha o processo.", { kind: "error" });
    const input: A.NoticeInput = {
      id: noticeId,
      caseId,
      kind,
      channel,
      recipients,
      sentAt,
      readAt: readAt || undefined,
      days: daysN,
      counting,
      double,
      fromHearing: fromHearing && hasHearing,
      dueOverride: dueOverride || undefined,
      act,
      basis,
      petition,
      content,
      docId: prev?.docId || docId,
      hearing: hasHearing && hearing.date ? { date: hearing.date, time: hearing.time || undefined, kind: hearing.kind || undefined, place: hearing.place || undefined } : undefined,
      notes,
      status: prev?.status,
    };
    const tasks: A.TaskDraft[] = noticeId ? [] : drafts.filter((d) => d.on && d.title.trim()).map((d) => ({ title: d.title, kind: d.kind, basis: d.basis, checklist: d.checklist, notes: d.note }));
    const res = runAction(A.saveNotice, input, tasks);
    if (!res) return;
    if (statusSuggestion?.on) runAction(A.setCaseStatus, caseId, statusSuggestion.status, "Atualizada pelo expediente");
    onClose();
    ui.toast(
      noticeId
        ? "Expediente atualizado."
        : res.taskIds.length
          ? `Expediente registrado com ${res.taskIds.length === 1 ? "1 providência" : `${res.taskIds.length} providências`}.`
          : "Expediente registrado.",
    );
  };

  const setDraft = (k: string, patch: Partial<DraftTask>) => setDrafts((list) => list.map((d) => (d.key === k ? { ...d, ...patch } : d)));

  return (
    <Modal
      title={noticeId ? "Expediente" : "Novo expediente"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      {!initialCase && !prev && (
        <Field label="Processo">
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">Escolha o processo</option>
            {cases.map((x) => (
              <option key={x.id} value={x.id}>
                {caseLabel(x)} · {x.number}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Teor do expediente" hint={`Cole a intimação, a citação ou a decisão: o ${APP_NAME} lê o ato a praticar, o prazo, a quem se dirige e os documentos pedidos.`}>
        <textarea
          rows={prev ? 4 : 6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={(e) => {
            // colou num campo vazio: já lê o texto
            const t = e.clipboardData.getData("text");
            if (!prev && !content.trim() && t.trim()) setTimeout(() => apply(t));
          }}
          placeholder="Cole aqui o texto da intimação (DJEN, PJe, e-mail…)"
        />
      </Field>
      {!prev && (
        <button className="btn btn-ghost btn-sm" disabled={!content.trim()} onClick={() => apply(content)}>
          <Sparkles size={15} /> Ler o texto e preencher
        </button>
      )}
      {analysis && analysis.suggestions[0] && (
        <div className="banner info small">
          <Sparkles size={18} />
          <div>
            <strong>{analysis.suggestions[0].petition ? `Exige petição: ${analysis.suggestions[0].act}` : analysis.suggestions[0].act}</strong>
            {analysis.suggestions[0].days ? ` · ${analysis.suggestions[0].days} dias${analysis.suggestions[0].explicit ? " (prazo escrito no texto)" : " (prazo legal)"}` : ""}
            <div className="muted small">Trecho: "{analysis.suggestions[0].excerpt}"</div>
          </div>
        </div>
      )}

      <div className="form-grid">
        <Field label="Tipo">
          <select value={kind} onChange={(e) => setKind(e.target.value as NoticeKind)}>
            {(Object.keys(NOTICE_KINDS) as NoticeKind[]).map((k) => (
              <option key={k} value={k}>
                {NOTICE_KINDS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Meio">
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {(Object.keys(CHANNELS) as Channel[]).map((k) => (
              <option key={k} value={k}>
                {CHANNELS[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={channel === "djen" || channel === "diario" ? "Disponibilização" : channel === "audiencia" ? "Data da audiência" : "Expedição ou envio"}
          hint={!prev && doc?.date && sentAt === doc.date ? "Veio da data do documento: confira a data real da intimação." : undefined}
        >
          <input type="date" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
        </Field>
        {READ_LABEL[channel] && (
          <Field label={READ_LABEL[channel]!} hint={channel === "sistema" || channel === "domicilio" ? "Em branco: ciência ficta 10 dias depois do envio." : undefined}>
            <input type="date" value={readAt} onChange={(e) => setReadAt(e.target.value)} />
          </Field>
        )}
      </div>

      <p className="channel-help">{CHANNELS[channel].help}</p>

      {c && c.parties.length > 0 && (
        <fieldset className="recipients">
          <legend>Destinatários</legend>
          {c.parties.map((p) => (
            <label key={p.id} className="check">
              <input
                type="checkbox"
                checked={recipients.includes(p.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...recipients, p.id] : recipients.filter((x) => x !== p.id);
                  setRecipients(next);
                  setDouble(c.parties.some((x) => next.includes(x.id) && x.doubleTerm));
                }}
              />
              {p.name} <span className="muted">({p.role || p.pole})</span>
              {p.client && <span className="chip tone-ok">cliente</span>}
            </label>
          ))}
        </fieldset>
      )}

      <div className="form-grid">
        <Field label="Ato a praticar">
          <input value={act} onChange={(e) => setAct(e.target.value)} placeholder="Ex.: Réplica, Contrarrazões, Manifestação" />
        </Field>
        <Field label="Prazo (dias)">
          <input type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} placeholder="sem prazo" />
        </Field>
        <Field label="Contagem">
          <select value={counting} onChange={(e) => setCounting(e.target.value as Counting)}>
            <option value="uteis">Dias úteis</option>
            <option value="corridos">Dias corridos</option>
          </select>
        </Field>
        <Field label="Fundamento">
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Ex.: CPC, art. 350" />
        </Field>
        <label className="check span-2">
          <input type="checkbox" checked={petition} onChange={(e) => setPetition(e.target.checked)} /> Exige petição
        </label>
        <label className="check span-2" title="Fazenda Pública, Ministério Público e Defensoria (CPC, arts. 180, 183 e 186)">
          <input type="checkbox" checked={double} onChange={(e) => setDouble(e.target.checked)} /> Prazo em dobro
        </label>
      </div>

      <label className="check">
        <input type="checkbox" checked={hasHearing} onChange={(e) => setHasHearing(e.target.checked)} /> Há audiência ou sessão marcada
      </label>
      {hasHearing && (
        <div className="form-grid">
          <Field label="Data">
            <input type="date" value={hearing.date} onChange={(e) => setHearing({ ...hearing, date: e.target.value })} />
          </Field>
          <Field label="Hora">
            <input type="time" value={hearing.time} onChange={(e) => setHearing({ ...hearing, time: e.target.value })} />
          </Field>
          <Field label="Tipo">
            <input value={hearing.kind} onChange={(e) => setHearing({ ...hearing, kind: e.target.value })} placeholder="Audiência de conciliação" />
          </Field>
          <Field label="Local ou link">
            <input value={hearing.place} onChange={(e) => setHearing({ ...hearing, place: e.target.value })} />
          </Field>
          <label className="check span-4">
            <input type="checkbox" checked={fromHearing} onChange={(e) => setFromHearing(e.target.checked)} /> Contar o prazo a partir da audiência (ex.: contestação, CPC, art. 335, I)
          </label>
        </div>
      )}

      <div className={`deadline-box ${due ? "" : "muted"}`}>
        {due ? (
          <>
            <div className="deadline-due">
              Vencimento: <strong>{formatDateWeek(due)}</strong> <span className="muted">({relativeDay(due, today)})</span>
              {dueOverride && <span className="chip tone-warn">informado à mão</span>}
            </div>
            {!dueOverride && <DeadlineMemo r={result} />}
          </>
        ) : (
          <div>{daysN ? result.pending || "Informe as datas para calcular o vencimento." : "Sem prazo: o expediente fica registrado para controle."}</div>
        )}
        <details>
          <summary>Informar o vencimento à mão</summary>
          <Field label="Vencimento" hint="Use quando o sistema do tribunal indicar outra data (feriado local, suspensão).">
            <input type="date" value={dueOverride} onChange={(e) => setDueOverride(e.target.value)} />
          </Field>
        </details>
      </div>

      {summons.length > 0 && (
        <div className="summons">
          <h3 className="form-section">Conferência da citação</h3>
          {!recipientParties[0]?.kind && <p className="muted small">Informe o tipo de pessoa do réu (em Editar processo) para uma conferência completa.</p>}
          <ul>
            {summons.map((s, i) => (
              <li key={i} className={`note-${s.level}`}>
                {s.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!noticeId && drafts.length > 0 && (
        <div className="drafts">
          <h3 className="form-section">Providências que serão criadas</h3>
          {drafts.map((d) => (
            <div key={d.key} className={`draft ${d.on ? "" : "off"}`}>
              <label className="check">
                <input type="checkbox" checked={d.on} onChange={(e) => setDraft(d.key, { on: e.target.checked })} />
                <input className="draft-title" value={d.title} onChange={(e) => setDraft(d.key, { title: e.target.value })} aria-label="Providência" />
                <span className="chip tone-muted">{TASK_KINDS[d.kind]}</span>
              </label>
              {d.note && <p className="muted small">{d.note}</p>}
              {d.on && (
                <div className="draft-checklist">
                  <div className="muted small">{d.kind === "audiencia" ? "Preparação" : "Documentos para instruir"}:</div>
                  {d.checklist.map((item, i) => (
                    <div key={i} className="draft-item">
                      <input
                        value={item}
                        onChange={(e) => setDraft(d.key, { checklist: d.checklist.map((x, j) => (j === i ? e.target.value : x)) })}
                        aria-label="Documento"
                      />
                      <button className="icon-btn small" aria-label="Tirar" onClick={() => setDraft(d.key, { checklist: d.checklist.filter((_, j) => j !== i) })}>
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                  <button className="link-btn small" onClick={() => setDraft(d.key, { checklist: [...d.checklist, ""] })}>
                    <Plus size={13} /> documento
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!noticeId && !drafts.length && petition && act.trim() && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setDrafts([{ key: key(), on: true, title: act, kind: "peticao", basis, checklist: [] }])}
        >
          <Plus size={14} /> Criar a providência "{act}"
        </button>
      )}

      {statusSuggestion && c && (
        <label className="check">
          <input type="checkbox" checked={statusSuggestion.on} onChange={(e) => setStatusSuggestion({ ...statusSuggestion, on: e.target.checked })} /> Mudar a situação do processo
          para "{STATUS[statusSuggestion.status].label}"
        </label>
      )}

      <Field label="Observações">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
