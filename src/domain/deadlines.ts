import { makeCalendar, type Calendar } from "./calendar";
import { addDays, diffDays, formatDate, formatDateWeek } from "./dates";
import type { Case, Channel, Counting, Dataset, Notice, NoticeKind, Rite, Task } from "./types";

// Cálculo de prazos processuais, com a memória de cálculo mostrada à pessoa.
// Regras: CPC, arts. 219, 220, 224 e 231; Lei 11.419/2006, art. 5º; CPP, art. 798 e Súmulas 310 e 710 do STF.

export const CHANNELS: Record<Channel, { label: string; read?: string; help: string }> = {
  djen: {
    label: "DJEN (Diário de Justiça Eletrônico Nacional)",
    help: "Publicação no primeiro dia útil depois da disponibilização; o prazo começa no dia útil seguinte (CPC, art. 224, §§ 2º e 3º).",
  },
  diario: {
    label: "Diário da Justiça eletrônico do tribunal",
    help: "Publicação no primeiro dia útil depois da disponibilização; o prazo começa no dia útil seguinte (CPC, art. 224, §§ 2º e 3º).",
  },
  sistema: {
    label: "Sistema do tribunal (PJe, eproc, e-SAJ)",
    read: "Ciência (consulta ao teor)",
    help: "Intimação na data da consulta; sem consulta, considera-se feita ao fim de 10 dias corridos do envio (Lei 11.419/2006, art. 5º).",
  },
  domicilio: {
    label: "Domicílio Judicial Eletrônico",
    read: "Ciência ou confirmação do recebimento",
    help: "Intimação: como no sistema do tribunal (10 dias corridos para a ciência). Citação: prazo a partir do 5º dia útil depois da confirmação (CPC, art. 231, IX).",
  },
  correio: {
    label: "Correio (aviso de recebimento)",
    read: "Juntada do aviso de recebimento",
    help: "O prazo começa a correr da juntada do aviso de recebimento aos autos (CPC, art. 231, I). No processo penal, da data da intimação (Súmula 710 do STF).",
  },
  oficial: {
    label: "Oficial de justiça (mandado)",
    read: "Juntada do mandado cumprido",
    help: "O prazo começa a correr da juntada do mandado cumprido (CPC, art. 231, II). No processo penal, da data da intimação (Súmula 710 do STF).",
  },
  email: {
    label: "E-mail (citação eletrônica)",
    read: "Confirmação do recebimento",
    help: "Prazo a partir do 5º dia útil seguinte à confirmação do recebimento (CPC, art. 231, IX).",
  },
  audiencia: {
    label: "Em audiência ou sessão",
    help: "Intimação na própria audiência; o prazo começa no dia útil seguinte (CPC, art. 1.003, § 1º).",
  },
  pessoal: {
    label: "Pessoalmente, no balcão ou por carga dos autos",
    read: "Data da ciência",
    help: "O prazo começa no dia útil seguinte ao da ciência (CPC, art. 231, VIII).",
  },
  edital: {
    label: "Edital",
    read: "Fim da dilação fixada pelo juiz",
    help: "O prazo começa no dia útil seguinte ao fim da dilação assinada pelo juiz (CPC, art. 231, IV).",
  },
};

export const NOTICE_KINDS: Record<NoticeKind, string> = {
  intimacao: "Intimação",
  citacao: "Citação",
  notificacao: "Notificação",
  vista: "Vista",
  outro: "Outro",
};

export const RITES: Record<Rite, { label: string; counting: Counting }> = {
  civel: { label: "Cível (CPC)", counting: "uteis" },
  juizado: { label: "Juizado Especial", counting: "uteis" },
  trabalho: { label: "Trabalhista (CLT)", counting: "uteis" },
  penal: { label: "Penal (CPP)", counting: "corridos" },
};

export interface Step {
  date: string;
  text: string;
}

export interface DeadlineResult {
  /** Dia do começo (intimação, publicação ou ciência), que não entra na contagem. */
  trigger?: string;
  /** Primeiro dia contado. */
  start?: string;
  /** Último dia do prazo. */
  due?: string;
  days?: number;
  /** A ciência ainda pode acontecer antes (prazo calculado com a ciência ficta). */
  provisional?: boolean;
  /** Motivo de não haver vencimento (falta de data, citação não confirmada). */
  pending?: string;
  steps: Step[];
  /** Dias que não entraram na contagem, com o motivo. */
  skipped: Step[];
}

