// Corta páginas de um PDF com o pdf-lib, que só é carregado quando a pessoa pede o corte.

/** O PDF não pôde ser cortado (protegido por senha, corrompido ou diferente do que foi lido). */
export class PdfCutError extends Error {}

/**
 * Maior PDF refeito no navegador, no computador e no celular (testado: um PDF de 310 MB foi cortado em 4 s, com cerca
 * de 1,6 GB de memória). Acima disso, os documentos saem da lista, mas o arquivo fica inteiro.
 */
export const MAX_CUT_BYTES = 400 * 1024 * 1024;

/**
 * Novo PDF só com as páginas que ficam, na mesma ordem. `map` vem de pageMap: map[página antiga] = página nova,
 * ou 0 se foi cortada.
 */
export async function cutPdf(data: Uint8Array, map: number[]): Promise<Uint8Array> {
  if (data.byteLength > MAX_CUT_BYTES) throw new PdfCutError("o PDF tem mais de 400 MB, grande demais para ser refeito no navegador");
  const { PDFDocument } = await import("pdf-lib");
  let src: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    src = await PDFDocument.load(data, { updateMetadata: false });
  } catch (e) {
    throw new PdfCutError((e as Error)?.name === "EncryptedPDFError" || /encrypt/i.test(String(e)) ? "o PDF é protegido" : "o PDF não pôde ser aberto para o corte");
  }
  if (src.getPageCount() !== map.length - 1) throw new PdfCutError("o número de páginas do PDF não confere com o que foi lido");
  const keep: number[] = [];
  for (let p = 1; p < map.length; p++) if (map[p]) keep.push(p - 1);
  if (!keep.length) throw new PdfCutError("todas as páginas seriam cortadas");
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = await out.copyPages(src, keep);
  for (const page of pages) out.addPage(page);
  return out.save();
}
