import { PDFDict, PDFDocument, PDFName, PDFNumber, type PDFRef, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { CaseFileInfo } from "../src/domain/casefile";
import { pageMap, pagesToCut, remapRange, representationOf } from "../src/domain/representation";
import type { DocType, FileMeta } from "../src/domain/types";
import * as A from "../src/store/actions";
import { extractPdf } from "../src/store/extract";
import { cutPdf, MAX_CUT_BYTES, PdfCutError } from "../src/store/pdfcut";
import { MemoryPersistence } from "../src/store/persistence";
import { AppStore } from "../src/store/store";

// Documentos e PDFs fictícios.

let seq = 0;
const ctx = (): A.Ctx => ({ now: "2026-10-31T12:00:00.000Z", today: "2026-10-31", id: (p = "") => `${p}${++seq}` });

function exec<T, Args extends unknown[]>(store: AppStore, action: (ds: never, c: A.Ctx, ...a: Args) => A.Result<T>, ...args: Args): T {
  const { ops, value } = (action as unknown as (ds: unknown, c: A.Ctx, ...a: Args) => A.Result<T>)(store.getSnapshot(), ctx(), ...args);
  store.commit(ops);
  return value;
}

const kind = (title: string, type: DocType, extra: { courtId?: string; label?: string } = {}) => representationOf({ title, type, ...extra });

describe("documentos de representação", () => {
  it("reconhece substabelecimento, preposição e atos constitutivos, sem tocar no que importa", () => {
    expect(kind("Substabelecimento", "procuracao")).toBe("representacao");
    expect(kind("Carta de Preposição", "outro")).toBe("representacao");
    expect(kind("CONTRATO SOCIAL - EMPRESA EXEMPLO LTDA", "contrato")).toBe("representacao");
    expect(kind("Estatuto Social", "outro")).toBe("representacao");
    expect(kind("Ata da Assembleia Geral Ordinária", "ata")).toBe("representacao");
    expect(kind("Certidão Simplificada da Junta Comercial", "certidao")).toBe("representacao");
    expect(kind("Documento de identificação do preposto", "pessoal")).toBe("representacao");
    expect(kind("Comprovante de Inscrição e de Situação Cadastral", "comprovante")).toBe("representacao");
    // código do eproc e tipo dado pelo PJe
    expect(kind("Contrato (CONTRSOCIAL1)", "contrato", { courtId: "Evento 12, CONTRSOCIAL1" })).toBe("representacao");
    expect(kind("Substabelecimento (SUBST1)", "procuracao", { courtId: "Evento 15, SUBST1" })).toBe("representacao");
    expect(kind("Doc 01", "outro", { label: "Atos Constitutivos" })).toBe("representacao");
    // procurações: categoria à parte
    expect(kind("Procuração (PROC2)", "procuracao", { courtId: "Evento 1, PROC2" })).toBe("procuracao");
    expect(kind("Instrumento de mandato", "outro")).toBe("procuracao");
    // o que fica sempre
    expect(kind("Contrato de empréstimo consignado", "contrato")).toBeUndefined();
    expect(kind("Contestação e carta de preposição", "contestacao")).toBeUndefined();
    expect(kind("Ata de audiência de conciliação", "ata")).toBeUndefined();
    expect(kind("Certidão de intimação", "certidao")).toBeUndefined();
    expect(kind("RG e CPF da autora", "pessoal")).toBeUndefined();
    expect(kind("Mandado de citação", "mandado")).toBeUndefined();
  });

  it("calcula as páginas que saem e a nova numeração", () => {
    // documentos nas páginas 1-2 (fica), 3-4 (sai), 4-5 (fica: divide a página 4), 6 (sai)
    const cut = pagesToCut(7, [[3, 4], [6, 6]], [[1, 2], [4, 5]]);
    expect([...cut].sort()).toEqual([3, 6]);
    const map = pageMap(7, cut);
    expect(map).toEqual([0, 1, 2, 0, 3, 4, 0, 5]);
    expect(remapRange([4, 5], map)).toEqual([3, 4]);
    expect(remapRange([7, 7], map)).toEqual([5, 5]);
    expect(remapRange([3, 3], map)).toBeUndefined();
  });
});

async function makePdf(n: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) pdf.addPage([300, 300]).drawText(`Pagina numero ${i}`, { x: 40, y: 150, size: 14, font });
  return pdf.save();
}

