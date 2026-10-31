import type { Analysis } from "./analysis";
import { clientOf } from "./select";
import { sameParty } from "./text";
import type { Case, CaseStatus, Channel, Counting, Hearing, ID, NoticeKind, TaskKind } from "./types";

// O que um expediente pede, a partir da análise do texto: o ato e o prazo, quem foi intimado, a audiência e as
// providências sugeridas. Serve tanto para a tela de expediente quanto para a importação automática do DJEN.

export interface DraftTask {
  /** Já vem marcada para criar (a principal e as audiências). */
  on: boolean;
  title: string;
  kind: TaskKind;
  basis?: string;
  checklist: string[];
  note?: string;
  alt?: string;
  fromRule?: string;
}

export interface NoticeDraft {
  kind?: NoticeKind;
  channel?: Channel;
  sentAt?: string;
  /** Ato, prazo e fundamento da sugestão principal (ausentes quando o texto não pede nada). */
  act?: string;
  days?: number;
  counting?: Counting;
  basis?: string;
  petition?: boolean;
  hearing?: Hearing;
  /** Contestação contada da audiência de conciliação (CPC, art. 335, I). */
  fromHearing?: boolean;
  /** Partes intimadas (ids das partes do processo). */
  recipients: ID[];
  /** Prazo em dobro: o do cliente, se ele foi intimado; senão, o de qualquer parte intimada. */
  double: boolean;
  tasks: DraftTask[];
  /** Situação que o texto sugere para o processo, quando diferente da atual. */
  status?: CaseStatus;
}

export function noticeDraft(a: Analysis, c?: Case): NoticeDraft {
  const out: NoticeDraft = { kind: a.kind, channel: a.channel, sentAt: a.sentAt, recipients: [], double: false, tasks: [] };
  const main = a.suggestions.find((s) => s.petition) || a.suggestions[0];
  if (main) {
    out.act = main.kind === "audiencia" ? a.hearing?.kind || main.act : main.act;
    out.days = main.days;
    out.counting = main.counting;
    out.basis = main.basis;
    out.petition = main.petition;
  }
  if (a.hearing) {
    out.hearing = a.hearing;
    if (main?.rule === "contestacao" && /concilia/i.test(a.hearing.kind || "")) out.fromHearing = true;
  }
  a.suggestions.forEach((s, i) => {
    if (!s.petition && s.kind !== "audiencia" && s.kind !== "diligencia") return;
    out.tasks.push({
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
  if (c) {
    let rec: ID[] = [];
    if (a.recipients.length) rec = c.parties.filter((p) => a.recipients.some((n) => sameParty(n, p.name))).map((p) => p.id);
    if (!rec.length && a.target) rec = c.parties.filter((p) => (a.target === "ambos" ? p.pole !== "terceiro" : p.pole === a.target)).map((p) => p.id);
    if (!rec.length && clientOf(c)) rec = [clientOf(c)!.id];
    out.recipients = rec;
    // o prazo que importa é o do cliente: intimado junto com um ente público, ele não ganha o prazo em dobro
    const client = clientOf(c);
    out.double = client && rec.includes(client.id) ? !!client.doubleTerm : c.parties.some((p) => rec.includes(p.id) && !!p.doubleTerm);
    if (a.status && a.status.status !== c.status) out.status = a.status.status;
  }
  return out;
}
