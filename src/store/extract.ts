import { unzipSync, strFromU8 } from "fflate";

// Texto de arquivos: PDF (pdf.js), Word (.docx), LibreOffice (.odt), HTML e texto simples.
// Funciona no navegador e no Node (testes); o pdf.js é passado de fora, porque cada ambiente carrega o seu.

/** Marcador (índice) do PDF: título e página onde começa. */
export interface OutlineItem {
  title: string;
  page: number;
  /** Nível no índice (0 = primeiro nível). */
  depth: number;
  /** Não tem marcadores dentro dele. */
  leaf: boolean;
  /** Título do marcador de cima (ex.: "Evento 1" para o documento "INIC1"). */
  parent?: string;
}

/** Trecho de uma linha com a posição na página (em pontos, a partir do canto inferior esquerdo). */
export interface TextSegment {
  x: number;
  y: number;
  /** Largura. */
  w: number;
  text: string;
}

export interface Extracted {
  pages: string[];
  /** Páginas sem texto (imagem digitalizada). */
  empty: number[];
  kind: "pdf" | "docx" | "odt" | "html" | "text" | "image" | "other";
  /** Marcadores do PDF, quando o arquivo tem índice (o eproc e outros sistemas geram um por documento). */
  outline?: OutlineItem[];
  /**
   * Posição dos trechos de texto nas primeiras páginas (a capa), para ler tabelas em colunas, como as partes de cada
   * polo no eproc. Só serve na importação: não é guardado.
   */
  layout?: TextSegment[][];
}

/** Páginas do começo do PDF cuja posição dos textos é guardada em `layout`. */
const LAYOUT_PAGES = 4;

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
  s: string;
}

/** Pedaços de texto do pdf.js agrupados em linhas, de cima para baixo, cada linha da esquerda para a direita. */
function textLines(raw: unknown[]): { lines: { y: number; h: number; parts: Piece[] }[]; rotated: string[] } {
  const items = raw.filter((i): i is TextItemLike => typeof (i as TextItemLike).str === "string" && Array.isArray((i as TextItemLike).transform));
  const flat: Piece[] = [];
  const rotated: string[] = [];
  for (const it of items) {
    const [a, b, , d, e, f] = it.transform;
    if (!it.str) continue;
    // texto girado (carimbos na margem): vai para o fim da página, na ordem em que aparece
    if (Math.abs(b) > Math.abs(a) * 0.5) {
      rotated.push(it.str);
      continue;
    }
    flat.push({ x: e, y: f, w: it.width, h: Math.abs(d) || it.height || 10, s: it.str });
  }
  flat.sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: { y: number; h: number; parts: typeof flat }[] = [];
  for (const it of flat) {
    // em ordem de altura, cada pedaço só pode pertencer à última linha aberta
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - it.y) <= Math.max(2, Math.min(line.h, it.h) * 0.45)) line.parts.push(it);
    else lines.push({ y: it.y, h: it.h, parts: [it] });
  }
  lines.sort((p, q) => q.y - p.y);
  for (const line of lines) line.parts.sort((p, q) => p.x - q.x);
  return { lines, rotated };
}

/** Junta os pedaços de texto do pdf.js em linhas, na ordem de leitura (de cima para baixo, da esquerda para a direita). */
export function itemsToText(raw: unknown[]): string {
  const { lines, rotated } = textLines(raw);
  const out: string[] = [];
  for (const line of lines) {
    let s = "";
    let end = -Infinity;
    for (const p of line.parts) {
      const gap = p.x - end;
      if (s && gap > p.h * 0.18 && !/\s$/.test(s) && !/^\s/.test(p.s)) s += " ";
      s += p.s;
      end = p.x + p.w;
    }
    if (s.trim()) out.push(s.replace(/\s+$/, ""));
  }
  if (rotated.length) out.push(rotated.join(" "));
  // palavras partidas no fim da linha ("indeniza-\nção")
  return out.join("\n").replace(/([a-zà-ú])-\n([a-zà-ú])/g, "$1$2");
}