describe("corte do PDF", () => {
  it("refaz o PDF só com as páginas que ficam, na ordem", async () => {
    const original = await makePdf(5);
    const map = pageMap(5, new Set([2, 4]));
    const cut = await cutPdf(new Blob([original as BlobPart]), map);
    const out = await extractPdf(new Uint8Array(await cut.arrayBuffer()), (await import("pdfjs-dist/legacy/build/pdf.mjs")) as never);
    expect(out.pages.map((p) => p.trim())).toEqual(["Pagina numero 1", "Pagina numero 3", "Pagina numero 5"]);
  });

  it("não tenta refazer no navegador um PDF grande demais", async () => {
    // só o tamanho importa aqui: não precisa alocar 400 MB no teste
    const huge = { size: MAX_CUT_BYTES + 1 } as Blob;
    await expect(cutPdf(huge, pageMap(2, new Set([1])))).rejects.toThrow(/mais de 400 MB/);
  });

  it("corta em árvores de páginas aninhadas e tira o que só as páginas cortadas usavam", async () => {
    // 7 páginas em dois grupos (1-4 e 5-7); a página 1 tem um link para a 2; a 2 tem uma imagem só dela; a 3 e a 6
    // usam a mesma imagem
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ctx = doc.context;
    const image = (kb: number) => ctx.register(ctx.stream(new Uint8Array(kb * 1024).fill(7), { Type: "XObject", Subtype: "Image", Width: 10, Height: 10, ColorSpace: "DeviceGray", BitsPerComponent: 8 }));
    const shared = image(150);
    const only2 = image(300);
    for (let i = 1; i <= 7; i++) {
      const page = doc.addPage([300, 300]);
      page.drawText(`Pagina numero ${i}`, { x: 40, y: 150, size: 14, font });
      if (i === 2) page.node.setXObject(PDFName.of("Im2"), only2);
      if (i === 3 || i === 6) page.node.setXObject(PDFName.of("Sh"), shared);
    }
    const [p1, p2] = doc.getPages();
    p1.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], Dest: [p2.ref, "Fit"] }))]));
    const root = doc.catalog.Pages();
    const rootRef = doc.catalog.get(PDFName.of("Pages")) as PDFRef;
    const refs = root.Kids().asArray() as PDFRef[];
    const group = (list: PDFRef[]) => {
      const ref = ctx.register(ctx.obj({ Type: "Pages", Kids: list, Count: list.length, Parent: rootRef }));
      for (const r of list) ctx.lookup(r, PDFDict).set(PDFName.of("Parent"), ref);
      return ref;
    };
    root.set(PDFName.of("Kids"), ctx.obj([group(refs.slice(0, 4)), group(refs.slice(4))]));
    const original = await doc.save();
    expect(original.byteLength).toBeGreaterThan(450 * 1024);

    // saem a 2 (com a imagem só dela) e todo o segundo grupo
    const cut = await cutPdf(new Blob([original as BlobPart]), pageMap(7, new Set([2, 5, 6, 7])));
    // o pdf.js fica com os bytes que recebe: cada leitura usa uma cópia
    const out = await extractPdf(new Uint8Array(await cut.arrayBuffer()), (await import("pdfjs-dist/legacy/build/pdf.mjs")) as never);
    expect(out.pages.map((p) => p.trim())).toEqual(["Pagina numero 1", "Pagina numero 3", "Pagina numero 4"]);
    // a imagem da página cortada saiu, mesmo com o link da página 1 apontando para ela; a compartilhada ficou
    expect(cut.size).toBeGreaterThan(150 * 1024);
    expect(cut.size).toBeLessThan(200 * 1024);
    // o grupo que ficou vazio saiu da árvore, e o PDF abre de novo sem erro
    const again = await PDFDocument.load(new Uint8Array(await cut.arrayBuffer()));
    expect(again.getPageCount()).toBe(3);
    expect(again.catalog.Pages().Kids().size()).toBe(1);
  });

  it("não corta uma página que aparece de novo no PDF", async () => {
    const doc = await PDFDocument.load(await makePdf(2));
    const root = doc.catalog.Pages();
    const [first] = root.Kids().asArray() as PDFRef[];
    root.Kids().push(first);
    root.set(PDFName.of("Count"), PDFNumber.of(3));
    const twice = await doc.save();
    const cut = await cutPdf(new Blob([twice as BlobPart]), pageMap(3, new Set([1, 2])));
    const out = await extractPdf(new Uint8Array(await cut.arrayBuffer()), (await import("pdfjs-dist/legacy/build/pdf.mjs")) as never);
    expect(out.pages.map((p) => p.trim())).toEqual(["Pagina numero 1"]);
  });

  it("recusa quando o PDF não é o que foi lido", async () => {
    await expect(cutPdf(new Blob([(await makePdf(3)) as BlobPart]), pageMap(5, new Set([2])))).rejects.toBeInstanceOf(PdfCutError);
    await expect(cutPdf(new Blob([new Uint8Array([1, 2, 3])]), pageMap(2, new Set([1])))).rejects.toThrow(/não pôde ser aberto/);
  });
});

