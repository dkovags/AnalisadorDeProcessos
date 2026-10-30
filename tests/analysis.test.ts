import { describe, expect, it } from "vitest";
import { analyze, classifyText, explicitTerms, requestedDocs } from "../src/domain/analysis";
import { courtRef, eprocDoc, parseCaseFile } from "../src/domain/casefile";
import { cnjCheckDigits, formatCnj } from "../src/domain/cnj";
import { fold } from "../src/domain/text";

const DJEN = `Processo: 0801234-56.2023.8.20.5001
Órgão: 3ª Vara Cível da Comarca de Natal
Data de disponibilização: 09/10/2026
Tipo de comunicação: Intimação
Meio: Diário de Justiça Eletrônico Nacional
Parte(s): MARIA EXEMPLO; BANCO ALFA S.A.
Advogado(s): JOSÉ DEFENSOR OAB 1234/RN
Teor da Comunicação
DESPACHO. Intime-se a parte autora para, no prazo de 15 (quinze) dias, apresentar réplica à contestação de Id. 99887766.
Após, conclusos.`;

describe("análise de expedientes", () => {
  it("lê a intimação do DJEN: dados, ato, prazo e destinatário", () => {
    const a = analyze(DJEN);
    expect(a.caseNumber).toBe("0801234-56.2023.8.20.5001");
    expect(a.kind).toBe("intimacao");
    expect(a.channel).toBe("djen");
    expect(a.sentAt).toBe("2026-10-09");
    expect(a.recipients).toEqual(["Maria Exemplo", "Banco Alfa S.A."]);
    expect(a.lawyers[0]).toMatch(/JOSÉ DEFENSOR/);
    expect(a.target).toBe("ativo");
    expect(a.suggestions[0]).toMatchObject({ rule: "replica", act: "Réplica", days: 15, explicit: true, petition: true, counting: "uteis" });
    expect(a.suggestions[0].basis).toMatch(/350/);
    expect(a.status?.status).toBe("aguardando");
  });

  it("citação com audiência de conciliação", () => {
    const text = `CARTA DE CITAÇÃO
Fica Vossa Senhoria CITADO(A) para, querendo, apresentar contestação, e intimado(a) da audiência de conciliação designada para o dia 10/12/2026, às 9h30, a ser realizada por videoconferência.
Advertência: o prazo para contestar conta da audiência (art. 335, I, do CPC).`;
    const a = analyze(text);
    expect(a.kind).toBe("citacao");
    expect(a.suggestions.map((s) => s.rule)).toEqual(["contestacao", "audiencia"]);
    expect(a.suggestions[0]).toMatchObject({ act: "Contestação", days: 15 });
    expect(a.hearing).toEqual({ date: "2026-12-10", time: "09:30", kind: "Audiência de conciliação", place: "Por videoconferência" });
    expect(a.suggestions[1].act).toBe("Audiência de conciliação");
    expect(a.status?.status).toBe("audiencia");
  });

  it("sentença: recurso conforme o rito", () => {
    const text = `SENTENÇA
Ante o exposto, JULGO PROCEDENTE o pedido para condenar o réu ao pagamento de R$ 5.000,00. Tendo em vista o laudo, fixo honorários. Publique-se. Intimem-se.`;
    const civel = analyze(text);
    expect(civel.docType).toBe("sentenca");
    expect(civel.suggestions[0]).toMatchObject({ rule: "sentenca", act: "Apelação", days: 15, kind: "recurso" });
    expect(civel.suggestions[0].alt).toBe("Embargos de declaração");
    expect(civel.suggestions.map((s) => s.rule)).not.toContain("laudo"); // "tendo em vista o laudo" não pede manifestação
    expect(civel.status?.status).toBe("sentenciado");
    expect(analyze(text, { rite: "juizado" }).suggestions[0]).toMatchObject({ act: "Recurso inominado", days: 10 });
    expect(analyze(text, { rite: "trabalho" }).suggestions[0]).toMatchObject({ act: "Recurso ordinário", days: 8 });
    expect(analyze(text, { rite: "penal" }).suggestions[0]).toMatchObject({ act: "Apelação", days: 5, counting: "corridos" });
  });

  it("emenda à inicial com documentos pedidos pelo juiz", () => {
    const text = `DESPACHO
Emende a parte autora a petição inicial, no prazo de 15 dias, sob pena de indeferimento, para juntar comprovante de residência atualizado, cópia do contrato de financiamento e extrato bancário do mês de março.`;
    const a = analyze(text);
    expect(a.suggestions[0]).toMatchObject({ rule: "emenda", act: "Emenda à inicial", days: 15, explicit: true });
    expect(a.suggestions[0].docs).toEqual([
      "Comprovante de residência atualizado",
      "Cópia do contrato de financiamento",
      "Extrato bancário do mês de março",
    ]);
    expect(a.target).toBe("ativo");
  });

  it("prazo não fixado: 5 dias (CPC, art. 218, § 3º)", () => {
    const a = analyze("Intime-se o réu para manifestar-se sobre os cálculos apresentados.");
    expect(a.suggestions[0]).toMatchObject({ rule: "manifestacao", days: 5 });
    expect(a.suggestions[0].basis).toMatch(/218/);
    expect(a.target).toBe("passivo");
  });

  it("cumprimento de sentença não vira apelação", () => {
    const a = analyze("Intime-se o executado para pagar o débito, no prazo de 15 dias, sob pena de multa de dez por cento (art. 523 do CPC), no cumprimento de sentença.");
    expect(a.suggestions[0]).toMatchObject({ rule: "pagamento_cumprimento", days: 15 });
    expect(a.suggestions.map((s) => s.rule)).not.toContain("sentenca");
    expect(a.status?.status).toBe("execucao");
  });

  it("prazos escritos por extenso e em horas", () => {
    expect(explicitTerms(fold("no prazo de quinze dias úteis")).map((t) => [t.days, t.counting])).toEqual([[15, "uteis"]]);
    expect(explicitTerms(fold("em 48 (quarenta e oito) horas"))[0].days).toBe(2);
    expect(explicitTerms(fold("prazo comum de 10 (dez) dias"))[0].days).toBe(10);
  });

  it("documentos pedidos junto com outro ato instruem esse ato", () => {
    const a = analyze("Intime-se a parte autora para, no prazo de 15 dias, apresentar réplica à contestação, devendo juntar o extrato atualizado do SPC e comprovante de residência atualizado.");
    expect(a.suggestions.map((s) => s.rule)).toEqual(["replica"]);
    expect(a.suggestions[0].docs).toEqual(["Extrato atualizado do SPC", "Comprovante de residência atualizado", "Documentos novos que respondam à defesa (CPC, art. 435)"]);
  });

  it("documentos pedidos", () => {
    expect(requestedDocs("Junte o autor cópia do RG, do CPF e comprovante de endereço, sob pena de extinção.")).toEqual([
      "Cópia do RG",
      "Cópia do CPF",
      "Comprovante de endereço",
    ]);
  });

  it("classifica documentos", () => {
    expect(classifyText("ESCRITÓRIO SILVA\nRua X, 10\n\nEXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO\n\nMARIA vem propor AÇÃO INDENIZATÓRIA em face de BANCO")).toBe("inicial");
    expect(classifyText("EXMO. SR. JUIZ\nBANCO ALFA vem apresentar CONTESTAÇÃO")).toBe("contestacao");
    expect(classifyText("ATO ORDINATÓRIO\nIntimo a parte autora")).toBe("ato");
    expect(classifyText("PROCURAÇÃO AD JUDICIA\nOutorgante")).toBe("procuracao");
    expect(classifyText("Vistos.\nDefiro a tutela de urgência.")).toBe("decisao");
  });
});

