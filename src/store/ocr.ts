import type { PdfJs } from "./extract";
import { openPdf } from "./pdfsource";

// Leitura do texto de páginas que são imagem (OCR), com o tesseract.js e o modelo do português. Os arquivos ficam no
// próprio site (public/ocr, copiados de node_modules pelo scripts/copy-ocr.mjs) e só são baixados quando a pessoa pede
// a leitura. Cada página é desenhada pelo pdf.js num canvas e reconhecida num worker; com vários núcleos no aparelho,
// mais de uma página é lida ao mesmo tempo.

const OCR_DIR = "ocr/v7/";

/** Quantas páginas são lidas ao mesmo tempo (cada leitura usa um núcleo e cerca de 100 MB de memória). */
export function ocrWorkers(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  const memory = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  // Um celular pode anunciar muitos núcleos, mas ter pouca memória para os modelos de OCR.
  if (memory !== undefined && memory <= 4) return 1;
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
  try {
    // "print": desenha sem esperar quadros da tela, então continua mesmo com a aba em segundo plano
    await page.render({ canvas, viewport, intent: "print", transform: top ? [1, 0, 0, 1, 0, -top] : undefined }).promise;
    return canvas;
  } catch (e) {
    canvas.width = canvas.height = 0;
    throw e;
  }
}

/** Desenha a página (ou só as margens de cima e de baixo, uma sobre a outra) e devolve a imagem (JPEG) para o OCR. */
async function renderPage(doc: RenderableDoc, n: number, width: number, margins: boolean): Promise<Blob> {
  const page = await doc.getPage(n);
  const canvases: HTMLCanvasElement[] = [];
  try {
    const base = page.getViewport({ scale: 1 });
    // PDFs com páginas de tamanho incomum também precisam caber no canvas do celular.
    const scale = Math.min(4, width / base.width, Math.sqrt(8_000_000 / (base.width * base.height)), 8192 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    let canvas: HTMLCanvasElement;
    if (!margins) canvas = await drawBand(page, viewport, 0, viewport.height);
    else {
      const top = Math.ceil(viewport.height * MARGIN_TOP);
      const bottom = Math.ceil(viewport.height * MARGIN_BOTTOM);
      const gap = 24;
      canvases.push(await drawBand(page, viewport, 0, top));
      canvases.push(await drawBand(page, viewport, viewport.height - bottom, bottom));
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
 * Lê as páginas indicadas (1 = primeira). Um Blob é aberto em blocos; se receber bytes, eles passam para o pdf.js
 * e não devem ser usados de novo. Cada worker mantém somente uma página em processamento.
 */
export async function ocrPdfPages(data: Uint8Array | Blob, pages: number[], loadPdf: () => Promise<PdfJs>, opts: OcrOptions = {}): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pages.length || opts.signal?.aborted) return out;
  type Worker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
  const workers: Worker[] = [];
  let task: ReturnType<typeof openPdf> | undefined;
  let ended = false;
  let interrupted = false;
  const waiting = new Set<(reason: unknown) => void>();
  const interrupt = () => {
    interrupted = true;
    for (const reject of waiting) reject(new DOMException("Leitura interrompida", "AbortError"));
    waiting.clear();
  };
  const wait = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    if (interrupted) reject(new DOMException("Leitura interrompida", "AbortError"));
    else waiting.add(reject);
    (task ? task.guard(promise) : promise).then((value) => {
      waiting.delete(reject);
      resolve(value);
    }, (error: unknown) => {
      waiting.delete(reject);
      reject(error);
    });
  });
  opts.signal?.addEventListener("abort", interrupt, { once: true });
  try {
    const [pdfjs, { createWorker }] = await wait(Promise.all([loadPdf(), import("tesseract.js")]));
    task = openPdf(data, pdfjs);
    const doc = (await wait(task.promise)) as unknown as RenderableDoc;
    const targets = [...new Set(pages)].filter((p) => Number.isInteger(p) && p >= 1 && p <= doc.numPages);
    if (!targets.length) return out;
    const base = new URL(OCR_DIR, document.baseURI).href;
    const n = Math.max(1, Math.min(opts.workers ?? ocrWorkers(), targets.length));
    await wait(Promise.all(Array.from({ length: n }, async () => {
      const worker = await createWorker("por", 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base, gzip: true, workerBlobURL: false });
      // createWorker não oferece cancelamento antes de devolver o worker: encerre também quem terminar depois.
      if (ended || opts.signal?.aborted) await worker.terminate().catch(() => {});
      else workers.push(worker);
    })));
    let next = 0;
    let done = 0;
    await Promise.all(workers.map(async (worker) => {
      while (!ended && !opts.signal?.aborted && next < targets.length) {
        const p = targets[next++];
        const image = await wait(renderPage(doc, p, opts.width ?? (opts.margins ? 2000 : 1700), !!opts.margins));
        if (ended || opts.signal?.aborted) return;
        // terminate() não resolve os jobs do tesseract: a corrida libera a espera ao interromper.
        const result = await wait(worker.recognize(image));
        if (ended || opts.signal?.aborted) return;
        const text = cleanOcrText(result.data.text || "");
        out.set(p, text);
        opts.onPage?.(p, text, ++done, targets.length);
      }
    }));
  } catch (e) {
    // Interrompido pela pessoa: fica o que já foi lido.
    if (!opts.signal?.aborted) throw e;
  } finally {
    ended = true;
    interrupt();
    opts.signal?.removeEventListener("abort", interrupt);
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => {})));
    await task?.destroy();
  }
  return out;
}
