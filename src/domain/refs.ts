import { CNJ_RE, courtOfCnj, digitsOf, parseCnj } from "./cnj";
import { BODY_RE, CLASS_COURT, COURT_SIGLA_RE, courtFromName, normalizeBody, normalizeClass, normalizeCourt } from "./courts";
import { findDates, fold, squash, titleCase } from "./text";

// Encontra citações de jurisprudência num texto e lê os dados de cada uma
// (tribunal, classe, número, relator, órgão julgador, datas de julgamento e de publicação).

export interface Ref {
  kind: "acordao" | "sumula" | "tema";
  /** Posição da citação no texto. */
  start: number;
  end: number;
  raw: string;
  court?: string;
  /** O tribunal não estava escrito: foi deduzido da classe ou do número. */
  courtInferred?: boolean;
  className?: string;
  baseClass?: string;
  number?: string;
  digits?: string;
  uf?: string;
  rapporteur?: string;
  rapporteurTitle?: string;
  female?: boolean;
  body?: string;
  judgedAt?: string;
  publishedAt?: string;
  source?: string;
  vinculante?: boolean;
}

// Classes que dispensam contexto (não se confundem com siglas de estados ou palavras comuns).
const STRONG = ["EAREsp", "EREsp", "AREsp", "REsp", "RMS", "RHC", "HC", "ADPF", "ADI", "ADC", "ADO", "ARE", "AIRR", "RRAg", "Rcl", "PUIL", "APn"];
const WEAK = ["RE", "AI", "AR", "AP", "CC", "MS", "MI", "Pet", "SS", "SL", "SLS", "STA", "SEC", "HDE", "RR", "ACO", "AO", "Inq", "IAC"];
const PREFIX = "(?:(?:AgInt|AgRg|AgR|EDcl|EDv|ED|QO|MC|TP)\\s+(?:nos|nas|no|na|em)\\s+)*";
const SUPERIOR_RE = new RegExp(
  `\\b(${PREFIX})(${[...STRONG, ...WEAK].join("|")})\\s*:?\\s*(?:n\\.?\\s*[º°o]?\\.?\\s*|nº\\s*)?(\\d{1,3}(?:\\.\\d{3})+|\\d{1,9})(?:\\s*[/-]\\s*([A-Z]{2})\\b|\\s+([A-Z]{2})(?=[\\s,;)]|$))?((?:\\s+(?:AgR|ED|EDv|QO|MC|AgR-ED|ED-AgR|ED-ED)(?:-(?:AgR|ED|EDv|QO))*)*)`,
  "g",
);
const LOCAL_CLASS_BEFORE =
  /(apela[çc][ãa]o c[íi]vel|apela[çc][ãa]o criminal|apela[çc][ãa]o|agravo de instrumento|agravo interno|embargos de declara[çc][ãa]o|recurso inominado|recurso em sentido estrito|remessa necess[áa]ria|reexame necess[áa]rio|mandado de seguran[çc]a|habeas corpus|recurso ordin[áa]rio|agravo de peti[çc][ãa]o|conflito de compet[êe]ncia|\bApCiv\b|\bApCrim\b|\bAC\b|\bAI\b|\bRI\b|\bAPL\b|\bACR\b|\bRESE\b|\bROT?\b|\bAP\b|\bMS\b|\bHC\b|\bED\b)\s*(?:n[º°o.]*\.?\s*|:\s*)?$/i;
const CUE_RE = /\b(rel\.|relator|relatora|julgad|j\.|julg\.|data de julgamento|data do julgamento|dje|dj\b|djen|turma|c[âa]mara|se[çc][ãa]o|pleno|plen[áa]rio|corte especial|ementa|ac[óo]rd[ãa]o)/i;
const SUMULA_RE =
  /\b(s[úu]mula|enunciado)(\s+vinculante)?\s*(?:n\.?\s*[º°o]?\.?\s*|nº\s*)?(\d{1,4})\b(?:\s*(?:\/|do|da|d[oa]\s+(?:col\.|colendo|egr[ée]gio|excelso|e\.)?)\s*(STF|STJ|TST|TSE|TNU|Supremo Tribunal Federal|Superior Tribunal de Justi[çc]a|Tribunal Superior do Trabalho|Tribunal Superior Eleitoral))?|\bSV\s*(?:n[º°.]*\s*)?(\d{1,3})\b/gi;