export interface DeadlineInput {
  channel: Channel;
  kind?: NoticeKind;
  sentAt?: string;
  readAt?: string;
  days?: number;
  counting: Counting;
  double?: boolean;
  /** Data da audiência, quando o prazo corre a partir dela. */
  hearingDate?: string;
  rite?: Rite;
  /** Hoje (para saber se a ciência ficta já aconteceu). */
  today?: string;
}

const describe = (cal: Calendar, iso: string) => cal.info(iso).reasons.join(", ");

/** n-ésimo dia útil depois de iso. */
function nthBusiness(cal: Calendar, iso: string, n: number): string {
  let d = iso;
  for (let i = 0; i < n; i++) d = cal.nextBusiness(d);
  return d;
}

/** Dia do começo do prazo conforme o meio do expediente. */
function triggerOf(input: DeadlineInput, cal: Calendar, steps: Step[]): { date?: string; provisional?: boolean; pending?: string } {
  const { channel, sentAt, readAt, today } = input;
  if (input.hearingDate) {
    steps.push({ date: input.hearingDate, text: "Audiência: o prazo corre a partir dela" });
    return { date: input.hearingDate };
  }
  switch (channel) {
    case "djen":
    case "diario": {
      if (!sentAt) return { pending: "Informe a data da disponibilização." };
      const pub = cal.nextBusiness(sentAt);
      steps.push({ date: sentAt, text: "Disponibilização no diário" });
      steps.push({ date: pub, text: "Publicação: primeiro dia útil seguinte à disponibilização (CPC, art. 224, § 2º)" });
      return { date: pub };
    }
    case "sistema":
    case "domicilio": {
      if (channel === "domicilio" && input.kind === "citacao") {
        if (!readAt) {
          if (sentAt) steps.push({ date: sentAt, text: "Envio da citação eletrônica" });
          return {
            pending:
              "Aguardando a confirmação do recebimento. Sem confirmação em 3 dias úteis, a citação deve ser repetida por outro meio (CPC, art. 246, § 1º-A).",
          };
        }
        const fifth = nthBusiness(cal, readAt, 5);
        steps.push({ date: readAt, text: "Confirmação do recebimento da citação" });
        steps.push({ date: fifth, text: "Quinto dia útil seguinte à confirmação (CPC, art. 231, IX)" });
        return { date: fifth };
      }
      if (readAt) {
        if (sentAt) steps.push({ date: sentAt, text: "Envio da intimação" });
        if (!cal.isBusiness(readAt)) {
          const next = cal.nextBusiness(readAt);
          steps.push({ date: readAt, text: `Consulta em dia não útil (${describe(cal, readAt)})` });
          steps.push({ date: next, text: "Intimação considerada feita no primeiro dia útil seguinte (Lei 11.419/2006, art. 5º, § 2º)" });
          return { date: next };
        }
        steps.push({ date: readAt, text: "Ciência: consulta ao teor da intimação (Lei 11.419/2006, art. 5º, § 1º)" });
        return { date: readAt };
      }
      if (!sentAt) return { pending: "Informe a data do envio." };
      let limit = addDays(sentAt, 10);
      steps.push({ date: sentAt, text: "Envio da intimação" });
      steps.push({ date: limit, text: "Fim dos 10 dias corridos para a consulta: ciência ficta (Lei 11.419/2006, art. 5º, § 3º)" });
      if (!cal.isBusiness(limit)) {
        const reason = describe(cal, limit);
        limit = cal.nextBusiness(limit);
        steps.push({ date: limit, text: `O 10º dia não foi útil (${reason}): ciência no primeiro dia útil seguinte` });
      }
      return { date: limit, provisional: !!today && today < limit };
    }
    case "correio":
    case "oficial": {
      const date = readAt || sentAt;
      if (!date) return { pending: channel === "correio" ? "Informe a data da juntada do aviso de recebimento." : "Informe a data da juntada do mandado." };
      if (input.rite === "penal") steps.push({ date, text: "Data da intimação (Súmula 710 do STF)" });
      else
        steps.push({
          date,
          text: readAt
            ? channel === "correio"
              ? "Juntada do aviso de recebimento (CPC, art. 231, I)"
              : "Juntada do mandado cumprido (CPC, art. 231, II)"
            : "Data informada (confira a data da juntada aos autos)",
        });
      return { date };
    }
    case "email": {
      const date = readAt || sentAt;
      if (!date) return { pending: "Informe a data da confirmação do recebimento." };
      const fifth = nthBusiness(cal, date, 5);
      steps.push({ date, text: "Confirmação do recebimento" });
      steps.push({ date: fifth, text: "Quinto dia útil seguinte à confirmação (CPC, art. 231, IX)" });
      return { date: fifth };
    }
    case "edital": {
      const date = readAt || sentAt;
      if (!date) return { pending: "Informe o fim da dilação do edital." };
      steps.push({ date, text: "Fim da dilação fixada pelo juiz (CPC, art. 231, IV)" });
      return { date };
    }
    case "audiencia": {
      if (!sentAt) return { pending: "Informe a data da audiência." };
      steps.push({ date: sentAt, text: "Intimação em audiência (CPC, art. 1.003, § 1º)" });
      return { date: sentAt };
    }
    default: {
      const date = readAt || sentAt;
      if (!date) return { pending: "Informe a data da ciência." };
      steps.push({ date, text: "Ciência" });
      return { date };
    }
  }
}