const PJE_PAGES = [
  `Número: 0801234-56.2023.8.20.5001
Classe: PROCEDIMENTO COMUM CÍVEL
Órgão julgador: 3ª Vara Cível da Comarca de Natal
Última distribuição : 15/03/2023
Valor da causa: R$ 15.000,00
Assuntos: Indenização por Dano Moral
Segredo de justiça? NÃO
Justiça gratuita? SIM
Pedido de liminar ou antecipação de tutela? NÃO
Partes Procurador/Terceiro vinculado
MARIA EXEMPLO (AUTOR) JOSÉ DEFENSOR (ADVOGADO)
BANCO ALFA S.A. (REU) PEDRO PROCURADOR (ADVOGADO)
LUCIA PROCURADORA (ADVOGADO)
Documentos
Id. Data da Assinatura Documento Tipo
11111111 15/03/2023 10:20 Petição Inicial Petição Inicial
11111112 15/03/2023 10:20 Procuração Maria Procuração
22222222 20/04/2023 14:00 Contestação Contestação
33333333 02/10/2026 16:12 Despacho Despacho`,
  `EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO
MARIA EXEMPLO vem propor AÇÃO DE INDENIZAÇÃO em face de BANCO ALFA S.A.
Assinado eletronicamente por: JOSÉ DEFENSOR - 15/03/2023 10:20:31
Num. 11111111 - Pág. 1`,
  `Dos fatos. A autora teve o nome negativado.
Num. 11111111 - Pág. 2`,
  `PROCURAÇÃO
Outorgante: MARIA EXEMPLO
Num. 11111112 - Pág. 1`,
  `EXMO. SR. JUIZ
BANCO ALFA S.A. vem apresentar CONTESTAÇÃO
Num. 22222222 - Pág. 1`,
  `DESPACHO
Intime-se a parte autora para réplica, em 15 dias.
Assinado eletronicamente por: JUIZ TESTE - 02/10/2026 16:12:00
Num. 33333333 - Pág. 1`,
];

