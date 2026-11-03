import { extractBytes, extractPdf, kindOf, type Extracted, type PdfJs } from "./extract";
export { sha256 } from "./filehash";

// Leitura de arquivos no navegador: o pdf.js (e o worker dele) só é baixado quando aparece o primeiro PDF.

let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ||= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")])
    .then(([pdfjs, worker]) => {
      // o módulo não veio (a página está sendo recarregada para pegar a versão nova)
      if (!pdfjs?.getDocument || !worker?.default) throw new Error("Failed to fetch dynamically imported module (leitor de PDF)");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs as unknown as PdfJs;
    })
    .catch((e) => {
      // falhou (sem internet, versão nova publicada): a próxima tentativa baixa de novo
      pdfjsPromise = null;
      throw e;
    });
  return pdfjsPromise;
}

export async function readFileText(file: File, onProgress?: (done: number, total: number) => void): Promise<Extracted> {
  if (kindOf(file.name, file.type) === "pdf") return extractPdf(file, await loadPdfJs(), onProgress);
  const data = new Uint8Array(await file.arrayBuffer());
  return extractBytes(data, file.name, file.type, loadPdfJs, onProgress);
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
