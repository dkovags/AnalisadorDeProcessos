// Corta páginas de um PDF com o pdf-lib, que só é carregado quando a pessoa pede o corte.
//
// Para caber na memória do celular, nada é copiado: o PDF é aberto sobre os próprios bytes lidos (o conteúdo de cada
// imagem fica onde está), as páginas saem do próprio documento, e o PDF menor é montado em partes, em que as imagens
// e outros conteúdos grandes são pedaços do arquivo original, lidos do disco só na hora de guardar. A memória usada
// fica perto do tamanho do arquivo. O que só as páginas cortadas usavam (imagens, textos, fontes) sai do arquivo;
// ligações e marcadores que apontavam para elas deixam de levar a algum lugar.

import type { PDFDocument, PDFObject, PDFRef } from "pdf-lib";

/** O PDF não pôde ser cortado (protegido por senha, corrompido ou diferente do que foi lido). */
export class PdfCutError extends Error {}

/** Maior PDF refeito no navegador, no computador e no celular. Acima disso, os documentos saem da lista, mas o arquivo fica inteiro. */
export const MAX_CUT_BYTES = 400 * 1024 * 1024;

type PdfLib = typeof import("pdf-lib");

/**
 * Bytes do arquivo em que um pedaço é só uma janela sobre o original, sem cópia. O pdf-lib guarda o conteúdo de cada
 * objeto com slice(): assim, as imagens continuam nos bytes lidos em vez de ocupar a memória uma segunda vez.
 */
class SharedBytes extends Uint8Array<ArrayBuffer> {
  override slice(start?: number, end?: number): Uint8Array<ArrayBuffer> {
    return this.subarray(start, end);
  }
}

/** O arquivo e os bytes lidos dele, sobre os quais o PDF foi aberto. */
interface Source {
  file: Blob;
  buffer: ArrayBuffer;
}

async function open(lib: PdfLib, file: Blob): Promise<{ doc: PDFDocument; source: Source }> {
  try {
    const bytes = new SharedBytes(await file.arrayBuffer());
    return { doc: await lib.PDFDocument.load(bytes, { updateMetadata: false }), source: { file, buffer: bytes.buffer } };
  } catch (e) {
    throw new PdfCutError((e as Error)?.name === "EncryptedPDFError" || /encrypt/i.test(String(e)) ? "o PDF é protegido" : "o PDF não pôde ser aberto para o corte");
  }
}

/**
 * Tira do arquivo os objetos que nada do que ficou usa. A busca parte do catálogo e das informações do documento e não
 * entra nas páginas cortadas: o que só elas usavam sai, mesmo que um link ou marcador ainda aponte para elas.
 */
function dropUnused(lib: PdfLib, doc: PDFDocument, cut: Set<PDFRef>): void {
  const { PDFArray, PDFDict, PDFRef, PDFStream } = lib;
  const ctx = doc.context;
  const used = new Set<PDFRef>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter((o): o is PDFObject => !!o);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (used.has(o) || cut.has(o)) continue;
      used.add(o);
      const target = ctx.lookup(o);
      if (target) stack.push(target);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v);
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!used.has(ref)) ctx.delete(ref);
}

interface Serializable {
  sizeInBytes(): number;
  copyBytesInto(buffer: Uint8Array, offset: number): number;
}

/** O que o PDFWriter do pdf-lib calcula antes de escrever: a ordem dos objetos e a tabela com a posição de cada um. */
interface Layout {
  size: number;
  header: Serializable;
  indirectObjects: [PDFRef, PDFObject][];
  xref?: Serializable;
  trailerDict?: Serializable;
  trailer: Serializable;
}

const CHUNK = 1 << 20;

/** Conteúdo a partir deste tamanho entra no PDF novo como um pedaço do arquivo original; o menor é copiado. */
const SLICE_FROM = 64 * 1024;

/** Partes do PDF novo: o que é pequeno vai sendo juntado em blocos de 1 MB; o conteúdo grande entra como pedaço do arquivo. */
class Parts {
  readonly list: BlobPart[] = [];
  total = 0;
  private buf = new Uint8Array(CHUNK);
  private at = 0;

  private room(n: number): void {
    if (this.at + n <= this.buf.length) return;
    this.flush();
    this.buf = new Uint8Array(Math.max(CHUNK, n));
  }

  private flush(): void {
    if (this.at) this.list.push(this.buf.subarray(0, this.at));
    this.buf = this.buf.subarray(this.at);
    this.at = 0;
  }