const TEMA_RE =
  /\btema\s+(?:repetitivo\s+|de repercuss[ãa]o geral\s+|da repercuss[ãa]o geral\s+)?(?:n\.?\s*[º°o]?\.?\s*|nº\s*)?(\d{1,4}(?:\.\d{3})?)\b(?:\s*(?:\/|do|da)\s*(STF|STJ|TST))?/gi;

const RAPPORTEUR_START = /\b(?:rel(?:ator)?(?:\(a\)|a)?\.?|relatora)\s*(?:p\/\s*(?:o\s*)?ac[óo]rd[ãa]o\s*)?:?\s+/gi;
const TITLE_RE =
  /^(?:(?:o|a)\s+)?(min(?:istr[oa])?\.?|des(?:embargador[a]?)?\.?(?:\s+federal)?|ju[ií]z[a]?(?:\s+federal)?(?:\s+convocad[oa])?|conselheir[oa]|min\.ª)\s+/i;
const NAME_STOP = /^(?:terceira|quarta|primeira|segunda|quinta|sexta|s[ée]tima|oitava|turma|corte|se[çc][ãa]o|pleno|plen[áa]rio|julgad\w*|j\.|julg\.|dje?n?\b|data|publica\w*|t\d|c[âa]mara|[óo]rg[ãa]o|\d)/i;
const PARTICLES = new Set(["de", "da", "do", "das", "dos", "e", "d'"]);

