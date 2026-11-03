import type { PdfJs } from "./extract";

const RANGE_BYTES = 64 * 1024;

/** O PDF fica no Blob; só os intervalos solicitados pelo leitor passam para o worker. */
export function openPdf(source: Uint8Array | Blob, pdfjs: PdfJs) {
  let failed = false;
  let readError: unknown;
  const pending = new Set<(reason: unknown) => void>();
  const rejectRead = (reason: unknown) => {
    failed = true;
    readError = reason;
    for (const reject of pending) reject(reason);
    pending.clear();
  };
  // Remova a espera ao concluir cada página: uma promise de erro compartilhada
  // acumularia callbacks durante toda a leitura de um processo longo.
  const guard = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    if (failed) reject(readError);
    else pending.add(reject);
    operation.then((value) => {
      pending.delete(reject);
      resolve(value);
    }, (error: unknown) => {
      pending.delete(reject);
      reject(error);
    });
  });
  let stopped = false;
  let range: InstanceType<PdfJs["PDFDataRangeTransport"]> | undefined;
  if (source instanceof Blob) {
    range = new pdfjs.PDFDataRangeTransport(source.size, null, true);
    const transport = range;
    transport.abort = () => { stopped = true; };
    transport.requestDataRange = (begin, end) => {
      if (stopped) return;
      void source.slice(begin, end).arrayBuffer().then((buffer) => {
        if (stopped) return;
        if (buffer.byteLength !== end - begin) throw new Error("O arquivo mudou durante a leitura. Envie-o novamente.");
        transport.onDataRange(begin, new Uint8Array(buffer));
      }).catch((error: unknown) => {
        if (!stopped) {
          stopped = true;
          rejectRead(error);
        }
      });
    };
  }
  const task = pdfjs.getDocument({
    ...(range ? { range, rangeChunkSize: RANGE_BYTES, disableStream: true, disableAutoFetch: true } : { data: source as Uint8Array }),
    isEvalSupported: false,
    verbosity: 0,
  });
  let destroying: Promise<void> | undefined;
  return {
    promise: guard(task.promise),
    guard,
    destroy() {
      stopped = true;
      rejectRead(new DOMException("Leitura encerrada", "AbortError"));
      return destroying ||= task.destroy();
    },
  };
}
