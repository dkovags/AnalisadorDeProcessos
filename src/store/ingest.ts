import { extractBytes, type Extracted, type PdfJs } from "./extract";

// Leitura de arquivos no navegador: o pdf.js (e o worker dele) só é baixado quando aparece o primeiro PDF.

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ||= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as unknown as PdfJs;
  });
  return pdfjsPromise;
}

export async function readFileText(file: File, onProgress?: (done: number, total: number) => void): Promise<Extracted> {
  const data = new Uint8Array(await file.arrayBuffer());
  return extractBytes(data, file.name, file.type, loadPdfJs, onProgress);
}

/** SHA-256 do arquivo, para avisar quando ele já foi enviado. */
export async function sha256(file: Blob): Promise<string | undefined> {
  if (!crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pede ao navegador para não apagar os dados quando faltar espaço. */
export async function persistStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageInfo(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return { usage: est?.usage, quota: est?.quota, persisted };
  } catch {
    return {};
  }
}
