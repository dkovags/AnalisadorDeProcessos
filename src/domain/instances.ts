import { digitsOf, parseCnj } from "./cnj";
import { STATUS } from "./labels";
import { fold, sameParty } from "./text";
import type { Case, CaseInstance, CaseStatus, Dataset, HistoryEntry, InstanceLevel } from "./types";

// Instâncias do processo: a origem (vara, juizado) e as de recurso (turma recursal, câmara ou turma do tribunal),
// uniformização e tribunais superiores. O recurso que sobe nos mesmos autos (apelação, recurso inominado) mantém o
// número do processo; o autuado à parte (agravo de instrumento, recurso de medida cautelar, mandado de segurança na
// turma recursal) ganha número próprio. Cada instância guarda o órgão, o número e o link da consulta pública, que muda
// de um grau para o outro.

export const INSTANCE_LABEL: Record<InstanceLevel, string> = {
  origem: "Origem",
  recursal: "Recurso",
  uniformizacao: "Uniformização",
  superior: "Tribunal superior",
};

const RANK: Record<InstanceLevel, number> = { origem: 0, recursal: 1, uniformizacao: 2, superior: 3 };

/** Texto do andamento quando os autos chegam à instância. */
const ARRIVED: Record<InstanceLevel, string> = {
  origem: "Processo na origem",
  recursal: "Processo na instância de recurso",
  uniformizacao: "Processo na uniformização de jurisprudência",
  superior: "Processo no tribunal superior",
};

const SUPERIOR_COURTS = new Set(["STF", "STJ", "TST", "TSE", "STM"]);

const RECURSAL = new RegExp(
  [
    "turmas? recursa",
    "colegio recursal",
    "\\bcamara\\b(?! de (conciliacao|mediacao))",
    "desembargador",
    "\\bdes\\.",
    "\\bdesa\\b",
    "convocad[oa]",
    "segundo grau",
    "2[ºo] grau",
    "vice-?presid",
    "\\b[1-4]?vp\\b",
    "presidencia",
    "orgao especial",
    "tribunal pleno",
    "\\bsecao (de direito|civel|criminal|especializada)",
    "\\bturma\\b",
  ].join("|"),
);

/** Instância pelo nome do órgão ("3ª Turma Recursal Cível", "Gabinete do Des. Fulano") e pelo tribunal (STJ, STF...). */
export function instanceLevel(body: string | undefined, court?: string): InstanceLevel {
  if (court && SUPERIOR_COURTS.has(court.toUpperCase())) return "superior";
  const f = fold(body || "");
  if (/uniformiza|\btnu\b|\btru\b/.test(f)) return "uniformizacao";
  return RECURSAL.test(f) ? "recursal" : "origem";
}

/** Grau informado pelo DataJud: G1 e JE (juizado) são a origem; G2 e TR, recurso; TRU e TNU, uniformização; SUP, superior. */
export function levelOfGrau(grau: string | undefined): InstanceLevel | undefined {
  const g = (grau || "").toUpperCase();
  if (g === "G1" || g === "JE") return "origem";
  if (g === "G2" || g === "TR") return "recursal";
  if (g === "TRU" || g === "TNU" || g === "TUJ") return "uniformizacao";
  if (g === "SUP") return "superior";
  return undefined;
}

/** Classes dos recursos e ações que tramitam à parte, com número próprio. */
export const SEPARATE_APPEAL =
  /agravo de instrumento|recurso de medida cautelar|mandado de seguranca|habeas corpus|reclamacao|conflito de competencia|pedido de efeito suspensivo|tutela (cautelar|antecipada) antecedente|recurso (especial|extraordinario)|agravo em recurso|pedido de uniformizacao/;

/** Instância em que os autos estão agora: entre as que não têm número próprio, a de notícia mais recente. */
export function currentInstance(c: Pick<Case, "instances">): CaseInstance | undefined {
  let best: CaseInstance | undefined;
  for (const i of c.instances || []) {
    if (i.number) continue;
    const d = i.last || i.since || "";
    const bd = best ? best.last || best.since || "" : "";
    if (!best || d > bd || (d === bd && RANK[i.level] > RANK[best.level])) best = i;
  }
  return best;
}

/** Notícia do processo numa instância: uma comunicação do DJEN ou o conjunto de movimentações de um grau no DataJud. */
export interface Sighting {
  level: InstanceLevel;
  body?: string;
  /** Número nesta instância, só quando diferente do número do processo. */
  number?: string;
  className?: string;
  /** Primeira e última data em que o processo apareceu na instância (numa comunicação, as duas são a mesma). */
  since: string;
  last?: string;
  source: NonNullable<CaseInstance["source"]>;
}