  text(s: string): void {
    this.room(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.at++] = s.charCodeAt(i);
    this.total += s.length;
  }

  obj(o: Serializable): void {
    const n = o.sizeInBytes();
    this.room(n);
    if (o.copyBytesInto(this.buf, this.at) !== n) throw new Error("tamanho inesperado de um objeto do PDF");
    this.at += n;
    this.total += n;
  }

  copy(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.at);
    this.at += b.length;
    this.total += b.length;
  }

  piece(b: Blob): void {
    this.flush();
    this.list.push(b);
    this.total += b.size;
  }

  end(): BlobPart[] {
    this.flush();
    return this.list;
  }
}

/**
 * Escreve o PDF como o PDFWriter do pdf-lib (mesma ordem, mesma tabela de posições), mas em partes, sem juntar tudo
 * num bloco só: o conteúdo grande que veio do arquivo entra como um pedaço dele, sem passar pela memória.
 */
async function write(lib: PdfLib, doc: PDFDocument, source: Source): Promise<Blob> {
  const writer = lib.PDFWriter.forContext(doc.context, Infinity) as unknown as { computeBufferSize(): Promise<Layout> };
  const layout = await writer.computeBufferSize();
  const parts = new Parts();
  parts.obj(layout.header);
  parts.text("\n\n");
  for (const [ref, object] of layout.indirectObjects) {
    parts.text(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    if (object instanceof lib.PDFRawStream) {
      object.updateDict();
      parts.obj(object.dict);
      parts.text("\nstream\n");
      const c = object.getContents();
      if (c.byteLength >= SLICE_FROM && c.buffer === source.buffer) parts.piece(source.file.slice(c.byteOffset, c.byteOffset + c.byteLength));
      else parts.copy(c);
      parts.text("\nendstream");
    } else {
      parts.obj(object as unknown as Serializable);
    }
    parts.text("\nendobj\n\n");
  }
  if (layout.xref) {
    parts.obj(layout.xref);
    parts.text("\n");
  }
  if (layout.trailerDict) {
    parts.obj(layout.trailerDict);
    parts.text("\n\n");
  }
  parts.obj(layout.trailer);
  // as posições da tabela foram calculadas para este tamanho exato: se não bate, o arquivo sairia estragado
  if (parts.total !== layout.size) throw new Error(`PDF montado com ${parts.total} bytes, esperados ${layout.size}`);
  return new Blob(parts.end(), { type: "application/pdf" });
}

/**
 * Novo PDF só com as páginas que ficam, na mesma ordem. `map` vem de pageMap: map[página antiga] = página nova,
 * ou 0 se foi cortada. O resultado vem como Blob, pronto para ser guardado, e usa pedaços de `file`: ele precisa
 * continuar legível até o PDF novo ser guardado.
 */
export async function cutPdf(file: Blob, map: number[]): Promise<Blob> {
  if (file.size > MAX_CUT_BYTES) throw new PdfCutError("o PDF tem mais de 400 MB, grande demais para ser refeito no navegador");
  const lib = await import("pdf-lib");
  const { doc, source } = await open(lib, file);
  const pages = doc.getPages();
  if (pages.length !== map.length - 1) throw new PdfCutError("o número de páginas do PDF não confere com o que foi lido");
  const left = map.filter((n, p) => p > 0 && n > 0).length;
  if (!left) throw new PdfCutError("todas as páginas seriam cortadas");
  // uma mesma página pode aparecer duas vezes no PDF: só é cortada se não ficar em nenhum lugar
  const kept = new Set(pages.filter((_, i) => map[i + 1]).map((p) => p.ref));
  const cut = new Set(pages.filter((p, i) => !map[i + 1] && !kept.has(p.ref)).map((p) => p.ref));
  let count = 0;
  try {
    for (let i = pages.length - 1; i >= 0; i--) if (!map[i + 1]) doc.removePage(i);
    // a numeração das páginas (i, ii, 1, 2...) deixaria de bater com as páginas que ficaram
    doc.catalog.delete(lib.PDFName.of("PageLabels"));
    dropUnused(lib, doc, cut);
    doc.catalog.Pages().traverse((node) => void (node instanceof lib.PDFPageLeaf && count++));
  } catch {
    throw new PdfCutError("a estrutura de páginas do PDF não pôde ser refeita");
  }
  if (count !== left) throw new PdfCutError("a estrutura de páginas do PDF não pôde ser refeita");
  try {
    return await write(lib, doc, source);
  } catch (e) {
    console.error(e);
    throw new PdfCutError("o PDF menor não pôde ser montado");
  }
}
