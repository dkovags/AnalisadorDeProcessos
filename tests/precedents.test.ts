import { describe, expect, it } from "vitest";
import { checkCitations, checkQuote } from "../src/domain/citations";
import { cnjCheckDigits, formatCnj } from "../src/domain/cnj";
import { normalizeBody, normalizeClass } from "../src/domain/courts";
import { citationBlock, formatCitation, parsePrecedentText, sharedParties } from "../src/domain/precedents";
import { extractRefs } from "../src/domain/refs";
import { compile, highlight, parseQuery, scoreHits, searchDoc } from "../src/domain/search";
import type { Case, Precedent } from "../src/domain/types";

// Acórdão fictício (nomes e números inventados para os testes).
const ACORDAO = `Superior Tribunal de Justiça
AgInt no AGRAVO EM RECURSO ESPECIAL Nº 2.345.678 - RJ (2023/0123456-7)
RELATOR : MINISTRO RAUL ARAÚJO
AGRAVANTE : BANCO ALFA S/A
ADVOGADOS : FULANO DE TAL - RJ123456
            BELTRANA DE TAL - RJ654321
AGRAVADO : MARIA EXEMPLO
ADVOGADO : JOSÉ DEFENSOR - RN001234
EMENTA
AGRAVO INTERNO NO AGRAVO EM RECURSO ESPECIAL. CONSUMIDOR. INSCRIÇÃO INDEVIDA EM CADASTRO DE INADIMPLENTES. DANO MORAL IN RE IPSA. AGRAVO INTERNO NÃO PROVIDO.
1. A inscrição indevida do nome do consumidor em cadastro de inadimplentes gera dano moral presumido, que dispensa prova do prejuízo.
2. Agravo interno a que se nega provimento.
ACÓRDÃO
Vistos e relatados estes autos, acordam os Ministros da QUARTA TURMA do Superior Tribunal de Justiça, por unanimidade, negar provimento ao agravo interno.
Brasília, 05 de fevereiro de 2024(Data do Julgamento)`;

const base = { binding: "" as const, standing: "vigente" as const, caseIds: [], createdAt: "", updatedAt: "" };

function lib(): Precedent[] {
  const parsed = parsePrecedentText(ACORDAO);
  return [
    { ...base, id: "p1", ...parsed, court: parsed.court!, className: parsed.className!, number: parsed.number!, publishedAt: "2024-02-08", source: "DJe", checkedAt: "2026-10-01" },
    { ...base, id: "p2", court: "STJ", className: "Súmula", number: "297", binding: "sumula", summary: "O Código de Defesa do Consumidor é aplicável às instituições financeiras.", parties: [], checkedAt: "2026-10-01" },
  ];
}

