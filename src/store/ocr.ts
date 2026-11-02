import type { PdfJs } from "./extract";

// Leitura do texto de páginas que são imagem (OCR), com o tesseract.js e o modelo do português. Os arquivos ficam no
// próprio site (public/ocr, copiados de node_modules pelo scripts/copy-ocr.mjs) e só são baixados quando a pessoa pede
// a leitura. Cada página é desenhada pelo pdf.js num canvas e reconhecida num worker; com vários núcleos no aparelho,
// mais de uma página é lida ao mesmo tempo.

const OCR_DIR = "ocr/v7/";

/** Quantas páginas são lidas ao mesmo tempo (cada leitura usa um núcleo e cerca de 100 MB de memória). */
export function ocrWorkers(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return cores >= 8 ? 3 : cores >= 4 ? 2 : 1;
}

/** Segundos por página em cada núcleo usado (medido com páginas de petição digitalizadas a 300 dpi: 3 a 7 s inteiras, 0,5 s só as margens). */
const SECONDS_PER_PAGE = { full: 4.5, margins: 0.6 };

/** Estimativa do tempo de leitura, em minutos. */
export function ocrMinutes(pages: number, workers = ocrWorkers(), what: keyof typeof SECONDS_PER_PAGE = "full"): number {
  return Math.max(1, Math.round((pages * SECONDS_PER_PAGE[what]) / workers / 60));
}

export interface OcrOptions {
  /** A cada página lida: o número dela, o texto e quantas já foram. */
  onPage?: (page: number, text: string, done: number, total: number) => void;
  /** Para interromper: as páginas já lidas ficam no resultado. */
  signal?: AbortSignal;
  /** Largura da imagem de cada página, em pixels (1700 dá cerca de 200 dpi numa folha A4). */
  width?: number;
  workers?: number;
  /**
   * Só as margens de cima e de baixo de cada página, onde os sistemas dos tribunais põem o carimbo ("Num. 123 -
   * Pág. 1" no PJe, "Evento 1, INIC1, Página 1" no eproc): bem mais rápido, e basta para separar os documentos.
   */
  margins?: boolean;
}

/** Parte da altura da página lida em cada margem, no modo `margins` (em cima, cabe o cabeçalho com o número do processo). */
const MARGIN_TOP = 0.14;
const MARGIN_BOTTOM = 0.15;

interface Viewport {
  width: number;
  height: number;
}

interface RenderablePage {
  getViewport(o: { scale: number }): Viewport;
  render(o: { canvas: HTMLCanvasElement; viewport: Viewport; intent?: string; transform?: number[] }): { promise: Promise<void> };
  cleanup(): void;
}

interface RenderableDoc {
  numPages: number;
  getPage(n: number): Promise<RenderablePage>;
}

function whiteCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/** Desenha a faixa da página que começa na altura `top` (em pixels da imagem) e tem `height` de altura. */
async function drawBand(page: RenderablePage, viewport: Viewport, top: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = whiteCanvas(viewport.width, height);
  // "print": desenha sem esperar quadros da tela, então continua mesmo com a aba em segundo plano
  await page.render({ canvas, viewport, intent: "print", transform: top ? [1, 0, 0, 1, 0, -top] : undefined }).promise;
  return canvas;
}

/** Desenha a página (ou só as margens de cima e de baixo, uma sobre a outra) e devolve a imagem (JPEG) para o OCR. */
async function renderPage(doc: RenderableDoc, n: number, width: number, margins: boolean): Promise<Blob> {
  const page = await doc.getPage(n);
  const canvases: HTMLCanvasElement[] = [];
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, Math.max(1, width / base.width)) });
    let canvas: HTMLCanvasElement;
    if (!margins) canvas = await drawBand(page, viewport, 0, viewport.height);
    else {
      const top = Math.ceil(viewport.height * MARGIN_TOP);
      const bottom = Math.ceil(viewport.height * MARGIN_BOTTOM);
      const gap = 24;
      canvases.push(await drawBand(page, viewport, 0, top), await drawBand(page, viewport, viewport.height - bottom, bottom));
      canvas = whiteCanvas(viewport.width, top + gap + bottom);
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(canvases[0], 0, 0);
      ctx?.drawImage(canvases[1], 0, top + gap);
    }
    canvases.push(canvas);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error(`Não foi possível desenhar a página ${n}.`);
    return blob;
  } finally {
    for (const c of canvases) c.width = c.height = 0;
    page.cleanup();
  }
}

/** Arruma o texto reconhecido: sem espaços sobrando e sem linhas vazias repetidas. */
export function cleanOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Lê o texto das páginas indicadas (1 = primeira) de um PDF. Devolve o texto de cada página lida. Os bytes passam
 * para o pdf.js (sem cópia, porque o processo pode ter centenas de MB): quem chamou não deve usá-los depois.
 */
export async function ocrPdfPages(data: Uint8Array, pages: number[], loadPdf: () => Promise<PdfJs>, opts: OcrOptions = {}): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pages.length) return out;
  const pdfjs = await loadPdf();
  const task = pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 });
  const { createScheduler, createWorker } = await import("tesseract.js");
  const base = new URL(OCR_DIR, document.baseURI).href;
  const scheduler = createScheduler();
  const stop = () => void scheduler.terminate().catch(() => {});
  opts.signal?.addEventListener("abort", stop, { once: true });
  try {
    const doc = (await task.promise) as unknown as RenderableDoc;
    const n = Math.max(1, Math.min(opts.workers ?? ocrWorkers(), pages.length));
    const workers = await Promise.all(
      Array.from({ length: n }, () => createWorker("por", 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base, gzip: true, workerBlobURL: false })),
    );
    for (const w of workers) scheduler.addWorker(w);
    let done = 0;
    const pending: Promise<void>[] = [];
    for (const p of pages) {
      if (opts.signal?.aborted) break;
      if (p < 1 || p > doc.numPages) continue;
      const image = await renderPage(doc, p, opts.width ?? (opts.margins ? 2000 : 1700), !!opts.margins);
      pending.push(
        scheduler.addJob("recognize", image).then((r) => {
          const text = cleanOcrText(r.data.text || "");
          out.set(p, text);
          opts.onPage?.(p, text, ++done, pages.length);
        }),
      );
      // no máximo duas páginas esperando por leitor: a memória não cresce com o tamanho do processo
      while (pending.length >= n * 2) await pending.shift();
    }
    await Promise.all(pending);
  } catch (e) {
    // interrompido pela pessoa: fica o que já foi lido
    if (!opts.signal?.aborted) throw e;
  } finally {
    opts.signal?.removeEventListener("abort", stop);
    await scheduler.terminate().catch(() => {});
    await task.destroy();
  }
  return out;
}
