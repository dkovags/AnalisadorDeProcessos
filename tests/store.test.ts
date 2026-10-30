import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseCaseFile } from "../src/domain/casefile";
import { agendaToIcs, casesToCsv } from "../src/domain/exports";
import { agenda } from "../src/domain/select";
import type { FileMeta } from "../src/domain/types";
import * as A from "../src/store/actions";
import { makeBackup, readBackup } from "../src/store/backup";
import { docxText, extractPdf, itemsToText, paginate } from "../src/store/extract";
import { MemoryPersistence } from "../src/store/persistence";
import { AppStore } from "../src/store/store";

let n = 0;
const ctx = (today = "2026-10-30"): A.Ctx => ({ now: `${today}T12:00:${String(n % 60).padStart(2, "0")}.000Z`, today, id: (p = "") => `${p}${++n}` });

/** Executa a ação com um "hoje" fixo. */
function exec<T, Args extends unknown[]>(store: AppStore, action: (ds: never, c: A.Ctx, ...a: Args) => A.Result<T>, ...args: Args): T {
  const { ops, value } = (action as unknown as (ds: unknown, c: A.Ctx, ...a: Args) => A.Result<T>)(store.getSnapshot(), ctx(), ...args);
  store.commit(ops);
  return value;
}

async function setup() {
  const p = new MemoryPersistence();
  const store = new AppStore(p);
  await store.load();
  return { p, store };
}

const caseInput = (number: string): A.CaseInput => ({
  number,
  rite: "civel",
  status: "ativo",
  court: "",
  parties: [
    { id: "", name: "Maria Exemplo", pole: "ativo", role: "Autora", client: true },
    { id: "", name: "Banco Alfa S.A.", pole: "passivo", role: "Réu" },
  ],
});

const fileMeta = (id: string, pageCount: number): FileMeta => ({ id, name: `${id}.pdf`, mime: "application/pdf", size: 10, pageCount, createdAt: "2026-10-30" });