/** Calcula o vencimento de um prazo, com a memória de cálculo. */
export function computeDeadline(input: DeadlineInput, cal: Calendar = makeCalendar()): DeadlineResult {
  const steps: Step[] = [];
  const skipped: Step[] = [];
  const t = triggerOf(input, cal, steps);
  if (!t.date) return { steps, skipped, pending: t.pending };
  let trigger = t.date;
  if (!input.days || input.days <= 0) return { trigger, steps, skipped, provisional: t.provisional };

  // CPC, art. 224, § 1º: o dia do começo em dia de expediente reduzido é protraído
  const ti = cal.info(trigger);
  if (ti.partial) {
    const next = cal.nextBusiness(trigger);
    steps.push({ date: next, text: `Dia do começo com expediente reduzido (${ti.reasons.join(", ")}): protraído (CPC, art. 224, § 1º)` });
    trigger = next;
  }

  const days = input.double ? input.days * 2 : input.days;
  if (input.double) steps.push({ date: trigger, text: `Prazo em dobro: ${input.days} × 2 = ${days} dias` });

  let start = "";
  let d = trigger;
  if (input.counting === "uteis") {
    let count = 0;
    for (let guard = 0; count < days && guard < 3000; guard++) {
      d = addDays(d, 1);
      if (cal.counts(d)) {
        count++;
        if (count === 1) start = d;
      } else skipped.push({ date: d, text: describe(cal, d) });
    }
    steps.push({ date: start, text: "Início da contagem: primeiro dia útil seguinte (CPC, art. 224, § 3º)" });
    steps.push({ date: d, text: `${days}º dia útil (CPC, art. 219)` });
  } else {
    // dias corridos: começa no primeiro dia útil (Súmula 310 do STF) e não para nos feriados, só nas suspensões
    start = cal.nextBusiness(trigger);
    for (let guard = 0; !cal.counts(start) && guard < 400; guard++) start = cal.nextBusiness(start);
    for (let x = addDays(trigger, 1); x < start; x = addDays(x, 1)) skipped.push({ date: x, text: describe(cal, x) });
    let count = 1;
    d = start;
    for (let guard = 0; count < days && guard < 3000; guard++) {
      d = addDays(d, 1);
      if (cal.info(d).suspended) skipped.push({ date: d, text: describe(cal, d) });
      else count++;
    }
    steps.push({ date: start, text: "Início da contagem: primeiro dia útil seguinte (Súmula 310 do STF)" });
    steps.push({ date: d, text: `${days}º dia corrido` });
  }

  // vencimento em dia sem expediente, com expediente reduzido ou suspenso: próximo dia útil (CPC, art. 224, § 1º)
  for (let guard = 0; guard < 400; guard++) {
    const i = cal.info(d);
    if (i.expedient && !i.partial && !i.suspended) break;
    const next = cal.nextBusiness(d);
    steps.push({ date: next, text: `Vencimento em ${i.reasons.join(", ")}: prorrogado para o primeiro dia útil seguinte (CPC, art. 224, § 1º)` });
    d = next;
  }
  return { trigger, start, due: d, days, steps, skipped, provisional: t.provisional };
}