/** Nome mais informativo do órgão: "1ª Turma Recursal Cível" diz mais que "Gabinete do Juiz Fulano". */
function betterBody(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const score = (s: string) => (/turma|camara|colegio|secao|orgao especial/.test(fold(s)) ? 2 : /gabinete|secretaria/.test(fold(s)) ? 0 : 1);
  return score(b) > score(a) ? b : a;
}

const EARLY: CaseStatus[] = ["ativo", "aguardando", "concluso", "audiencia", "pericia", "sentenciado"];

/**
 * Registra a notícia do processo numa instância. Quando os autos sobem (instância de recurso nova, sem número
 * próprio), anota nos andamentos e passa a situação para "Em grau de recurso"; quando voltam à origem, anota a
 * volta; o recurso autuado à parte entra na lista com o número dele, sem mudar a situação do processo.
 */
export function trackInstance(c: Case, s: Sighting, ctx: { id: (prefix?: string) => string; now: string }): { case: Case; added?: CaseInstance } {
  const before = currentInstance(c);
  const instances = [...(c.instances || [])];
  const history: HistoryEntry[] = [...c.history];
  // as anotações levam a marca "instancia:", para não irem junto quando um recurso à parte é ligado a outro processo
  const note = (date: string, text: string, ref: string, kind: HistoryEntry["kind"] = "evento") =>
    history.push({ id: ctx.id("h"), date, at: ctx.now, kind, text, ref });
  // a origem entra na lista junto com a primeira instância de recurso, com o órgão do cadastro
  if (s.level !== "origem" && !s.number && !instances.some((i) => i.level === "origem" && !i.number) && instanceLevel(c.body) === "origem")
    instances.push({ id: ctx.id("in"), level: "origem", body: c.body, since: c.filedAt, source: s.source });
  const last = s.last && s.last > s.since ? s.last : s.since;
  const idx = instances.findIndex((i) => i.level === s.level && digitsOf(i.number || "") === digitsOf(s.number || ""));
  let added: CaseInstance | undefined;
  if (idx >= 0) {
    const i = instances[idx];
    instances[idx] = {
      ...i,
      body: i.level === "origem" ? i.body || s.body : betterBody(i.body, s.body),
      className: i.className || s.className,
      since: !i.since || s.since < i.since ? s.since : i.since,
      last: !i.last || last > i.last ? last : i.last,
    };
  } else {
    added = { id: ctx.id("in"), level: s.level, body: s.body, number: s.number, className: s.className, since: s.since, last, source: s.source };
    instances.push(added);
  }
  let status = c.status;
  if (added?.number) {
    note(s.since, `Recurso autuado à parte: ${[added.className, `nº ${added.number}`].filter(Boolean).join(" ")}${added.body ? ` (${added.body})` : ""}`, `instancia:${added.id}`);
  } else {
    const after = currentInstance({ instances });
    if (after && after.id !== before?.id) {
      const date = after.level !== "origem" ? after.since || s.since : s.since;
      if (after.level !== "origem") {
        note(date, `${ARRIVED[after.level]}${after.body ? `: ${after.body}` : ""}`, `instancia:${after.id}:${date}`);
        if (EARLY.includes(status)) {
          note(date, `Situação: ${STATUS[status].label} → ${STATUS.recurso.label}`, `instancia:${after.id}:situacao`, "status");
          status = "recurso";
        }
      } else if (before && before.level !== "origem") {
        note(date, `Processo de volta à origem${after.body ? `: ${after.body}` : ""}`, `instancia:${after.id}:${date}`);
      }
    }
  }
  return { case: { ...c, instances, history, status, updatedAt: ctx.now }, added };
}

/** O processo parece um recurso autuado à parte (classe de recurso, ou número do próprio tribunal ou da turma recursal)? */
export function looksSeparateAppeal(c: Case): boolean {
  if (SEPARATE_APPEAL.test(fold(c.className || ""))) return true;
  const origin = parseCnj(c.number)?.origin;
  return (origin === "0000" || origin === "9000") && (c.instances || []).some((i) => i.level !== "origem" && !i.number);
}

/** Processos que podem ser o principal de um recurso: os que têm partes em comum vêm primeiro. */
export function linkCandidates(ds: Dataset, c: Case): { case: Case; common: number }[] {
  return Object.values(ds.cases)
    .filter((x) => x.id !== c.id)
    .map((x) => ({ case: x, common: x.parties.filter((p) => c.parties.some((q) => sameParty(p.name, q.name))).length }))
    .sort((a, b) => b.common - a.common || b.case.updatedAt.localeCompare(a.case.updatedAt));
}