describe("armazenamento e ações", () => {
  it("cadastra processo, expediente e providência, e grava no aparelho", async () => {
    const { p, store } = await setup();
    const caseId = exec(store, A.saveCase, caseInput("08012345620238205001"));
    const c = store.getSnapshot()!.cases[caseId];
    expect(c.number).toBe("0801234-56.2023.8.20.5001");
    expect(c.court).toBe("TJRN");
    expect(() => exec(store, A.saveCase, caseInput("0801234-56.2023.8.20.5001"))).toThrow(/Já existe/);

    const client = c.parties.find((x) => x.client)!;
    const { id: noticeId, taskIds } = exec(
      store,
      A.saveNotice,
      { caseId, kind: "intimacao", channel: "djen", recipients: [client.id], sentAt: "2026-10-09", days: 15, counting: "uteis", act: "Réplica", petition: true },
      [{ title: "Réplica", kind: "peticao", checklist: ["Documentos novos", "Procuração"] }],
    );
    const items = agenda(store.getSnapshot()!, "2026-10-30");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "task", title: "Réplica", due: "2026-11-04", internal: "2026-10-30", urgency: "semana", internalUrgency: "hoje", missingDocs: 2 });

    exec(store, A.toggleCheck, taskIds[0], store.getSnapshot()!.tasks[taskIds[0]].checklist[0].id, true);
    expect(agenda(store.getSnapshot()!, "2026-10-30")[0].missingDocs).toBe(1);
    exec(store, A.setTaskStatus, taskIds[0], "protocolada");
    expect(store.getSnapshot()!.notices[noticeId].status).toBe("cumprido");
    expect(agenda(store.getSnapshot()!, "2026-10-30")).toHaveLength(0);

    exec(store, A.setCaseStatus, caseId, "concluso", "Réplica protocolada");
    expect(store.getSnapshot()!.cases[caseId].history.at(-1)?.text).toBe("Situação: Em andamento → Concluso para decisão. Réplica protocolada");

    await store.flush();
    const again = new AppStore(p);
    await again.load();
    expect(again.getSnapshot()).toEqual(store.getSnapshot());
  });

  it("guarda documentos e apaga o arquivo que ficou sem uso", async () => {
    const { p, store } = await setup();
    const caseId = exec(store, A.saveCase, caseInput("0801234-56.2023.8.20.5001"));
    await store.saveFile({ id: "f1" }, new Blob(["x"]), ["página 1"]);
    const [docId] = exec(store, A.addDocs, { file: fileMeta("f1", 1), caseId, docs: [{ title: "Sentença", type: "sentenca", date: "2026-10-01" }] });
    expect(await store.pages("f1")).toEqual(["página 1"]);
    exec(store, A.deleteDoc, docId);
    await store.flush();
    expect(store.getSnapshot()!.files.f1).toBeUndefined();
    expect(p.blobs.has("f1")).toBe(false);
    expect(p.pages.has("f1")).toBe(false);
  });

  it("importa o processo integral e, numa nova importação, aproveita os documentos", async () => {
    const { store } = await setup();
    const stamp = (id: string, pag: number) => `Num. ${id} - Pág. ${pag}`;
    const v1 = [
      "Número: 0801234-56.2023.8.20.5001\nClasse: PROCEDIMENTO COMUM CÍVEL\nPartes\nMARIA EXEMPLO (AUTOR)\nBANCO ALFA S.A. (REU)\nDocumentos\n11111111 15/03/2023 10:20 Petição Inicial Petição Inicial",
      `EXCELENTÍSSIMO SENHOR JUIZ\n${stamp("11111111", 1)}`,
    ];
    const info1 = parseCaseFile(v1);
    const r1 = exec(store, A.importCaseFile, {
      file: fileMeta("f1", 2),
      info: info1,
      create: { number: info1.number!, rite: "civel", status: "ativo", className: info1.className, parties: info1.parties.map((x) => ({ id: "", name: x.name, pole: x.pole, role: x.role })) },
    });
    expect(r1).toMatchObject({ added: 2, updated: 0 });
    const c = store.getSnapshot()!.cases[r1.caseId];
    expect(c.className).toBe("Procedimento Comum Cível");
    expect(c.parties.map((x) => x.name)).toEqual(["Maria Exemplo", "Banco Alfa S.A."]);

    const v2 = [v1[0] + "\n22222222 20/04/2023 14:00 Contestação Contestação", v1[1], `CONTESTAÇÃO\n${stamp("22222222", 1)}`];
    const r2 = exec(store, A.importCaseFile, { file: fileMeta("f2", 3), info: parseCaseFile(v2), caseId: r1.caseId });
    expect(r2).toMatchObject({ caseId: r1.caseId, added: 1, updated: 2 });
    const ds = store.getSnapshot()!;
    expect(Object.keys(ds.files)).toEqual(["f2"]);
    expect(Object.values(ds.docs).map((d) => [d.title, d.fileId, d.pages]).sort()).toEqual([
      ["Capa e índice do processo", "f2", [1, 1]],
      ["Contestação", "f2", [3, 3]],
      ["Petição Inicial", "f2", [2, 2]],
      ["Processo integral (PJe)", "f2", undefined],
    ]);
  });

  it("jurisprudência: evita duplicata e desfaz vínculos ao apagar o processo", async () => {
    const { store } = await setup();
    const caseId = exec(store, A.saveCase, caseInput("0801234-56.2023.8.20.5001"));
    const base: A.PrecedentInput = { court: "stj", className: "Súmula", number: "297", binding: "sumula", standing: "vigente", parties: [], caseIds: [caseId] };
    const id = exec(store, A.savePrecedent, base);
    expect(store.getSnapshot()!.precedents[id].court).toBe("STJ");
    expect(() => exec(store, A.savePrecedent, { ...base, number: "297 " })).toThrow(/já está na base/);
    exec(store, A.deleteCase, caseId);
    expect(store.getSnapshot()!.precedents[id].caseIds).toEqual([]);
  });

  it("valida expedientes e feriados", async () => {
    const { store } = await setup();
    const caseId = exec(store, A.saveCase, caseInput("0801234-56.2023.8.20.5001"));
    expect(() => exec(store, A.saveNotice, { caseId, kind: "intimacao", channel: "sistema", recipients: [], sentAt: "2026-10-10", readAt: "2026-10-01", counting: "uteis" })).toThrow(/anterior ao envio/);
    exec(store, A.addHoliday, { date: "2026-11-03", label: "Feriado municipal", kind: "feriado", courts: ["tjrn"] });
    expect(store.getSnapshot()!.prefs.holidays[0]).toMatchObject({ courts: ["TJRN"] });
  });
});

