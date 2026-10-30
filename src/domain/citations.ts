import { checkCaseNumber, digitsOf } from "./cnj";
import { bodyNumber, CLASS_COURT, courtDomain, COURT_SINCE, isSuperior, normalizeClass } from "./courts";
import { diffDays, formatDate, weekday } from "./dates";
import { formatCitation, precedentKey } from "./precedents";
import { extractRefs, nearbyQuote, type Ref } from "./refs";
import type { CitationStyle, Precedent } from "./types";
import { fold, nameKey } from "./text";

// Verificação das citações de jurisprudência de um texto (petição, decisão, parecer):
// coerência interna, número CNJ, existência na base cadastrada e fidelidade do trecho citado à ementa.

export type Level = "ok" | "alerta" | "erro" | "desconhecida";

export interface Issue {
  level: "erro" | "alerta" | "info";
  text: string;
}

export type DiffPart = { t: "eq" | "add" | "del"; text: string };

export interface QuoteCheck {
  status: "fiel" | "fiel_supressoes" | "divergente" | "nao_corresponde";
  similarity: number;
  diff: DiffPart[];
  quote: string;
}

export interface CheckedRef {
  ref: Ref;
  match?: Precedent;
  level: Level;
  issues: Issue[];
  quote?: QuoteCheck;
  /** Referência no formato adequado, a partir da base. */
  suggestion?: string;
  search: { label: string; url: string }[];
}