const fileMeta = (id: string, pageCount: number): FileMeta => ({ id, name: `${id}.pdf`, mime: "application/pdf", size: 10, pageCount, createdAt: "2026-10-31" });

const info = (docs: CaseFileInfo["docs"]): CaseFileInfo => ({ system: "PJe", number: "0801234-56.2026.8.19.0001", parties: [], docs });

describe("cortar documentos na base", () => {
  it("na nova importação, o documento deixado de fora sai da base", async () => {
    const store = new AppStore(new MemoryPersistence());
    await store.load();
    const docs: CaseFileInfo["docs"] = [
      { courtId: "101", title: "Petição inicial", type: "inicial", pages: [1, 2] },
      { courtId: "102", title: "Substabelecimento", type: "procuracao", pages: [3, 3] },
      { courtId: "103", title: "Contestação", type: "contestacao", pages: [4, 5] },
    ];
    const first = exec(store, A.importCaseFile, { file: fileMeta("f1", 5), info: info(docs), create: { number: "0801234-56.2026.8.19.0001", rite: "civel", status: "ativo", parties: [] } });
    expect(first).toMatchObject({ added: 3, dropped: 0 });
    // a cliente pediu para tirar o substabelecimento: o PDF novo veio cortado (4 páginas)
    const kept = [docs[0], { ...docs[2], pages: [3, 4] as [number, number] }];
    const second = exec(store, A.importCaseFile, { file: fileMeta("f2", 4), info: info(kept), caseId: first.caseId, drop: [docs[1]] });
    expect(second).toMatchObject({ added: 0, updated: 2, dropped: 1 });
    const ds = store.getSnapshot()!;
    const titles = Object.values(ds.docs).filter((d) => d.type !== "processo").map((d) => [d.title, d.fileId, d.pages]);
    expect(titles).toEqual([
      ["Petição inicial", "f2", [1, 2]],
      ["Contestação", "f2", [3, 4]],
    ]);
    // o arquivo antigo, sem documentos, saiu
    expect(Object.keys(ds.files)).toEqual(["f2"]);
  });

  it("corta documentos de um processo já guardado e renumera as páginas dos outros", async () => {
    const store = new AppStore(new MemoryPersistence());
    await store.load();
    const docs: CaseFileInfo["docs"] = [
      { courtId: "201", title: "Petição inicial", type: "inicial", pages: [1, 2] },
      { courtId: "202", title: "Carta de Preposição", type: "outro", pages: [3, 3] },
      { courtId: "203", title: "Contrato Social", type: "contrato", pages: [4, 6] },
      { courtId: "204", title: "Contestação", type: "contestacao", pages: [7, 8] },
    ];
    const { caseId } = exec(store, A.importCaseFile, { file: fileMeta("f1", 8), info: info(docs), create: { number: "0801234-56.2026.8.19.0001", rite: "civel", status: "ativo", parties: [] } });
    const ds = store.getSnapshot()!;
    const byTitle = (t: string) => Object.values(store.getSnapshot()!.docs).find((d) => d.title === t)!;
    // um expediente ligado à carta de preposição perde a ligação, e não o expediente
    exec(store, A.saveNotice, { caseId, kind: "intimacao", channel: "djen", recipients: [], sentAt: "2026-10-20", counting: "uteis", docId: byTitle("Carta de Preposição").id });
    const remove = [byTitle("Carta de Preposição").id, byTitle("Contrato Social").id];
    const map = pageMap(8, pagesToCut(8, [[3, 3], [4, 6]], [[1, 2], [7, 8]]));
    const n = exec(store, A.cutDocs, { fileId: "f1", remove, file: fileMeta("f9", 4), map });
    expect(n).toBe(2);
    const after = store.getSnapshot()!;
    expect(Object.keys(after.files)).toEqual(["f9"]);
    expect(Object.values(after.docs).map((d) => [d.title, d.fileId, d.pages])).toEqual([
      [Object.values(ds.docs).find((d) => d.type === "processo")!.title, "f9", undefined],
      ["Petição inicial", "f9", [1, 2]],
      ["Contestação", "f9", [3, 4]],
    ]);
    expect(Object.values(after.notices)[0].docId).toBeUndefined();
  });
});
