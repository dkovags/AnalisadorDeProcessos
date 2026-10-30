import { validDate } from "./dates";

// Utilitários de texto em português: comparação sem acentos, números por extenso, datas e valores no texto.

const FOLD: Record<string, string> = {};
for (const [base, chars] of Object.entries({
  a: "áàâãäåª", e: "éèêë", i: "íìîï", o: "óòôõöº", u: "úùûü", c: "ç", n: "ñ", y: "ýÿ",
  "-": "–\u2014‐‑−", '"': "“”«»„", "'": "‘’´`", " ": "   \t",
}))
  for (const ch of chars) FOLD[ch] = base;

/**
 * Minúsculas sem acentos, com aspas e traços simplificados. O resultado tem o mesmo tamanho do original,
 * para que as posições encontradas no texto "dobrado" valham também no texto original.
 */
export function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    let c = ch.toLowerCase();
    if (c.length !== ch.length) c = ch;
    out += FOLD[c] ?? c;
  }
  return out;
}

/** Espaços repetidos viram um só; tira espaços das pontas. */
export function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const PARTICLES = new Set(["de", "da", "do", "das", "dos", "e", "em", "na", "no", "nas", "nos", "a", "o", "para", "por", "com", "à", "às", "ao", "aos"]);
const KEEP_UPPER = new Set(["S.A.", "S/A", "SA", "LTDA", "ME", "EPP", "EIRELI", "CNPJ", "CPF", "INSS", "OAB", "MP", "MPF", "DF", "TJ", "STJ", "STF", "TST", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII"]);

/** "MARIA DA SILVA" → "Maria da Silva" (mantém siglas como S.A. e LTDA). */
export function titleCase(s: string): string {
  return squash(s)
    .split(" ")
    .map((w, i) => {
      const up = w.toUpperCase();
      if (KEEP_UPPER.has(up.replace(/[,;:]$/, ""))) return up;
      const lower = w.toLowerCase();
      if (i > 0 && PARTICLES.has(lower)) return lower;
      return lower.replace(/(^|[-'(/])(\p{L})/gu, (_m, p: string, l: string) => p + l.toUpperCase());
    })
    .join(" ");
}

/** O texto está todo (ou quase todo) em maiúsculas? */
export function isUpper(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  return upper / letters.length > 0.85;
}

const UNITS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100,
};

/** "quinze" → 15, "quarenta e oito" → 48, "15" → 15. Recebe texto já sem acentos. */
export function numberFromWords(s: string): number | null {
  const t = fold(s).trim();
  if (/^\d+$/.test(t)) return Number(t);
  let total = 0;
  for (const w of t.split(/\s+e\s+|\s+/)) {
    if (!(w in UNITS)) return null;
    total += UNITS[w];
  }
  return total || null;
}

/** Expressão regular (sobre texto dobrado) de um número em algarismos ou por extenso. */
export const NUMBER_WORDS_RE =
  "(?:\\d{1,3}|(?:(?:vinte|trinta|quarenta|cinquenta|sessenta|noventa)(?: e (?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove))?)|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|cem)";

const MONTH_NUM: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10,
  novembro: 11, dezembro: 12, jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

export interface FoundDate {
  iso: string;
  index: number;
  length: number;
}

const DATE_RE =
  /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b|\b(\d{1,2})o?\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/g;

/** Todas as datas do texto (12/03/2024, 12.3.2024, 12-03-24, 12 de março de 2024), na ordem em que aparecem. */
export function findDates(text: string): FoundDate[] {
  const f = fold(text);
  const out: FoundDate[] = [];
  for (const m of f.matchAll(DATE_RE)) {
    const iso = m[1]
      ? validDate(Number(m[3]), Number(m[2]), Number(m[1]))
      : validDate(Number(m[6]), MONTH_NUM[m[5]], Number(m[4]));
    if (iso) out.push({ iso, index: m.index!, length: m[0].length });
  }
  return out;
}

/** Primeira data do texto, ou null. */
export function firstDate(text: string): string | null {
  return findDates(text)[0]?.iso ?? null;
}

/** "R$ 15.000,00" → 1500000 (centavos). */
export function parseMoney(s: string): number | null {
  const m = s.match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/);
  if (!m) return null;
  const int = Number(m[1].replace(/\./g, ""));
  const dec = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return int * 100 + dec;
}

/** 1500000 → "R$ 15.000,00" */
export function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const int = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}R$ ${int},${String(abs % 100).padStart(2, "0")}`;
}

const COMPANY_SUFFIXES = /\b(s\.?\s?\/?\s?a\.?|ltda\.?|me|epp|eireli|cia\.?|companhia|sociedade anonima|limitada)$/;

/** Nome reduzido para comparar partes: sem acentos, pontuação e sufixos como S.A. e LTDA. */
export function nameKey(name: string): string {
  let s = fold(name).replace(/[^a-z0-9/ .]/g, " ");
  s = squash(s);
  for (let i = 0; i < 3; i++) s = squash(s.replace(COMPANY_SUFFIXES, ""));
  return squash(s.replace(/[./]/g, " "));
}

/** Duas partes são a mesma pessoa? (mesmo nome, ou um contido no outro com pelo menos duas palavras) */
export function sameParty(a: string, b: string): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [short, long] = ka.length < kb.length ? [ka, kb] : [kb, ka];
  return short.split(" ").length >= 2 && short.length >= 8 && (` ${long} `).includes(` ${short} `);
}

/** Texto curto para listas: as primeiras palavras, terminando em reticências. */
export function excerpt(s: string, max = 160): string {
  const t = squash(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : max).replace(/[,;:.\s]+$/, "") + "…";
}

/** Escapa caracteres especiais de expressões regulares. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