describe("processo integral", () => {
  it("lê a capa, as partes e separa os documentos do PJe", () => {
    const info = parseCaseFile(PJE_PAGES);
    expect(info).toMatchObject({
      system: "PJe",
      number: "0801234-56.2023.8.20.5001",
      className: "Procedimento Comum Cível",
      body: "3ª Vara Cível da Comarca de Natal",
      filedAt: "2023-03-15",
      value: 1500000,
      subjects: "Indenização por Dano Moral",
      secret: false,
      freeJustice: true,
    });
    expect(info.parties).toEqual([
      { name: "Maria Exemplo", role: "Autor", pole: "ativo", lawyers: ["José Defensor"] },
      { name: "Banco Alfa S.A.", role: "Reu", pole: "passivo", lawyers: ["Pedro Procurador", "Lucia Procuradora"] },
    ]);
    expect(info.docs.map((d) => [d.courtId, d.type, d.title, d.pages, d.date])).toEqual([
      [undefined, "outro", "Capa e índice do processo", [1, 1], undefined],
      ["11111111", "inicial", "Petição Inicial", [2, 3], "2023-03-15"],
      ["11111112", "procuracao", "Procuração Maria", [4, 4], "2023-03-15"],
      ["22222222", "contestacao", "Contestação", [5, 5], "2023-04-20"],
      ["33333333", "despacho", "Despacho", [6, 6], "2026-10-02"],
    ]);
    expect(info.docs[1].signer).toBe("José Defensor");
  });

  it("e-SAJ: agrupa as páginas pelo código do documento", () => {
    const stamp = (code: string, quem: string) =>
      `Este documento é cópia do original, assinado digitalmente por ${quem}, protocolado em 10/02/2023 às 14:22 , sob o número WJMJ23401234567. Para conferir o original, acesse o site https://esaj.tjsp.jus.br/pastadigital/pg/abrirConferenciaDocumento.do, informe o processo 1001234-56.2023.8.26.0100 e código ${code}.`;
    const info = parseCaseFile([
      `EXCELENTÍSSIMO SENHOR JUIZ\nAÇÃO em face de\n${stamp("ABC1234", "FULANO DE TAL")}`,
      `continuação\n${stamp("ABC1234", "FULANO DE TAL")}`,
      `DECISÃO\nDefiro a liminar.\n${stamp("XYZ9876", "JUIZ")}`,
    ]);
    expect(info.system).toBe("e-SAJ");
    expect(info.number).toBe("1001234-56.2023.8.26.0100");
    expect(info.docs.map((d) => [d.courtId, d.type, d.pages])).toEqual([
      ["ABC1234", "inicial", [1, 2]],
      ["XYZ9876", "decisao", [3, 3]],
    ]);
  });

  it("formato desconhecido: um documento só, com número e partes do texto", () => {
    const info = parseCaseFile(["Processo 0801234-56.2023.8.20.5001\nAutor: MARIA EXEMPLO\nRéu: BANCO ALFA S.A.", "texto"]);
    expect(info.number).toBe("0801234-56.2023.8.20.5001");
    expect(info.parties.map((p) => [p.name, p.pole])).toEqual([["Maria Exemplo", "ativo"], ["Banco Alfa S.A.", "passivo"]]);
    expect(info.docs).toEqual([{ title: "Processo integral", type: "processo", pages: [1, 2] }]);
  });
});