/** Lê o nome de quem relatou a partir de "Rel. Min. Fulano de Tal, ...". */
export function readRapporteur(s: string): Pick<Ref, "rapporteur" | "rapporteurTitle" | "female"> | null {
  RAPPORTEUR_START.lastIndex = 0;
  const start = RAPPORTEUR_START.exec(s);
  if (!start) return null;
  // o nome termina no fim da linha (cabeçalhos: "RELATOR : MINISTRO X" e, abaixo, "AGRAVANTE : ...")
  let rest = s.slice(start.index + start[0].length).split("\n")[0];
  let title = "";
  const t = rest.match(TITLE_RE);
  if (t) {
    title = t[1];
    rest = rest.slice(t[0].length);
  }
  const words: string[] = [];
  for (const w of rest.split(/\s+/)) {
    const clean = w.replace(/[,;:)]+$/, "");
    if (!clean || NAME_STOP.test(clean)) break;
    const isName = /^[A-ZÀ-Ú][\p{L}'.-]*$/u.test(clean) || (PARTICLES.has(clean.toLowerCase()) && words.length > 0);
    if (!isName) break;
    words.push(clean);
    if (/[,;:)]$/.test(w) || words.length >= 7) break;
  }
  while (words.length && PARTICLES.has(words[words.length - 1].toLowerCase())) words.pop();
  if (!words.length) return null;
  const head = fold(start[0] + title);
  const female = /relatora|ministra|desembargadora|juiza|conselheira|min\.a/.test(head);
  const ft = fold(title);
  const rapporteurTitle = /^min/.test(ft) ? "Min." : /^des/.test(ft) ? (/federal/.test(ft) ? "Des. Federal" : "Des.") : /^ju/.test(ft) ? (female ? "Juíza" : "Juiz") + (/federal/.test(ft) ? " Federal" : "") + (/convocad/.test(ft) ? (female ? " Convocada" : " Convocado") : "") : title ? titleCase(title) : undefined;
  const name = words.join(" ");
  return { rapporteur: /^[\p{Lu}\s'.-]+$/u.test(name) ? titleCase(name) : name, rapporteurTitle, female };
}

/** Datas de julgamento e de publicação ("j. 12/3/2024", "DJe de 15/3/2024", "PUBLIC 15-03-2024"). */
export function readDates(s: string): Pick<Ref, "judgedAt" | "publishedAt" | "source"> {
  const out: Pick<Ref, "judgedAt" | "publishedAt" | "source"> = {};
  const f = fold(s);
  const date = "(\\d{1,2}\\s*[/.-]\\s*\\d{1,2}\\s*[/.-]\\s*\\d{2,4}|\\d{1,2}o?\\s+de\\s+[a-z]+\\s+de\\s+\\d{4})";
  const judged = new RegExp(`(?:\\bj\\.|\\bjulgad[oa]\\s+em|\\bjulg\\.|data (?:do|de) julgamento\\s*:?|\\bjulgamento\\s*:|\\bj\\s+em)\\s*(?:em\\s+)?${date}`).exec(f);
  if (judged) out.judgedAt = findDates(judged[1])[0]?.iso;
  else {
    const br = new RegExp(`${date}\\s*\\(?data do julgamento`).exec(f);
    if (br) out.judgedAt = findDates(br[1])[0]?.iso;
  }
  const pub = new RegExp(`(?:\\b(djen|dje|dj|dou|rstj|rtj)\\b(?:-[\\w/]+)?\\s*(?:de\\s+)?|data (?:da|de) publicacao(?:/fonte)?\\s*:?\\s*(?:(djen|dje|dj)\\s*(?:de\\s+)?)?|publicad[oa] em\\s*|\\bpublic\\.?\\s+)${date}`).exec(f);
  if (pub) {
    out.publishedAt = findDates(pub[3])[0]?.iso;
    const src = pub[1] || pub[2];
    if (src) out.source = { djen: "DJEN", dje: "DJe", dj: "DJ", dou: "DOU", rstj: "RSTJ", rtj: "RTJ" }[src];
    else if (/public/.test(pub[0])) out.source = "DJe";
  }
  return out;
}

/** Órgão julgador escrito no trecho. */
export function readBody(s: string): string | undefined {
  const m = s.match(BODY_RE);
  return m ? normalizeBody(m[0]) : undefined;
}

function courtBefore(text: string, at: number): string | undefined {
  const before = text.slice(Math.max(0, at - 60), at);
  const cut = Math.max(before.lastIndexOf("\n"), before.lastIndexOf(";"), before.lastIndexOf(". "));
  const seg = cut >= 0 ? before.slice(cut + 1) : before;
  const all = [...seg.matchAll(new RegExp(COURT_SIGLA_RE.source, "g"))];
  if (all.length) return normalizeCourt(all[all.length - 1][1]);
  return courtFromName(seg);
}

// palavras que continuam a citação depois de um ponto (formato da ABNT e do STF)
const CONTINUES = /^(rel|min|des|julg|dj|di[aá]rio|data|recorr|agrav|apel|embarg|impetr|[óo]rg[ãa]o|turma|primeira|segunda|terceira|quarta|quinta|sexta|corte|se[çc][ãa]o|pleno|plen[áa]rio|bras[íi]lia|public|divulg|processo eletr)/i;
const ABBREVIATIONS = /\b(rel|min|des|j|n|ag|dr|dra|sr|sra|exmo|exma|art|arts|inc|al|fls|fl|p|pag|v|cf|julg|pub|ministr[oa]|desemb|public|proc|adv|s\.a|s\/a)$/i;

/** Até onde vai a citação: fecha parênteses, fim da frase, próxima citação ou 320 caracteres. */
function refEnd(text: string, from: number, limit: number): number {
  let depth = 0;
  // estava dentro de parênteses?
  const open = text.lastIndexOf("(", from);
  const close = text.lastIndexOf(")", from);
  if (open > close && from - open < 80) depth = 1;
  const max = Math.min(limit, from + 320);
  for (let i = from; i < max; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth <= 1) return i;
      depth--;
    } else if (ch === "\n" && text[i + 1] === "\n") return i;
    else if (ch === "\n" && depth === 0 && /^\s*["“]/.test(text.slice(i + 1, i + 4))) return i;
    else if (ch === "." && depth === 0 && /^\s+[A-ZÀ-Ú"“]/.test(text.slice(i + 1, i + 4))) {
      // ponto final (não de abreviatura nem de data)
      const word = text.slice(Math.max(from, i - 12), i).split(/\s/).pop() || "";
      const next = text.slice(i + 1, i + 30).trim();
      if (!ABBREVIATIONS.test(word) && !CONTINUES.test(next)) return i;
    }
  }
  return max;
}

function fill(ref: Ref, windowText: string) {
  const rap = readRapporteur(windowText);
  if (rap) Object.assign(ref, rap);
  Object.assign(ref, readDates(windowText));
  const body = readBody(windowText);
  if (body) ref.body = body;
}

/** Todas as citações de jurisprudência do texto, na ordem. */
export function extractRefs(text: string): Ref[] {
  const anchors: { start: number; end: number; make: () => Ref }[] = [];

  for (const m of text.matchAll(SUPERIOR_RE)) {
    const base = m[2];
    const start = m.index!;
    const strong = STRONG.includes(base) || !!m[1];
    const ctx = text.slice(Math.max(0, start - 80), start + m[0].length + 220);
    const sigla = courtBefore(text, start);
    if (!strong && !sigla && !CUE_RE.test(ctx)) continue;
    const prefix = squash(m[1]);
    const suffix = squash(m[6] || "");
    anchors.push({
      start,
      end: start + m[0].length,
      make: () => ({
        kind: "acordao",
        start,
        end: start + m[0].length,
        raw: "",
        court: sigla,
        className: `${prefix ? prefix + " " : ""}${base}${suffix ? " " + suffix : ""}`,
        baseClass: base,
        number: m[3],
        digits: digitsOf(m[3]),
        uf: m[4] || m[5],
      }),
    });
  }

  for (const m of text.matchAll(CNJ_RE)) {
    const start = m.index!;
    const c = parseCnj(m[0]);
    if (!c) continue;
    const before = text.slice(Math.max(0, start - 60), start);
    const local = before.match(LOCAL_CLASS_BEFORE);
    const sigla = courtBefore(text, start);
    const after = text.slice(start, start + 260);
    const ownCase = /(processo|autos|feito)\s*(n[º°o.]*|:)?\s*$/i.test(before) && !local;
    if (ownCase || (!local && !sigla && !CUE_RE.test(after))) continue;
    const norm = local ? normalizeClass(local[1]) : null;
    anchors.push({
      start: local ? start - local[0].length + (local[0].length - local[0].trimStart().length) : start,
      end: start + m[0].length,
      make: () => ({
        kind: "acordao",
        start,
        end: start + m[0].length,
        raw: "",
        court: sigla,
        className: norm?.className,
        baseClass: norm?.base,
        number: `${c.seq}-${c.dv}.${c.year}.${c.j}.${c.tr}.${c.origin}`,
        digits: digitsOf(m[0]),
      }),
    });
  }

  for (const m of text.matchAll(SUMULA_RE)) {
    const start = m.index!;
    const sv = !!m[2] || !!m[5];
    let court = m[4] ? normalizeCourt(courtFromName(m[4]) || m[4]) : sv ? "STF" : undefined;
    if (!court) {
      const near = text.slice(start, start + 80).match(COURT_SIGLA_RE) || text.slice(Math.max(0, start - 40), start).match(COURT_SIGLA_RE);
      if (near) court = normalizeCourt(near[1]);
    }
    const number = m[3] || m[5];
    anchors.push({
      start,
      end: start + m[0].length,
      make: () => ({ kind: "sumula", start, end: start + m[0].length, raw: m[0], court, className: sv ? "Súmula Vinculante" : "Súmula", number, digits: number, vinculante: sv }),
    });
  }

  for (const m of text.matchAll(TEMA_RE)) {
    const start = m.index!;
    let court: string | undefined = m[2]?.toUpperCase();
    if (!court) {
      const f = fold(text.slice(Math.max(0, start - 60), start + 80));
      court = /repercussao geral|\bstf\b|supremo/.test(f) ? "STF" : /repetitiv|\bstj\b|superior tribunal de justica/.test(f) ? "STJ" : undefined;
    }
    anchors.push({
      start,
      end: start + m[0].length,
      make: () => ({ kind: "tema", start, end: start + m[0].length, raw: m[0], court, className: "Tema", number: m[1], digits: digitsOf(m[1]) }),
    });
  }

  anchors.sort((a, b) => a.start - b.start);
  const out: Ref[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const ref = a.make();
    const prev = out[out.length - 1];
    // o mesmo número escrito duas vezes (ex.: "AC: 10012345620238260100 SP 1001234-56.2023.8.26.0100")
    if (prev && prev.digits && prev.digits === ref.digits && ref.start - prev.end < 80) {
      prev.end = Math.max(prev.end, ref.end);
      continue;
    }
    if (ref.kind === "acordao") {
      const next = anchors[i + 1]?.start ?? text.length;
      const end = refEnd(text, a.end, next);
      const windowText = text.slice(a.end, end);
      fill(ref, windowText);
      ref.end = end;
      ref.start = Math.min(ref.start, a.start);
      const lead = text.slice(Math.max(0, a.start - 60), a.start);
      const sig = lead.match(/(?:\b(STF|STJ|TST|TSE|STM|TNU|TJDFT|TJ-?[A-Z]{2}|TRF-?\s?\d|TRT-?\s?\d{1,2})\b)[\s,:-]*(?:(?:no|na|do|da)\s+)?[^\n;.]{0,12}$/);
      if (sig) ref.start = a.start - (lead.length - lead.lastIndexOf(sig[0]));
      ref.raw = squash(text.slice(ref.start, ref.end));
    }
    if (!ref.court) {
      const fromNumber = ref.number && parseCnj(ref.number) ? courtOfCnj(parseCnj(ref.number)!) : undefined;
      const fromClass = ref.baseClass ? CLASS_COURT[ref.baseClass] : undefined;
      if (fromNumber || fromClass) {
        ref.court = fromNumber || fromClass;
        ref.courtInferred = true;
      }
    }
    out.push(ref);
  }
  return out;
}

/**
 * Trecho entre aspas mais próximo da citação (antes ou logo depois), com pelo menos 60 caracteres.
 * min e max limitam a busca às vizinhas: um trecho que está do outro lado de outra citação é dela.
 */
export function nearbyQuote(text: string, ref: Ref, min = 0, max = text.length): { text: string; start: number; end: number } | undefined {
  const quotes: { text: string; start: number; end: number }[] = [];
  const re = /[“"]([^”"]{60,6000})[”"]/g;
  const from = Math.max(0, ref.start - 6000);
  const to = Math.min(text.length, ref.end + 1500);
  for (const m of text.slice(from, to).matchAll(re)) {
    const start = from + m.index!;
    quotes.push({ text: m[1], start, end: start + m[0].length });
  }
  let best: { q: (typeof quotes)[number]; dist: number } | undefined;
  for (const q of quotes) {
    if (q.start >= ref.start && q.end <= ref.end) continue;
    if ((q.end <= ref.start && q.start < min) || (q.start >= ref.end && q.end > max)) continue;
    const dist = q.end <= ref.start ? ref.start - q.end : q.start >= ref.end ? q.start - ref.end : 0;
    // logo antes (até 400 caracteres) ou logo depois (até 300)
    const ok = q.end <= ref.start ? dist <= 400 : dist <= 300;
    if (ok && (!best || dist < best.dist)) best = { q, dist };
  }
  return best?.q;
}