/** Subtrai n dias úteis (para o prazo interno). */
export function businessDaysBefore(cal: Calendar, iso: string, n: number): string {
  let d = iso;
  for (let i = 0; i < n; ) {
    d = addDays(d, -1);
    if (cal.counts(d)) i++;
  }
  return d;
}

/** Dias úteis de hoje até a data (0 = vence hoje; negativo = vencido, em dias corridos). */
export function businessDaysUntil(cal: Calendar, today: string, iso: string): number {
  if (iso < today) return diffDays(iso, today) * -1;
  let n = 0;
  for (let d = today; d < iso; ) {
    d = addDays(d, 1);
    if (cal.counts(d)) n++;
  }
  return n;
}

/** Calendário do processo (feriados locais do tribunal dele). */
export function calendarFor(ds: Dataset, c?: Case): Calendar {
  return makeCalendar({ holidays: ds.prefs.holidays, forensic: ds.prefs.forensic, court: c?.court });
}

const calCache = new WeakMap<Dataset, Map<string, Calendar>>();

/** Mesmo que calendarFor, mas reaproveita o calendário enquanto os dados não mudam. */
export function cachedCalendar(ds: Dataset, c?: Case): Calendar {
  let m = calCache.get(ds);
  if (!m) calCache.set(ds, (m = new Map()));
  const key = c?.court?.toUpperCase() || "";
  let cal = m.get(key);
  if (!cal) m.set(key, (cal = calendarFor(ds, c)));
  return cal;
}

export function noticeDeadline(ds: Dataset, n: Notice, today?: string): DeadlineResult {
  const c = ds.cases[n.caseId];
  const res = computeDeadline(
    {
      channel: n.channel,
      kind: n.kind,
      sentAt: n.sentAt,
      readAt: n.readAt,
      days: n.days,
      counting: n.counting,
      double: n.double,
      hearingDate: n.fromHearing ? n.hearing?.date : undefined,
      rite: c?.rite,
      today,
    },
    cachedCalendar(ds, c),
  );
  if (n.dueOverride) {
    res.steps.push({ date: n.dueOverride, text: "Vencimento informado à mão" });
    return { ...res, due: n.dueOverride, pending: undefined };
  }
  return res;
}

/** Prazo fatal da providência: o informado ou o do expediente de origem. */
export function taskDue(ds: Dataset, t: Task, today?: string): string | undefined {
  if (t.due) return t.due;
  if (t.kind === "audiencia" && t.noticeId) return ds.notices[t.noticeId]?.hearing?.date;
  const n = t.noticeId ? ds.notices[t.noticeId] : undefined;
  return n ? noticeDeadline(ds, n, today).due : undefined;
}

/** Prazo interno: o informado ou alguns dias úteis antes do prazo fatal (configurável). */
export function taskInternalDue(ds: Dataset, t: Task, today?: string): string | undefined {
  if (t.internalDue) return t.internalDue;
  const due = taskDue(ds, t, today);
  if (!due || t.kind === "audiencia" || !ds.prefs.marginDays) return due;
  return businessDaysBefore(cachedCalendar(ds, ds.cases[t.caseId]), due, ds.prefs.marginDays);
}

export type Urgency = "vencido" | "hoje" | "amanha" | "semana" | "futuro" | "sem";

export function urgencyOf(today: string, due: string | undefined): Urgency {
  if (!due) return "sem";
  const n = diffDays(today, due);
  if (n < 0) return "vencido";
  if (n === 0) return "hoje";
  if (n === 1) return "amanha";
  if (n <= 7) return "semana";
  return "futuro";
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  vencido: "Vencido",
  hoje: "Vence hoje",
  amanha: "Vence amanhã",
  semana: "Próximos 7 dias",
  futuro: "Mais adiante",
  sem: "Sem prazo",
};

/** Texto da memória de cálculo, para copiar. */
export function deadlineReport(r: DeadlineResult): string {
  const lines = r.steps.map((s) => `${formatDateWeek(s.date)}: ${s.text}`);
  if (r.skipped.length) lines.push(`Dias não contados: ${r.skipped.map((s) => `${formatDate(s.date)} (${s.text})`).join("; ")}`);
  if (r.due) lines.push(`Vencimento: ${formatDateWeek(r.due)}`);
  return lines.join("\n");
}