/** Palavras para comparar textos (sem acentos, pontuação e caixa). */
export function words(s: string): string[] {
  return fold(s)
    .replace(/[^a-z0-9§]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const OMISSION = /\[\s*(?:\.{3}|…)\s*\]|\(\s*(?:\.{3}|…)\s*\)|\.{3}|…/;

/** Diferença palavra a palavra (maior subsequência comum). */
export function diffWords(a: string[], b: string[]): DiffPart[] {
  const n = Math.min(a.length, 1500);
  const m = Math.min(b.length, 4000);
  const table = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[at(i, j)] = a[i] === b[j] ? table[at(i + 1, j + 1)] + 1 : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
  const out: DiffPart[] = [];
  const push = (t: DiffPart["t"], w: string) => {
    const last = out[out.length - 1];
    if (last && last.t === t) last.text += " " + w;
    else out.push({ t, text: w });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("eq", a[i]);
      i++;
      j++;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) push("add", a[i++]);
    else push("del", b[j++]);
  }
  while (i < n) push("add", a[i++]);
  while (j < m) push("del", b[j++]);
  return out;
}

/** O trecho citado confere com a ementa (ou o texto) cadastrada? */
export function checkQuote(quote: string, source: string): QuoteCheck {
  const src = ` ${words(source).join(" ")} `;
  const segments = quote
    .split(OMISSION)
    .map((s) => words(s))
    .filter((w) => w.length >= 2);
  let pos = 0;
  let inOrder = segments.length > 0;
  for (const seg of segments) {
    const idx = src.indexOf(` ${seg.join(" ")} `, pos);
    if (idx < 0) {
      inOrder = false;
      break;
    }
    pos = idx + seg.join(" ").length;
  }
  const qw = words(quote);
  if (inOrder) return { status: segments.length > 1 ? "fiel_supressoes" : "fiel", similarity: 1, diff: [{ t: "eq", text: qw.join(" ") }], quote };
  const sw = words(source);
  const full = diffWords(qw, sw);
  // mostra só a região da ementa que corresponde ao trecho
  const first = full.findIndex((p) => p.t === "eq");
  let last = -1;
  full.forEach((p, k) => p.t === "eq" && (last = k));
  const diff = first < 0 ? full.filter((p) => p.t !== "del") : full.filter((p, k) => p.t !== "del" || (k > first && k < last));
  const matched = diff.filter((p) => p.t === "eq").reduce((s, p) => s + p.text.split(" ").length, 0);
  const similarity = qw.length ? matched / qw.length : 0;
  return { status: similarity >= 0.5 ? "divergente" : "nao_corresponde", similarity, diff, quote };
}

function searchLinks(ref: Ref): { label: string; url: string }[] {
  const what =
    ref.kind === "sumula" ? `${ref.className} ${ref.number}` : ref.kind === "tema" ? `Tema ${ref.number}` : `${ref.className || ""} ${ref.number || ""}`.trim();
  const links: { label: string; url: string }[] = [];
  const domain = courtDomain(ref.court);
  links.push({
    label: domain ? `Procurar em ${domain}` : "Procurar na internet",
    url: `https://www.google.com/search?q=${encodeURIComponent(`"${what}"${domain ? ` site:${domain}` : ""}`)}`,
  });
  if (ref.court === "STJ") links.push({ label: "Pesquisa de jurisprudência do STJ", url: "https://scon.stj.jus.br/SCON/" });
  if (ref.court === "STF") links.push({ label: "Pesquisa de jurisprudência do STF", url: "https://jurisprudencia.stf.jus.br/" });
  if (ref.court === "TST") links.push({ label: "Pesquisa de jurisprudência do TST", url: "https://jurisprudencia.tst.jus.br/" });
  return links;
}

/** Procura a decisão citada na base. */
export function findInLibrary(ref: Ref, library: Precedent[]): Precedent | undefined {
  if (!ref.digits) return undefined;
  const kind = ref.kind === "sumula" ? (ref.vinculante ? "SV" : "S") : ref.kind === "tema" ? "T" : "A";
  const candidates = library.filter((p) => {
    const key = precedentKey(p);
    const [court, k, digits] = key.split("|");
    if (digits !== ref.digits) return false;
    if (kind === "T") return k === "T" || (p.bindingNumber && digitsOf(p.bindingNumber) === ref.digits);
    if (k !== kind) return false;
    return !ref.court || !court || court === ref.court.toUpperCase();
  });
  if (ref.kind === "tema") {
    const byBinding = library.find((p) => p.bindingNumber && digitsOf(p.bindingNumber) === ref.digits && (!ref.court || p.court === ref.court));
    if (byBinding) return byBinding;
  }
  if (candidates.length <= 1) return candidates[0];
  // mesma numeração em classes diferentes: prefere a mesma classe principal
  return candidates.find((p) => normalizeClass(p.className)?.base === ref.baseClass) || candidates[0];
}

const STF_SUMULAS = 736;

function consistency(ref: Ref, today: string): Issue[] {
  const issues: Issue[] = [];
  const court = ref.court?.toUpperCase();
  if (ref.number && /^\d{7}-\d{2}\./.test(ref.number)) {
    const c = checkCaseNumber(ref.number);
    if (c && !c.valid) issues.push({ level: "erro", text: `Número CNJ inválido: ${c.message}` });
    else if (c?.court && court && !ref.courtInferred && c.court !== court)
      issues.push({ level: "erro", text: `O número ${ref.number} é de processo do ${c.court}, mas a citação indica ${court}.` });
  }
  if (ref.baseClass && court && !ref.courtInferred && CLASS_COURT[ref.baseClass] && CLASS_COURT[ref.baseClass] !== court)
    issues.push({ level: "erro", text: `${ref.baseClass} é classe do ${CLASS_COURT[ref.baseClass]}, não do ${court}.` });
  if (ref.rapporteurTitle && court) {
    const t = fold(ref.rapporteurTitle);
    if (isSuperior(court) && /^(des|ju)/.test(t) && !/convocad/.test(t))
      issues.push({ level: "alerta", text: `No ${court}, quem relata é Ministro ou Ministra (salvo convocação): confira "${ref.rapporteurTitle}".` });
    if (!isSuperior(court) && /^min/.test(t)) issues.push({ level: "alerta", text: `No ${court}, quem relata é Desembargador ou Juiz, não Ministro.` });
  }
  if (ref.body && court) {
    const b = bodyNumber(ref.body);
    const limits: Record<string, { turma: number; secao: number }> = { STJ: { turma: 6, secao: 3 }, STF: { turma: 2, secao: 0 }, TST: { turma: 8, secao: 0 } };
    const lim = limits[court];
    if (lim && b.kind === "camara") issues.push({ level: "erro", text: `O ${court} não tem câmaras: confira o órgão julgador ("${ref.body}").` });
    else if (lim && b.kind === "turma" && b.n && b.n > lim.turma) issues.push({ level: "erro", text: `O ${court} tem ${lim.turma} turmas: não existe "${ref.body}".` });
    else if (lim && b.kind === "secao" && b.n && b.n > lim.secao)
      issues.push({ level: "erro", text: lim.secao ? `O ${court} tem ${lim.secao} seções: não existe "${ref.body}".` : `O ${court} não se divide em seções: confira "${ref.body}".` });
    if (court === "STJ" && /plen/.test(fold(ref.body))) issues.push({ level: "alerta", text: "No STJ, o colegiado máximo de julgamento é a Corte Especial, não o Plenário." });
  }
  if (ref.judgedAt && ref.judgedAt > today) issues.push({ level: "erro", text: `Data de julgamento no futuro (${formatDate(ref.judgedAt)}).` });
  if (ref.publishedAt && ref.publishedAt > today) issues.push({ level: "erro", text: `Data de publicação no futuro (${formatDate(ref.publishedAt)}).` });
  if (ref.judgedAt && ref.publishedAt) {
    if (ref.publishedAt < ref.judgedAt) issues.push({ level: "erro", text: "A publicação é anterior ao julgamento: as datas estão trocadas ou erradas." });
    else if (diffDays(ref.judgedAt, ref.publishedAt) > 730) issues.push({ level: "alerta", text: "Mais de dois anos entre o julgamento e a publicação: confira as datas." });
  }
  if (ref.publishedAt && [0, 6].includes(weekday(ref.publishedAt)) && /^dj/i.test(ref.source || "DJe"))
    issues.push({ level: "alerta", text: `O diário não circula em fim de semana: confira a data de publicação (${formatDate(ref.publishedAt)}).` });
  if (court && COURT_SINCE[court] && ref.judgedAt && ref.judgedAt < COURT_SINCE[court])
    issues.push({ level: "erro", text: `O ${court} só foi instalado em ${formatDate(COURT_SINCE[court])}: data de julgamento impossível.` });
  if (ref.kind === "sumula" && court === "STF" && !ref.vinculante && Number(ref.number) > STF_SUMULAS)
    issues.push({ level: "erro", text: `O STF tem ${STF_SUMULAS} súmulas comuns: a Súmula ${ref.number} não existe (seria uma súmula vinculante?).` });
  if (ref.kind === "acordao") {
    const missing = [
      !ref.court && "tribunal",
      !ref.rapporteur && "relator(a)",
      !ref.body && "órgão julgador",
      !ref.judgedAt && "data do julgamento",
      !ref.publishedAt && "fonte e data da publicação",
    ].filter(Boolean);
    if (missing.length)
      issues.push({
        level: "alerta",
        text: `Citação incompleta: falta ${missing.join(", ")}. Na divergência jurisprudencial, a fonte é exigida (CPC, art. 1.029, § 1º).`,
      });
  }
  return issues;
}

function compareWithLibrary(ref: Ref, p: Precedent): Issue[] {
  const issues: Issue[] = [];
  const base = normalizeClass(p.className)?.base;
  if (ref.kind === "acordao" && ref.baseClass && base && base !== ref.baseClass)
    issues.push({ level: "alerta", text: `Na base, o número ${p.number} é ${p.className}, não ${ref.className}.` });
  if (ref.rapporteur && p.rapporteur) {
    const a = nameKey(ref.rapporteur);
    const b = nameKey(p.rapporteur);
    const forJudgment = p.rapporteurForJudgment ? nameKey(p.rapporteurForJudgment) : "";
    const same = a === b || b.includes(a) || a.includes(b) || (forJudgment && (a === forJudgment || forJudgment.includes(a)));
    if (!same) issues.push({ level: "alerta", text: `Relator(a) diferente da base: a base indica ${p.rapporteur}.` });
  }
  if (ref.body && p.body && fold(ref.body) !== fold(p.body)) issues.push({ level: "alerta", text: `Órgão julgador diferente da base: a base indica ${p.body}.` });
  if (ref.judgedAt && p.judgedAt && ref.judgedAt !== p.judgedAt)
    issues.push({ level: "alerta", text: `Data do julgamento diferente da base: ${formatDate(p.judgedAt)}.` });
  if (ref.publishedAt && p.publishedAt && ref.publishedAt !== p.publishedAt)
    issues.push({ level: "alerta", text: `Data da publicação diferente da base: ${formatDate(p.publishedAt)}.` });
  if (p.standing === "superado") issues.push({ level: "alerta", text: "Na base, este entendimento está marcado como superado ou revisto." });
  if (p.standing === "cancelado") issues.push({ level: "erro", text: "Na base, este enunciado está marcado como cancelado." });
  if (!p.checkedAt) issues.push({ level: "info", text: "O cadastro ainda não foi conferido na fonte oficial." });
  return issues;
}

/** Verifica todas as citações do texto. */
export function checkCitations(
  text: string,
  library: Precedent[],
  opts: { today: string; style?: CitationStyle } = { today: "9999-12-31" },
): CheckedRef[] {
  const out: CheckedRef[] = [];
  const refs = extractRefs(text);
  for (const [i, ref] of refs.entries()) {
    const issues = consistency(ref, opts.today);
    const match = findInLibrary(ref, library);
    let quote: QuoteCheck | undefined;
    if (match) {
      issues.push(...compareWithLibrary(ref, match));
      const q = nearbyQuote(text, ref, refs[i - 1]?.end ?? 0, refs[i + 1]?.start ?? text.length);
      if (q && match.summary) {
        quote = checkQuote(q.text, match.summary);
        if (quote.status === "divergente") issues.push({ level: "alerta", text: "O trecho entre aspas tem diferenças em relação à ementa cadastrada." });
        if (quote.status === "nao_corresponde")
          issues.push({ level: "alerta", text: "O trecho entre aspas não corresponde à ementa cadastrada (pode ser do voto ou de outra decisão)." });
      }
    }
    // dados que só a base completa: se a citação estiver incompleta, a sugestão resolve
    const level: Level = issues.some((i) => i.level === "erro")
      ? "erro"
      : !match
        ? "desconhecida"
        : issues.some((i) => i.level === "alerta")
          ? "alerta"
          : "ok";
    out.push({
      ref,
      match,
      level,
      issues,
      quote,
      suggestion: match ? formatCitation(match, opts.style || "forense") : undefined,
      search: searchLinks(ref),
    });
  }
  return out;
}

export const LEVEL_LABEL: Record<Level, string> = {
  ok: "Conferida com a base",
  alerta: "Conferir",
  erro: "Problema",
  desconhecida: "Fora da base",
};
