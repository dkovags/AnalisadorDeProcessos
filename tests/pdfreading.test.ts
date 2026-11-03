import { PDFDocument, PDFName, PDFString, StandardFonts, drawObject, popGraphicsState, pushGraphicsState, scale } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { extractPdf, type PdfDoc, type PdfJs } from "../src/store/extract";
import { openPdf } from "../src/store/pdfsource";

class MockRange {
  requestDataRange(_begin: number, _end: number): void {}
  onDataRange = vi.fn();
  abort = vi.fn();
}

function mockDoc(page: Awaited<ReturnType<PdfDoc["getPage"]>>): PdfDoc {
  return {
    numPages: 1,
    getPage: async () => page,
    getOutline: async () => null,
    getDestination: async () => null,
    getPageIndex: async () => 0,
  };
}

describe("leitura de PDF por intervalos", () => {
  it("extrai texto de PDF com imagem grande mesmo quando o leitor precisa dos bytes da imagem", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const image = pdf.context.register(pdf.context.stream(new Uint8Array(4096 * 3072).fill(127), {
      Type: "XObject", Subtype: "Image", Width: 4096, Height: 3072, ColorSpace: "DeviceGray", BitsPerComponent: 8,
    }));
    const expected = ["Texto completo da primeira pagina", "Texto completo da segunda pagina"];
    for (const [i, text] of expected.entries()) {
      const page = pdf.addPage([600, 800]);
      page.drawText(text, { x: 40, y: 720, size: 14, font });
      if (!i) {
        page.node.setXObject(PDFName.of("Scan"), image);
        page.pushOperators(pushGraphicsState(), scale(300, 225), drawObject("Scan"), popGraphicsState());
      }
    }
    const bytes = await pdf.save({ useObjectStreams: false });
    const ranges: [number, number][] = [];
    class ImageFile extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> { throw new Error("Não carregar o PDF inteiro"); }
      override slice(start = 0, end = this.size, type?: string): Blob {
        ranges.push([start, end]);
        return super.slice(start, end, type);
      }
    }
    const file = new ImageFile([bytes as BlobPart], { type: "application/pdf" });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const result = await extractPdf(file, pdfjs as unknown as PdfJs);
    expect(result.pages).toEqual(expected);
    expect(result.empty).toEqual([]);
    expect(result.layout?.map((segments) => segments.map((segment) => segment.text).join(" "))).toEqual(expected);
    expect(ranges.length).toBeGreaterThan(1);
    // O pdf.js pode buscar os pixels para analisar o XObject, mesmo na extração
    // de texto. Isso não deve voltar a exigir file.arrayBuffer() na aplicação.
    expect(ranges.every(([start, end]) => end - start < file.size)).toBe(true);
  });

  it("lê texto e layout de todas as páginas sem carregar um anexo grande desnecessário", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // Anexo real de 12 MiB, sem compressão, dentro do PDF. Ler as páginas
    // não exige buscar seu conteúdo; o transporte deve preservar essa vantagem.
    const embedded = pdf.context.register(pdf.context.stream(new Uint8Array(12 * 1024 * 1024).fill(127), { Type: "EmbeddedFile" }));
    const spec = pdf.context.register(pdf.context.obj({ Type: "Filespec", F: PDFString.of("anexo.bin"), EF: { F: embedded } }));
    pdf.catalog.set(PDFName.of("Names"), pdf.context.obj({ EmbeddedFiles: { Names: [PDFString.of("anexo.bin"), spec] } }));
    const expected = Array.from({ length: 6 }, (_, i) => `Texto completo da pagina ${i + 1}`);
    for (const text of expected) {
      const page = pdf.addPage([600, 800]);
      page.drawText(text, { x: 40, y: 720, size: 14, font });
    }
    const bytes = await pdf.save({ useObjectStreams: false });
    const ranges: [number, number][] = [];
    class RangedFile extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        throw new Error("Não carregar o PDF inteiro");
      }
      override slice(start = 0, end = this.size, type?: string): Blob {
        ranges.push([start, end]);
        return super.slice(start, end, type);
      }
    }
    const file = new RangedFile([bytes as BlobPart], { type: "application/pdf" });
    const progress: [number, number][] = [];
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const result = await extractPdf(file, pdfjs as unknown as PdfJs, (done, total) => progress.push([done, total]));
    expect(result.pages).toEqual(expected);
    expect(result.empty).toEqual([]);
    expect(result.layout).toHaveLength(4);
    expect(result.layout?.map((segments) => segments.map((segment) => segment.text).join(" "))).toEqual(expected.slice(0, 4));
    expect(progress).toEqual(expected.map((_, i) => [i + 1, expected.length]));
    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges.reduce((sum, [start, end]) => sum + end - start, 0)).toBeLessThan(file.size / 2);
  });

  it("libera o leitor quando a abertura do documento falha", async () => {
    const failure = new Error("PDF corrompido");
    const destroy = vi.fn(async () => {});
    const pdfjs: PdfJs = {
      PDFDataRangeTransport: MockRange,
      getDocument: () => ({ promise: Promise.reject(failure), destroy }),
    };
    await expect(extractPdf(new Uint8Array([1]), pdfjs)).rejects.toBe(failure);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("libera a página e o leitor quando a extração do texto falha", async () => {
    const failure = new Error("Conteúdo ilegível");
    const cleanup = vi.fn();
    const destroy = vi.fn(async () => {});
    const doc = mockDoc({ getTextContent: async () => { throw failure; }, cleanup });
    const pdfjs: PdfJs = {
      PDFDataRangeTransport: MockRange,
      getDocument: () => ({ promise: Promise.resolve(doc), destroy }),
    };
    await expect(extractPdf(new Uint8Array([1]), pdfjs)).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("propaga falha de leitura após abrir o PDF sem esperar para sempre pelo texto", async () => {
    const failure = new Error("Arquivo deixou de estar disponível");
    class UnavailableFile extends Blob {
      override slice(): Blob {
        const chunk = new Blob(["x"]);
        chunk.arrayBuffer = async () => { throw failure; };
        return chunk;
      }
    }
    let range: InstanceType<PdfJs["PDFDataRangeTransport"]>;
    const cleanup = vi.fn();
    const destroy = vi.fn(async () => {});
    const doc = mockDoc({
      getTextContent: () => {
        range.requestDataRange(0, 1);
        return new Promise(() => {});
      },
      cleanup,
    });
    const pdfjs: PdfJs = {
      PDFDataRangeTransport: MockRange,
      getDocument: (source) => {
        range = source.range!;
        return { promise: Promise.resolve(doc), destroy };
      },
    };
    await expect(extractPdf(new UnavailableFile(["x"]), pdfjs)).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  }, 1000);

  it("recusa intervalos incompletos e encerra o leitor uma única vez", async () => {
    class TruncatedFile extends Blob {
      override slice(): Blob { return new Blob([]); }
    }
    let range: InstanceType<PdfJs["PDFDataRangeTransport"]>;
    const destroy = vi.fn(async () => {});
    const pdfjs: PdfJs = {
      PDFDataRangeTransport: MockRange,
      getDocument: (source) => {
        range = source.range!;
        return { promise: new Promise(() => {}), destroy };
      },
    };
    const task = openPdf(new TruncatedFile(["x"]), pdfjs);
    range!.requestDataRange(0, 1);
    await expect(task.promise).rejects.toThrow(/arquivo mudou/);
    await task.destroy();
    await task.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  }, 1000);
});