/** Trechos de cada linha com a posição: um vão largo entre dois pedaços (outra coluna da tabela) começa outro trecho. */
export function itemsToSegments(raw: unknown[]): TextSegment[] {
  const out: TextSegment[] = [];
  for (const line of textLines(raw).lines) {
    let cur: { x: number; end: number; s: string } | null = null;
    const flush = () => {
      if (cur && cur.s.trim()) out.push({ x: cur.x, y: line.y, w: cur.end - cur.x, text: cur.s.replace(/\s+/g, " ").trim() });
    };
    for (const p of line.parts) {
      // espaços em branco largos (o vão entre duas colunas) não juntam os trechos
      if (!p.s.trim()) continue;
      const gap = cur ? p.x - cur.end : Infinity;
      if (cur && gap <= Math.max(8, p.h * 1.2)) {
        if (gap > p.h * 0.18 && !/\s$/.test(cur.s) && !/^\s/.test(p.s)) cur.s += " ";
        cur.s += p.s;
        cur.end = Math.max(cur.end, p.x + p.w);
      } else {
        flush();
        cur = { x: p.x, end: p.x + p.w, s: p.s };
      }
    }
    flush();
  }
  return out;
}

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineNode[];
}

interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>;
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

export type PdfJs = {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; verbosity?: number }): {
    promise: Promise<PdfDoc>;
    destroy(): Promise<void>;
  };
};

/** Marcadores do PDF em lista, na ordem do índice, com a página de cada um. */
async function readOutline(doc: PdfDoc): Promise<OutlineItem[]> {
  const root = await doc.getOutline().catch(() => null);
  if (!root?.length) return [];
  const out: OutlineItem[] = [];
  const walk = async (nodes: OutlineNode[], depth: number, parent?: string) => {
    for (const n of nodes) {
      if (out.length >= 5000) return;
      let page: number | undefined;
      try {
        const dest = typeof n.dest === "string" ? await doc.getDestination(n.dest) : n.dest;
        const ref = Array.isArray(dest) ? dest[0] : undefined;
        // alguns geradores gravam o número da página; outros, a referência ao objeto da página
        if (typeof ref === "number") page = ref + 1;
        else if (ref) page = (await doc.getPageIndex(ref)) + 1;
      } catch {
        page = undefined;
      }
      const title = (n.title || "").replace(/\s+/g, " ").trim();
      const kids = depth < 4 ? n.items || [] : [];
      if (page && title) out.push({ title, page, depth, leaf: !kids.length, parent });
      if (kids.length) await walk(kids, depth + 1, title || parent);
    }
  };
  await walk(root, 0);
  return out;
}

export async function extractPdf(data: Uint8Array, pdfjs: PdfJs, onProgress?: (done: number, total: number) => void): Promise<Extracted> {
  // verbosity 0: só erros no console (avisos sobre fontes não importam para ler o texto)
  const task = pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  const empty: number[] = [];
  const layout: TextSegment[][] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const text = itemsToText(tc.items);
      if (n <= LAYOUT_PAGES) layout.push(itemsToSegments(tc.items));
      pages.push(text);
      if (text.replace(/\s/g, "").length < 15) empty.push(n);
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    const outline = await readOutline(doc);
    return { pages, empty, kind: "pdf", outline: outline.length ? outline : undefined, layout };
  } finally {
    await task.destroy();
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
  ordm: "º", ordf: "ª", sect: "§", deg: "°", para: "¶", middot: "·", bull: "•", hellip: "…", euro: "€", copy: "©", reg: "®",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "\u2013", mdash: "\u2014", szlig: "ß",
};

// letras acentuadas: &aacute; → á, &Atilde; → Ã, &ccedil; → ç
const MARKS: Record<string, string> = { acute: "́", grave: "̀", circ: "̂", tilde: "̃", uml: "̈", cedil: "̧" };