// Processo fictício no formato do eproc: capa com "Partes e Representantes" e eventos; carimbo em cada página.
const EPROC_NUMBER = formatCnj({ seq: "5001234", year: "2023", j: "4", tr: "04", origin: "7100", dv: cnjCheckDigits({ seq: "5001234", year: "2023", j: "4", tr: "04", origin: "7100" }) });
const EPROC_COVER = `Processo nº ${EPROC_NUMBER}/RS
Nº do processo: ${EPROC_NUMBER}
Classe da ação: PROCEDIMENTO COMUM
Data de autuação: 10/01/2023 10:20:30
Órgão Julgador: Juízo Federal da 1ª VF de Porto Alegre
Nível de sigilo do processo: Sem Sigilo (Nível 0)
Assuntos
Código Descrição Principal
6114 Aposentadoria por Tempo de Contribuição (Art. 55/6) Sim
Partes e Representantes
AUTOR RÉU
FULANO DE TAL (123.456.789-09) INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS (29.979.036/0001-40)
Procurador(es): Procurador(es):
BELTRANA SILVA (RS012345) PROCURADORIA REGIONAL FEDERAL DA 4ª REGIÃO (RS000001)
CICLANO SOUZA (RS054321)
Informações Adicionais
Justiça Gratuita: Deferida
Eventos
Evento Data/Hora Descrição Usuário Documentos
1 10/01/2023 10:20:30 Distribuído por sorteio (RS01) BELTRANA INIC1 PROC2 DECL3
15 20/05/2023 14:00:00 Juntada de Contestação PROCURADOR INSS CONTES1
22 02/10/2026 16:12:00 Despacho/Decisão - Intimação para Réplica JUIZ DESPADEC1`;
const stamp = (ev: number, doc: string, pag: number) => `Processo ${EPROC_NUMBER}/RS, Evento ${ev}, ${doc}, Página ${pag}`;
const EPROC_PAGES = [
  EPROC_COVER,
  `EXCELENTÍSSIMO SENHOR JUIZ FEDERAL\nFULANO DE TAL vem propor AÇÃO em face do INSS\n${stamp(1, "INIC1", 1)}`,
  `Dos pedidos.\n${stamp(1, "INIC1", 2)}`,
  `PROCURAÇÃO\nOutorgante: FULANO DE TAL\n${stamp(1, "PROC2", 1)}`,
  `CONTESTAÇÃO\nO INSS vem apresentar contestação.\n${stamp(15, "CONTES1", 1)}`,
  `DESPACHO\nIntime-se a parte autora para réplica, em 15 dias.\nDocumento eletrônico assinado por JUIZ FEDERAL TESTE, Juiz Federal, na forma do artigo 1º, inciso III, da Lei 11.419, de 19 de dezembro de 2006. A conferência da autenticidade do documento está disponível mediante o preenchimento do código verificador 710012345678v2 e do código CRC 1A2B3C4D.\nInformações adicionais da assinatura:\nSignatário (a): JUIZ FEDERAL TESTE\nData e Hora: 02/10/2026, às 16:12:00\n${stamp(22, "DESPADEC1", 1)}`,
];