describe("leitura de arquivos", () => {
  it("monta as linhas do PDF pela posição do texto", () => {
    const it = (str: string, x: number, y: number, w: number) => ({ str, transform: [10, 0, 0, 10, x, y], width: w, height: 10 });
    const text = itemsToText([
      it("Segunda linha", 50, 700, 60),
      it("MARIA (AUTOR)", 50, 720, 70),
      it("JOSÉ (ADVOGADO)", 300, 720.5, 80),
      { str: "Num. 123 - Pág. 1", transform: [0, -10, 10, 0, 580, 400], width: 80, height: 10 },
      it("indeniza-", 50, 680, 40),
      it("ção devida", 50, 668, 50),
    ]);
    expect(text).toBe("MARIA (AUTOR) JOSÉ (ADVOGADO)\nSegunda linha\nindenização devida\nNum. 123 - Pág. 1");
  });

  it("lê PDF de verdade com o pdf.js", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = simplePdf([["Número: 0801234-56.2023.8.20.5001", "Classe: PROCEDIMENTO COMUM CÍVEL"], ["DESPACHO", "Intime-se para réplica."]]);
    const progress: number[] = [];
    const out = await extractPdf(pdf, pdfjs as never, (d) => progress.push(d));
    expect(out.pages).toEqual(["Número: 0801234-56.2023.8.20.5001\nClasse: PROCEDIMENTO COMUM CÍVEL", "DESPACHO\nIntime-se para réplica."]);
    expect(out.empty).toEqual([]);
    expect(progress).toEqual([1, 2]);
    expect(out.outline).toBeUndefined();
  });

  it("lê os marcadores do PDF com a página de cada um", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = simplePdf([["Capa"], ["Peticao inicial"], ["continua"], ["Despacho"]], [
      { title: "Evento 1", page: 2, kids: [{ title: "INIC1", page: 2 }] },
      { title: "Evento 3", page: 4, kids: [{ title: "DESPADEC1", page: 4 }] },
    ]);
    const out = await extractPdf(pdf, pdfjs as never);
    expect(out.outline).toEqual([
      { title: "Evento 1", page: 2, depth: 0, leaf: false, parent: undefined },
      { title: "INIC1", page: 2, depth: 1, leaf: true, parent: "Evento 1" },
      { title: "Evento 3", page: 4, depth: 0, leaf: false, parent: undefined },
      { title: "DESPADEC1", page: 4, depth: 1, leaf: true, parent: "Evento 3" },
    ]);
  });

  it("lê Word (.docx) e divide textos longos", () => {
    const xml = `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>EXCELENTÍSSIMO SENHOR</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Maria &amp; </w:t></w:r><w:r><w:t>José</w:t></w:r><w:r><w:tab/><w:t>fim</w:t></w:r></w:p></w:body></w:document>`;
    const docx = zipSync({ "word/document.xml": strToU8(xml), "[Content_Types].xml": strToU8("<Types/>") });
    expect(docxText(docx)).toBe("EXCELENTÍSSIMO SENHOR\nMaria & José\tfim");
    const pages = paginate("a".repeat(3000) + "\n" + "b".repeat(3000));
    expect(pages.map((p) => p.length)).toEqual([3000, 3000]);
  });
});

