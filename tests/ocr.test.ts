import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfJs } from "../src/store/extract";
import { ocrPdfPages, ocrWorkers } from "../src/store/ocr";

const mocks = vi.hoisted(() => ({ openPdf: vi.fn(), createWorker: vi.fn() }));
vi.mock("../src/store/pdfsource", () => ({ openPdf: mocks.openPdf }));
vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const result = (text: string) => ({ data: { text } });
const makeWorker = () => ({ recognize: vi.fn().mockResolvedValue(result("Texto reconhecido")), terminate: vi.fn().mockResolvedValue(undefined) });

function fixture() {
  const canvases: { width: number; height: number }[] = [];
  vi.stubGlobal("document", {
    baseURI: "http://localhost/",
    createElement: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
        toBlob: (cb: (blob: Blob) => void) => cb(new Blob(["imagem"])),
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  };
  const doc = { numPages: 12, getPage: vi.fn().mockResolvedValue(page) };
  const task = { promise: Promise.resolve(doc), guard: <T>(p: Promise<T>) => p, destroy: vi.fn().mockResolvedValue(undefined) };
  mocks.openPdf.mockReturnValue(task);
  const worker = makeWorker();
  mocks.createWorker.mockResolvedValue(worker);
  const loadPdf = vi.fn().mockResolvedValue({} as PdfJs);
  return { page, doc, task, worker, canvases, loadPdf };
}

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 }); });
afterEach(() => vi.unstubAllGlobals());

describe("OCR em arquivos grandes", () => {
  it("usa um worker em aparelhos com pouca memória mesmo com muitos núcleos", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 16, deviceMemory: 4 });
    expect(ocrWorkers()).toBe(1);
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
    expect(ocrWorkers()).toBe(3);
  });

  it("abre o Blob sem materializá-lo inteiro e libera os recursos ao concluir", async () => {
    const { task, worker, loadPdf, canvases } = fixture();
    const blob = new Blob(["arquivo PDF"]);
    vi.spyOn(blob, "arrayBuffer").mockRejectedValue(new Error("Não deve ler o arquivo inteiro"));
    const pages = await ocrPdfPages(blob, [1, 2], loadPdf, { workers: 1 });
    expect(pages).toEqual(new Map([[1, "Texto reconhecido"], [2, "Texto reconhecido"]]));
    expect(mocks.openPdf.mock.calls[0][0]).toBe(blob);
    expect(blob.arrayBuffer).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  it("interrompe um reconhecimento pendurado e preserva as páginas concluídas", async () => {
    const { worker, task, loadPdf } = fixture();
    const pending = deferred<ReturnType<typeof result>>();
    worker.recognize.mockResolvedValueOnce(result("Página um")).mockReturnValueOnce(pending.promise);
    const ctrl = new AbortController();
    const onPage = vi.fn();
    const reading = ocrPdfPages(new Blob(), [1, 2, 3], loadPdf, { workers: 1, signal: ctrl.signal, onPage });
    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledTimes(2));
    ctrl.abort();
    await expect(reading).resolves.toEqual(new Map([[1, "Página um"]]));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
    pending.resolve(result("Resultado tardio"));
    await Promise.resolve();
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it("não começa a leitura quando já foi cancelada", async () => {
    const { loadPdf } = fixture();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(ocrPdfPages(new Blob(), [1], loadPdf, { signal: ctrl.signal })).resolves.toEqual(new Map());
    expect(loadPdf).not.toHaveBeenCalled();
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });

  it("encerra workers que acabam de carregar depois da interrupção", async () => {
    const { task, loadPdf } = fixture();
    const worker = makeWorker();
    const loading = deferred<typeof worker>();
    mocks.createWorker.mockReturnValueOnce(loading.promise);
    const ctrl = new AbortController();
    const reading = ocrPdfPages(new Blob(), [1], loadPdf, { signal: ctrl.signal });
    await vi.waitFor(() => expect(mocks.createWorker).toHaveBeenCalledOnce());
    ctrl.abort();
    await expect(reading).resolves.toEqual(new Map());
    expect(task.destroy).toHaveBeenCalledOnce();
    loading.resolve(worker);
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
    expect(worker.recognize).not.toHaveBeenCalled();
  });

  it("libera o PDF e os workers prontos se outro worker falha ao carregar", async () => {
    const { task, loadPdf, worker } = fixture();
    mocks.createWorker.mockResolvedValueOnce(worker).mockRejectedValueOnce(new Error("modelo indisponível"));
    await expect(ocrPdfPages(new Blob(), [1, 2], loadPdf, { workers: 2 })).rejects.toThrow("modelo indisponível");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("libera as duas faixas da página se o desenho da segunda falhar", async () => {
    const { page, canvases, task, loadPdf } = fixture();
    page.render.mockImplementationOnce(() => ({ promise: Promise.resolve() })).mockImplementationOnce(() => ({ promise: Promise.reject(new Error("imagem inválida")) }));
    await expect(ocrPdfPages(new Blob(), [1], loadPdf, { margins: true })).rejects.toThrow("imagem inválida");
    expect(canvases).toHaveLength(2);
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("reduz páginas de dimensões incomuns antes de desenhá-las", async () => {
    const { page, loadPdf } = fixture();
    page.getViewport = ({ scale }) => ({ width: 20_000 * scale, height: 10_000 * scale });
    await ocrPdfPages(new Blob(), [1], loadPdf, { width: 1700 });
    const viewport = page.render.mock.calls[0][0].viewport;
    expect(viewport.width).toBeCloseTo(1700);
    expect(viewport.width * viewport.height).toBeLessThanOrEqual(8_000_000);
  });

  it("encerra a leitura e os workers se um bloco do arquivo falha durante o OCR", async () => {
    const { task, loadPdf, worker } = fixture();
    const failure = deferred<never>();
    task.guard = <T>(p: Promise<T>) => Promise.race([p, failure.promise]);
    worker.recognize.mockReturnValue(new Promise(() => {}));
    const reading = ocrPdfPages(new Blob(), [1, 2], loadPdf, { workers: 1 });
    const outcome = expect(reading).rejects.toThrow("arquivo removido");
    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledOnce());
    failure.reject(new Error("arquivo removido"));
    await outcome;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("mantém apenas uma página por worker em processamento", async () => {
    const { loadPdf, doc } = fixture();
    const ctrl = new AbortController();
    const workers = [makeWorker(), makeWorker()];
    for (const w of workers) w.recognize.mockReturnValue(new Promise(() => {}));
    mocks.createWorker.mockResolvedValueOnce(workers[0]).mockResolvedValueOnce(workers[1]);
    const reading = ocrPdfPages(new Blob(), [1, 2, 3, 4, 5, 6], loadPdf, { workers: 2, signal: ctrl.signal });
    await vi.waitFor(() => expect(workers[1].recognize).toHaveBeenCalledOnce());
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    ctrl.abort();
    await reading;
    for (const w of workers) expect(w.terminate).toHaveBeenCalledOnce();
  });
});
