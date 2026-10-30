import { fold } from "./text";

// Pesquisa na base de conhecimento: palavras (pelo começo), "frases exatas" e -exclusões,
// sem diferença entre maiúsculas e acentos. Pontua como TF-IDF e devolve trechos com os termos destacados.

export interface Query {
  terms: string[];
  phrases: string[];
  exclude: string[];
}

export function parseQuery(q: string): Query {
  const out: Query = { terms: [], phrases: [], exclude: [] };
  const re = /(-)?"([^"]+)"|(-)?(\S+)/g;
  for (const m of q.matchAll(re)) {
    if (m[2] !== undefined) {
      const w = fold(m[2]).trim();
      if (!w) continue;
      (m[1] ? out.exclude : w.includes(" ") ? out.phrases : out.terms).push(w);
    } else {
      const w = fold(m[4]).replace(/^[^\p{L}\p{N}§]+|[^\p{L}\p{N}]+$/gu, "");
      if (w.length < 2 && !/\d/.test(w)) continue;
      (m[3] ? out.exclude : out.terms).push(w);
    }
  }
  return out;
}

const CLASS: Record<string, string> = {
  a: "[aáàâãäåª]", e: "[eéèêë]", i: "[iíìîï]", o: "[oóòôõöº]", u: "[uúùûü]", c: "[cç]", n: "[nñ]",
};

function pattern(word: string): string {
  return [...word]
    .map((ch) => CLASS[ch] || (ch === " " ? "[\\s\\u00a0]+" : ch.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")))
    .join("");
}

export interface Matcher {
  /** Uma expressão por termo ou frase (a pontuação considera cada um). */
  parts: RegExp[];
  exclude: RegExp[];
  /** Todos os termos juntos, para destacar no texto. */
  any: RegExp;
  empty: boolean;
}

export function compile(q: Query | string): Matcher {
  const query = typeof q === "string" ? parseQuery(q) : q;
  const mk = (w: string, exact: boolean) => new RegExp(`(?<![\\p{L}\\p{N}])${pattern(w)}${exact ? "(?![\\p{L}\\p{N}])" : ""}`, "giu");
  const parts = [...query.terms.map((t) => mk(t, false)), ...query.phrases.map((p) => mk(p, true))];
  const all = [...query.terms.map((t) => pattern(t)), ...query.phrases.map((p) => pattern(p))];
  return {
    parts,
    exclude: query.exclude.map((t) => mk(t, t.includes(" "))),
    any: new RegExp(all.length ? `(?<![\\p{L}\\p{N}])(?:${all.join("|")})` : "(?!)", "giu"),
    empty: parts.length === 0,
  };
}

function count(re: RegExp, text: string): { n: number; first: number } {
  re.lastIndex = 0;
  let n = 0;
  let first = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (first < 0) first = m.index;
    n++;
    if (m[0].length === 0) re.lastIndex++;
    if (n > 500) break;
  }
  return { n, first };
}

export interface PageHit {
  page: number;
  count: number;
  first: number;
}

export interface DocHit {
  /** Ocorrências de cada termo (na ordem de Matcher.parts). */
  counts: number[];
  pages: PageHit[];
  titleHit: boolean;
}

/**
 * Procura os termos nas páginas de um documento. Todos os termos precisam aparecer (em qualquer página);
 * nenhum termo excluído pode aparecer. Devolve null se o documento não serve.
 */
export function searchDoc(pages: string[], m: Matcher, title = "", firstPage = 1): DocHit | null {
  if (m.empty) return null;
  const counts = m.parts.map(() => 0);
  const hits: PageHit[] = [];
  const titleHit = m.parts.some((re) => count(re, title).n > 0);
  pages.forEach((text, i) => {
    let total = 0;
    let first = -1;
    m.parts.forEach((re, k) => {
      const c = count(re, text);
      counts[k] += c.n;
      total += c.n;
      if (c.first >= 0 && (first < 0 || c.first < first)) first = c.first;
    });
    if (total) hits.push({ page: firstPage + i, count: total, first });
  });
  const titleCounts = m.parts.map((re) => count(re, title).n);
  if (counts.some((c, k) => c + titleCounts[k] === 0)) return null;
  if (m.exclude.some((re) => count(re, title).n || pages.some((p) => count(re, p).n))) return null;
  return { counts, pages: hits.sort((a, b) => b.count - a.count || a.page - b.page), titleHit };
}

/** Pontuação TF-IDF: termos raros no conjunto valem mais. */
export function scoreHits<T extends { hit: DocHit }>(results: T[], totalDocs: number): (T & { score: number })[] {
  const df = results.length ? results[0].hit.counts.map((_, k) => results.filter((r) => r.hit.counts[k] > 0).length) : [];
  return results
    .map((r) => {
      let score = 0;
      r.hit.counts.forEach((c, k) => {
        if (c > 0) score += (1 + Math.log(c)) * Math.log(1 + totalDocs / Math.max(1, df[k]));
      });
      if (r.hit.titleHit) score += 2;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);
}

export interface Segment {
  text: string;
  hit: boolean;
}

/** Divide o texto em trechos marcando os termos encontrados. */
export function highlight(text: string, m: Matcher): Segment[] {
  if (m.empty) return [{ text, hit: false }];
  const out: Segment[] = [];
  let last = 0;
  m.any.lastIndex = 0;
  for (let x = m.any.exec(text); x; x = m.any.exec(text)) {
    if (x[0].length === 0) {
      m.any.lastIndex++;
      continue;
    }
    // estende até o fim da palavra (busca pelo começo da palavra)
    let end = x.index + x[0].length;
    while (end < text.length && /[\p{L}\p{N}]/u.test(text[end])) end++;
    if (x.index > last) out.push({ text: text.slice(last, x.index), hit: false });
    out.push({ text: text.slice(x.index, end), hit: true });
    last = end;
    m.any.lastIndex = end;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

/** Trecho em volta da primeira ocorrência, com os termos destacados. */
export function snippet(text: string, m: Matcher, at: number, size = 220): Segment[] {
  const start = Math.max(0, at - Math.floor(size / 3));
  let a = start;
  if (a > 0) {
    const sp = text.indexOf(" ", a);
    if (sp > 0 && sp < at) a = sp + 1;
  }
  let b = Math.min(text.length, a + size);
  const sp = text.lastIndexOf(" ", b);
  if (b < text.length && sp > at) b = sp;
  const piece = text.slice(a, b).replace(/\s+/g, " ");
  const segs = highlight(piece, m);
  if (a > 0) segs.unshift({ text: "…", hit: false });
  if (b < text.length) segs.push({ text: "…", hit: false });
  return segs;
}