describe("processo integral do eproc", () => {
  it("entende os códigos dos documentos", () => {
    expect(eprocDoc("INIC1")).toEqual({ type: "inicial", label: "Petição inicial" });
    expect(eprocDoc("PROCADM5")?.label).toBe("Processo administrativo");
    expect(eprocDoc("DECL3")?.label).toBe("Declaração");
    expect(eprocDoc("CONTRAZ1")?.type).toBe("contrarrazoes");
    expect(eprocDoc("RS01")).toBeNull();
  });

  it("mostra a referência do documento conforme o sistema", () => {
    expect(courtRef("123456789")).toBe("Id. 123456789");
    expect(courtRef("Evento 1, INIC1")).toBe("Evento 1, INIC1");
    expect(courtRef("710012345678v2")).toBe("Cód. verificador 710012345678v2");
    expect(courtRef("Petição Inicial · p. 1")).toBeUndefined();
    expect(courtRef(undefined)).toBeUndefined();
  });

  it("lê a capa, as partes e os documentos pelo carimbo das páginas", () => {
    const info = parseCaseFile(EPROC_PAGES);
    expect(info).toMatchObject({
      system: "eproc",
      number: EPROC_NUMBER,
      className: "Procedimento Comum",
      body: "Juízo Federal da 1ª VF de Porto Alegre",
      filedAt: "2023-01-10",
      subjects: "Aposentadoria por Tempo de Contribuição (Art. 55/6)",
      secret: false,
      freeJustice: true,
    });
    expect(info.parties).toEqual([
      { name: "Fulano de Tal", role: "Autor", pole: "ativo", lawyers: ["Beltrana Silva (RS012345)", "Ciclano Souza (RS054321)"] },
      { name: "Instituto Nacional do Seguro Social - INSS", role: "Réu", pole: "passivo", lawyers: ["Procuradoria Regional Federal da 4ª Região (RS000001)"] },
    ]);
    expect(info.docs.map((d) => [d.courtId, d.type, d.title, d.pages, d.date])).toEqual([
      [undefined, "outro", "Capa do processo", [1, 1], undefined],
      ["Evento 1, INIC1", "inicial", "Petição inicial (INIC1)", [2, 3], "2023-01-10"],
      ["Evento 1, PROC2", "procuracao", "Procuração (PROC2)", [4, 4], "2023-01-10"],
      ["Evento 15, CONTES1", "contestacao", "Contestação (CONTES1)", [5, 5], "2023-05-20"],
      ["Evento 22, DESPADEC1", "despacho", "Despacho ou decisão (DESPADEC1)", [6, 6], "2026-10-02"],
    ]);
    expect(info.docs[4].signer).toBe("Juiz Federal Teste");
  });

  it("sem carimbo, separa os documentos pelos marcadores do PDF", () => {
    const pages = EPROC_PAGES.map((p) => p.replace(/\n?Processo [^\n]*, Evento \d+, [A-Z]+\d, Página \d+/, ""));
    const outline = [
      { title: "Evento 1", page: 2, leaf: false },
      { title: "INIC1", page: 2, leaf: true, parent: "Evento 1" },
      { title: "PROC2", page: 4, leaf: true, parent: "Evento 1" },
      { title: "Evento 15", page: 5, leaf: false },
      { title: "CONTES1", page: 5, leaf: true, parent: "Evento 15" },
      { title: "Evento 22", page: 6, leaf: false },
      { title: "DESPADEC1", page: 6, leaf: true, parent: "Evento 22" },
    ];
    const info = parseCaseFile(pages, { outline });
    expect(info.system).toBe("eproc");
    expect(info.parties.map((p) => p.name)).toEqual(["Fulano de Tal", "Instituto Nacional do Seguro Social - INSS"]);
    expect(info.docs.map((d) => [d.courtId, d.title, d.pages, d.date])).toEqual([
      [undefined, "Capa do processo", [1, 1], undefined],
      ["Evento 1, INIC1", "Petição inicial (INIC1)", [2, 3], "2023-01-10"],
      ["Evento 1, PROC2", "Procuração (PROC2)", [4, 4], "2023-01-10"],
      ["Evento 15, CONTES1", "Contestação (CONTES1)", [5, 5], "2023-05-20"],
      ["Evento 22, DESPADEC1", "Despacho ou decisão (DESPADEC1)", [6, 6], "2026-10-02"],
    ]);
  });

  it("marcadores de outros sistemas também separam os documentos", () => {
    const info = parseCaseFile(["PETIÇÃO INICIAL\ntexto", "continua", "SENTENÇA\nJulgo procedente."], {
      outline: [
        { title: "Petição Inicial", page: 1 },
        { title: "Sentença", page: 3 },
      ],
    });
    expect(info.system).toBeUndefined();
    expect(info.docs.map((d) => [d.title, d.type, d.pages])).toEqual([
      ["Petição Inicial", "inicial", [1, 2]],
      ["Sentença", "sentenca", [3, 3]],
    ]);
  });

  it("escolhe o nível dos marcadores que são documentos", () => {
    const pages = ["PETIÇÃO INICIAL\nDos fatos", "Dos pedidos", "SENTENÇA\nJulgo procedente."];
    // seções dentro da petição não viram documentos
    const nested = parseCaseFile(pages, {
      outline: [
        { title: "Petição inicial", page: 1, depth: 0, leaf: false },
        { title: "Dos fatos", page: 1, depth: 1, leaf: true, parent: "Petição inicial" },
        { title: "Dos pedidos", page: 2, depth: 1, leaf: true, parent: "Petição inicial" },
        { title: "Sentença", page: 3, depth: 0, leaf: true },
      ],
    });
    expect(nested.docs.map((d) => [d.title, d.pages])).toEqual([
      ["Petição inicial", [1, 2]],
      ["Sentença", [3, 3]],
    ]);
    // eproc sem os códigos: os documentos ficam abaixo de cada evento
    const events = parseCaseFile(["capa", ...pages], {
      outline: [
        { title: "Evento 1", page: 2, depth: 0, leaf: false },
        { title: "Petição inicial", page: 2, depth: 1, leaf: true, parent: "Evento 1" },
        { title: "Evento 8 - Sentença", page: 4, depth: 0, leaf: true },
      ],
    });
    expect(events.system).toBe("eproc");
    expect(events.docs.map((d) => [d.title, d.type, d.pages])).toEqual([
      ["Capa do processo", "outro", [1, 1]],
      ["Petição inicial (Evento 1)", "inicial", [2, 3]],
      ["Evento 8 - Sentença", "sentenca", [4, 4]],
    ]);
  });
});
