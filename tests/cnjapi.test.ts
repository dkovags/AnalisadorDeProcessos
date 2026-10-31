import { describe, expect, it } from "vitest";
import { cnjReport, fieldNames, testCnj } from "../src/store/cnjapi";

const reply = (body: unknown, status = 200) => ({ status, json: async () => body }) as unknown as Response;

describe("teste de conexão com o CNJ", () => {
  it("lê os nomes dos campos das respostas do DJEN e do DataJud, sem os valores", () => {
    expect(fieldNames({ status: "success", count: 1, items: [{ id: 1, texto: "x", destinatarios: [{ nome: "A", polo: "A" }] }] })).toEqual([
      "(resposta) status",
      "(resposta) count",
      "(resposta) items",
      "id",
      "texto",
      "destinatarios",
      "destinatarios[].nome",
      "destinatarios[].polo",
    ]);
    const datajud = { took: 3, hits: { total: { value: 1 }, hits: [{ _source: { numeroProcesso: "1", movimentos: [{ nome: "Juntada", dataHora: "2026-01-01" }], classe: { nome: "X" } } }] } };
    expect(fieldNames(datajud)).toEqual([
      "(resposta) took",
      "(resposta) hits",
      "numeroProcesso",
      "movimentos",
      "movimentos[].nome",
      "movimentos[].dataHora",
      "classe",
      "classe.nome",
    ]);
  });

  it("separa o que funciona, o que o servidor não deixa ler (CORS) e o que não responde", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const checks = await testCnj("2026-10-31", async (url, init) => {
      calls.push({ url, init });
      if (url.includes("comunicaapi")) return reply({ items: [{ id: 1 }] });
      throw new TypeError("Failed to fetch");
    });
    expect(checks.map((c) => [c.api, c.reach, c.status])).toEqual([
      ["DJEN", "direto", 200],
      ["DataJud", "inacessivel", undefined],
    ]);
    // a consulta de exemplo não leva nenhum dado da pessoa: só o tribunal e as datas
    expect(calls[0].url).toContain("siglaTribunal=TJRJ&dataDisponibilizacaoInicio=2026-10-24&dataDisponibilizacaoFim=2026-10-30");

    const blocked = await testCnj("2026-10-31", async (_url, init) => {
      if (init?.mode === "no-cors") return reply(null, 0);
      throw new TypeError("Failed to fetch");
    });
    expect(blocked.map((c) => c.reach)).toEqual(["bloqueado", "bloqueado"]);
    expect(cnjReport(blocked, "2026-10-31")).toContain("DJEN: o servidor respondeu, mas não aceita consulta direta de outro site");
  });
});