describe("leitura de acórdãos", () => {
  it("lê classe, número, relator, órgão, data, ementa e partes", () => {
    const p = parsePrecedentText(ACORDAO);
    expect(p).toMatchObject({
      court: "STJ",
      className: "AgInt no AREsp",
      number: "2.345.678",
      uf: "RJ",
      rapporteur: "Raul Araújo",
      female: false,
      body: "Quarta Turma",
      judgedAt: "2024-02-05",
    });
    expect(p.summary).toMatch(/^AGRAVO INTERNO NO AGRAVO EM RECURSO ESPECIAL\. CONSUMIDOR\..*nega provimento\.$/);
    expect(p.parties).toEqual([
      { name: "Banco Alfa S/A", role: "Agravante", pole: "ativo", lawyers: "Fulano de Tal - RJ123456\nBeltrana de Tal - RJ654321" },
      { name: "Maria Exemplo", role: "Agravado", pole: "passivo", lawyers: "José Defensor - RN001234" },
    ]);
  });

  it("lê o cabeçalho do STF e resultados de pesquisa", () => {
    const stf = parsePrecedentText(`SUPREMO TRIBUNAL FEDERAL
AG.REG. NO RECURSO EXTRAORDINÁRIO COM AGRAVO 1.234.567 SÃO PAULO
RELATORA : MIN. CÁRMEN TESTE
AGTE.(S) : ESTADO DE SÃO PAULO
PROC.(A/S)(ES) : PROCURADOR-GERAL DO ESTADO DE SÃO PAULO
AGDO.(A/S) : JOÃO EXEMPLO
EMENTA: Agravo regimental no recurso extraordinário com agravo. Matéria infraconstitucional. Agravo não provido.`);
    expect(stf).toMatchObject({ court: "STF", className: "ARE AgR", number: "1.234.567", rapporteur: "Cármen Teste", female: true });
    expect(stf.parties.map((p) => [p.name, p.role, p.pole])).toEqual([["Estado de São Paulo", "Agravante", "ativo"], ["João Exemplo", "Agravado", "passivo"]]);

    const jus = parsePrecedentText(
      "STJ - AgInt no AREsp: 2345678 RJ 2023/0123456-7, Relator: Ministro RAUL ARAÚJO, Data de Julgamento: 05/02/2024, T4 - QUARTA TURMA, Data de Publicação: DJe 08/02/2024",
    );
    expect(jus).toMatchObject({ court: "STJ", className: "AgInt no AREsp", number: "2345678", uf: "RJ", rapporteur: "Raul Araújo", body: "Quarta Turma", judgedAt: "2024-02-05", publishedAt: "2024-02-08", source: "DJe" });

    const sum = parsePrecedentText("Súmula 297 do STJ: O Código de Defesa do Consumidor é aplicável às instituições financeiras.");
    expect(sum).toMatchObject({ court: "STJ", className: "Súmula", number: "297", binding: "sumula" });
    expect(sum.summary).toBe("O Código de Defesa do Consumidor é aplicável às instituições financeiras.");
  });

  it("normaliza classes e órgãos", () => {
    expect(normalizeClass("AGRAVO INTERNO NOS EMBARGOS DE DECLARAÇÃO NO RECURSO ESPECIAL")).toEqual({ className: "AgInt nos EDcl no REsp", base: "REsp" });
    expect(normalizeClass("Apelação Cível")).toEqual({ className: "Apelação Cível", base: "Apelação Cível" });
    expect(normalizeBody("T3 - TERCEIRA TURMA")).toBe("Terceira Turma");
    expect(normalizeBody("22ª CÂMARA DE DIREITO PRIVADO")).toBe("22ª Câmara de Direito Privado");
    expect(normalizeBody("Tribunal Pleno")).toBe("Tribunal Pleno");
  });

  it("formata a referência nos três estilos, com a ementa na linha de baixo", () => {
    const p = lib()[0];
    expect(formatCitation(p, "forense")).toBe("STJ, AgInt no AREsp 2.345.678/RJ, Rel. Min. Raul Araújo, Quarta Turma, j. 05/02/2024, DJe 08/02/2024.");
    expect(formatCitation(p, "stj")).toBe("AgInt no AREsp n. 2.345.678/RJ, relator Ministro Raul Araújo, Quarta Turma, julgado em 5/2/2024, DJe de 8/2/2024.");
    expect(formatCitation(p, "abnt")).toBe(
      "BRASIL. Superior Tribunal de Justiça (4. Turma). Agravo Interno no Agravo em Recurso Especial 2.345.678/RJ. Agravante: Banco Alfa S/A. Agravado: Maria Exemplo. Relator: Min. Raul Araújo, 5 de fevereiro de 2024. Diário da Justiça Eletrônico: Brasília, DF, 8 fev. 2024.",
    );
    expect(formatCitation(lib()[1])).toBe("Súmula 297 do STJ");
    const block = citationBlock(p, "forense", true);
    expect(block.text.split("\n\n")[0]).toBe(formatCitation(p, "forense"));
    expect(block.text.split("\n\n")[1]).toMatch(/^"AGRAVO INTERNO/);
    expect(block.html).toContain("margin:0 0 0 4cm");
  });

  it("acha processos com partes em comum", () => {
    const c = { id: "c1", parties: [{ id: "x", name: "BANCO ALFA S.A.", pole: "passivo" }] } as unknown as Case;
    expect(sharedParties(lib()[0], [c])).toEqual([{ caseId: "c1", party: "BANCO ALFA S.A.", precedentParty: "Banco Alfa S/A (Agravante)" }]);
  });
});

describe("citações num texto", () => {
  const valid = formatCnj({ seq: "1001234", year: "2023", j: "8", tr: "26", origin: "0100", dv: cnjCheckDigits({ seq: "1001234", year: "2023", j: "8", tr: "26", origin: "0100" }) });
  const invalid = valid.replace(/-(\d\d)\./, (_, dv) => `-${String((Number(dv) + 7) % 100).padStart(2, "0")}.`);
  const PETICAO = `Processo nº 0801234-56.2023.8.20.5001

Nesse sentido:

"AGRAVO INTERNO NO AGRAVO EM RECURSO ESPECIAL. CONSUMIDOR. INSCRIÇÃO INDEVIDA EM CADASTRO DE INADIMPLENTES. [...] 1. A inscrição indevida do nome do consumidor em cadastro de inadimplentes gera dano moral presumido, que dispensa prova do prejuízo."
(STJ, AgInt no AREsp 2.345.678/RJ, Rel. Min. Raul Araújo, Quarta Turma, j. 05/02/2024, DJe 08/02/2024)

Também: STJ, REsp 1.111.111/SP, Rel. Min. Fulano Beltrano, Sétima Turma, j. 10/10/2023, DJe 05/10/2023.

E ainda: TJSP, Apelação Cível ${invalid}, Rel. Des. Beltrano Teste, 22ª Câmara de Direito Privado, j. 10/10/2024, DJe 11/10/2024.

No mesmo sentido, TJSP, Apelação Cível ${valid}, Rel. Des. Beltrano Teste, 22ª Câmara de Direito Privado, j. 10/10/2024, DJe 11/10/2024.

Aplica-se a Súmula 297 do STJ e, por analogia, a Súmula 800 do STF.`;

  it("encontra as citações e ignora o número do próprio processo", () => {
    const refs = extractRefs(PETICAO);
    expect(refs.map((r) => [r.kind, r.court, r.className, r.number])).toEqual([
      ["acordao", "STJ", "AgInt no AREsp", "2.345.678"],
      ["acordao", "STJ", "REsp", "1.111.111"],
      ["acordao", "TJSP", "Apelação Cível", invalid],
      ["acordao", "TJSP", "Apelação Cível", valid],
      ["sumula", "STJ", "Súmula", "297"],
      ["sumula", "STF", "Súmula", "800"],
    ]);
    expect(refs[0]).toMatchObject({ uf: "RJ", rapporteur: "Raul Araújo", rapporteurTitle: "Min.", body: "Quarta Turma", judgedAt: "2024-02-05", publishedAt: "2024-02-08", source: "DJe" });
    expect(refs[2]).toMatchObject({ rapporteur: "Beltrano Teste", rapporteurTitle: "Des.", body: "22ª Câmara de Direito Privado" });
  });

  it("verifica cada citação", () => {
    const res = checkCitations(PETICAO, lib(), { today: "2026-10-30" });
    expect(res.map((r) => r.level)).toEqual(["ok", "erro", "erro", "desconhecida", "ok", "erro"]);
    expect(res[0].quote?.status).toBe("fiel_supressoes");
    expect(res[0].suggestion).toBe("STJ, AgInt no AREsp 2.345.678/RJ, Rel. Min. Raul Araújo, Quarta Turma, j. 05/02/2024, DJe 08/02/2024.");
    const texts = (i: number) => res[i].issues.map((x) => x.text).join(" | ");
    expect(texts(1)).toMatch(/6 turmas/);
    expect(texts(1)).toMatch(/anterior ao julgamento/);
    expect(texts(2)).toMatch(/Número CNJ inválido/);
    expect(res[3].search[0].url).toContain("site%3Atjsp.jus.br");
    expect(texts(5)).toMatch(/736/);
    // o trecho entre aspas é do acórdão citado logo depois dele, não da súmula
    expect(res[4].quote).toBeUndefined();
  });

  it("aponta diferenças no trecho citado", () => {
    const ementa = "A inscrição indevida do nome do consumidor em cadastro de inadimplentes gera dano moral presumido.";
    expect(checkQuote("gera dano moral presumido", ementa).status).toBe("fiel");
    const alterado = checkQuote("A inscrição do nome do consumidor em cadastro de inadimplentes sempre gera dano moral presumido.", ementa);
    expect(alterado.status).toBe("divergente");
    expect(alterado.diff).toEqual([
      { t: "eq", text: "a inscricao" },
      { t: "del", text: "indevida" },
      { t: "eq", text: "do nome do consumidor em cadastro de inadimplentes" },
      { t: "add", text: "sempre" },
      { t: "eq", text: "gera dano moral presumido" },
    ]);
    expect(checkQuote("texto completamente diferente sobre outro assunto qualquer", ementa).status).toBe("nao_corresponde");
  });
});

describe("pesquisa", () => {
  it("entende palavras, frases e exclusões", () => {
    expect(parseQuery('dano "cadastro de inadimplentes" -prescrição')).toEqual({ terms: ["dano"], phrases: ["cadastro de inadimplentes"], exclude: ["prescricao"] });
  });

  it("acha sem acento e pelo começo da palavra, e destaca", () => {
    const m = compile("contestacao intimacao");
    const hit = searchDoc(["Apresentou CONTESTAÇÃO tempestiva.", "Página sem nada", "Intimação da parte; contestações"], m, "Contestação");
    // "contestações" não começa com "contestação"
    expect(hit?.counts).toEqual([1, 1]);
    expect(hit?.pages.map((p) => p.page)).toEqual([1, 3]);
    expect(hit?.titleHit).toBe(true);
    expect(searchDoc(["só contestação"], m)).toBeNull();
    expect(searchDoc(["contestação e intimação"], compile("contestação -intimação"))).toBeNull();
    expect(highlight("A Intimação foi feita", compile("intim")).filter((s) => s.hit).map((s) => s.text)).toEqual(["Intimação"]);
  });

  it("ordena por relevância", () => {
    const m = compile("dano moral");
    const docs = [
      { id: "a", hit: searchDoc(["dano moral dano moral dano"], m)! },
      { id: "b", hit: searchDoc(["dano moral"], m)! },
    ];
    expect(scoreHits(docs, 10).map((d) => d.id)).toEqual(["a", "b"]);
  });
});