function namedEntity(e: string): string | undefined {
  const fixed = ENTITIES[e] ?? ENTITIES[e.toLowerCase()];
  if (fixed !== undefined) return fixed;
  const m = e.match(/^([a-z])(acute|grave|circ|tilde|uml|cedil)$/i);
  if (!m) return undefined;
  const ch = (m[1] + MARKS[m[2].toLowerCase()]).normalize("NFC");
  return ch.length === 1 ? ch : undefined;
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return namedEntity(e) ?? m;
  });
}

/** Divide um texto longo em "páginas" de até ~3.500 caracteres, sem quebrar parágrafos. */
export function paginate(text: string, size = 3500): string[] {
  const paras = text.replace(/\r\n?/g, "\n").split(/\n/);
  const pages: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length + p.length > size && cur) {
      pages.push(cur.trimEnd());
      cur = "";
    }
    cur += p + "\n";
  }
  if (cur.trim() || !pages.length) pages.push(cur.trimEnd());
  return pages;
}

/** Texto do Word (.docx): parágrafos do corpo do documento. */
export function docxText(data: Uint8Array): string {
  const files = unzipSync(data, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("Arquivo .docx sem o documento principal.");
  const body = strFromU8(xml);
  const paras: string[] = [];
  for (const m of body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const p = m[0]
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g, "\u0000$1\u0001")
      .replace(/<[^>]+>/g, "");
    const text = [...p.matchAll(/\u0000([^\u0001]*)\u0001|([\t\n])/g)].map((x) => x[1] ?? x[2]).join("");
    paras.push(decodeEntities(text));
  }
  return paras.join("\n");
}

/** Texto do LibreOffice (.odt). */
export function odtText(data: Uint8Array): string {
  const files = unzipSync(data, { filter: (f) => f.name === "content.xml" });
  const xml = files["content.xml"];
  if (!xml) throw new Error("Arquivo .odt sem conteúdo.");
  const body = strFromU8(xml);
  const paras: string[] = [];
  for (const m of body.matchAll(/<text:(p|h)[ >][\s\S]*?<\/text:\1>/g)) {
    const t = m[0]
      .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_x, n) => " ".repeat(Number(n) || 1))
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<[^>]+>/g, "");
    paras.push(decodeEntities(t));
  }
  return paras.join("\n");
}

/** Texto de uma página HTML (copiada de um site de tribunal, por exemplo). */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h\d|blockquote|section|article|table)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Decodifica texto em UTF-8 ou, se não for, em Windows-1252 (arquivos antigos do Windows). */
export function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("windows-1252").decode(data);
  }
}

export type FileKind = Extracted["kind"];

export function kindOf(name: string, mime: string): FileKind {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (ext === "odt" || mime.includes("opendocument.text")) return "odt";
  if (ext === "html" || ext === "htm" || mime === "text/html") return "html";
  if (["txt", "md", "csv", "rtf", "eml", "xml", "json"].includes(ext) || mime.startsWith("text/")) return "text";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "heic"].includes(ext)) return "image";
  return "other";
}

/** Extrai o texto de qualquer arquivo aceito. */
export async function extractBytes(data: Uint8Array, name: string, mime: string, loadPdf: () => Promise<PdfJs>, onProgress?: (done: number, total: number) => void): Promise<Extracted> {
  const kind = kindOf(name, mime);
  if (kind === "pdf") return extractPdf(data, await loadPdf(), onProgress);
  let text = "";
  if (kind === "docx") text = docxText(data);
  else if (kind === "odt") text = odtText(data);
  else if (kind === "html") text = htmlText(decodeText(data));
  else if (kind === "text") text = decodeText(data);
  else return { pages: [""], empty: [1], kind };
  const pages = paginate(text);
  return { pages, empty: pages.every((p) => !p.trim()) ? [1] : [], kind };
}