describe("cópia de segurança e exportações", () => {
  it("salva e restaura tudo, inclusive os arquivos", async () => {
    const { store } = await setup();
    const caseId = exec(store, A.saveCase, caseInput("0801234-56.2023.8.20.5001"));
    await store.saveFile({ id: "f1" }, new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }), ["texto da página"]);
    exec(store, A.addDocs, { file: fileMeta("f1", 1), caseId, docs: [{ title: "Decisão", type: "decisao" }] });
    const zip = await makeBackup({ ds: store.getSnapshot()!, blob: (id) => store.blob(id), pages: (id) => store.pages(id) });
    const restored = readBackup(zip);
    expect(restored.ds).toEqual(store.getSnapshot());
    expect([...new Uint8Array(await restored.files.get("f1")!.blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(restored.files.get("f1")!.pages).toEqual(["texto da página"]);

    const { store: other, p } = await setup();
    await other.replace(restored.ds, restored.files);
    expect(other.getSnapshot()!.cases[caseId].number).toBe("0801234-56.2023.8.20.5001");
    expect(p.pages.get("f1")).toEqual(["texto da página"]);
    expect(() => readBackup(new Uint8Array([1, 2, 3]))).toThrow(/não é uma cópia/);
  });

  it("exporta a agenda e a planilha", async () => {
    const { store } = await setup();
    const caseId = exec(store, A.saveCase, caseInput("0801234-56.2023.8.20.5001"));
    exec(store, A.saveNotice, {
      caseId, kind: "intimacao", channel: "djen", recipients: [], sentAt: "2026-10-09", days: 15, counting: "uteis", act: "Réplica", petition: true,
      hearing: { date: "2026-12-10", time: "09:30", kind: "Audiência de conciliação" },
    });
    const ics = agendaToIcs(store.getSnapshot()!, "2026-10-30", new Date("2026-10-30T12:00:00Z"));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261104");
    expect(ics).toContain("DTSTART:20261210T093000");
    expect(ics).toContain("SUMMARY:Prazo: Réplica – Maria Exemplo x Banco Alfa S.A.");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const csv = casesToCsv(store.getSnapshot()!, "2026-10-30");
    expect(csv.split("\r\n")[1]).toBe("0801234-56.2023.8.20.5001;Maria Exemplo x Banco Alfa S.A.;Maria Exemplo;TJRN;;;Em andamento;04/11/2026;Réplica;;");
  });
});

interface Mark {
  title: string;
  page: number;
  kids?: Mark[];
}

/** PDF mínimo com texto (fonte Helvetica, acentos em WinAnsi) e marcadores, para testar a leitura com o pdf.js. */
function simplePdf(pages: string[][], outline: Mark[] = []): Uint8Array {
  const objs: string[] = [];
  const pageIds: number[] = [];
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  let next = 4;
  for (const lines of pages) {
    const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l, i) => `${i ? "T* " : ""}(${esc(l)}) Tj`).join(" ")} ET`;
    const contentId = next++;
    const pageId = next++;
    objs[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    pageIds.push(pageId);
  }
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  // marcadores: cada um aponta para a página com um destino explícito [página /XYZ x y zoom]
  const marks = (items: Mark[], parent: number): number[] => {
    const ids = items.map(() => next++);
    items.forEach((m, i) => {
      const kids = m.kids?.length ? marks(m.kids, ids[i]) : [];
      const links = [
        `/Parent ${parent} 0 R`,
        i > 0 ? `/Prev ${ids[i - 1]} 0 R` : "",
        i < ids.length - 1 ? `/Next ${ids[i + 1]} 0 R` : "",
        kids.length ? `/First ${kids[0]} 0 R /Last ${kids[kids.length - 1]} 0 R /Count ${kids.length}` : "",
      ].join(" ");
      objs[ids[i]] = `<< /Title (${esc(m.title)}) ${links} /Dest [${pageIds[m.page - 1]} 0 R /XYZ 0 792 0] >>`;
    });
    return ids;
  };
  if (outline.length) {
    const root = next++;
    const top = marks(outline, root);
    objs[root] = `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top[top.length - 1]} 0 R /Count ${top.length} >>`;
    objs[1] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${root} 0 R >>`;
  } else objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from([...out].map((ch) => ch.charCodeAt(0) & 0xff));
}
