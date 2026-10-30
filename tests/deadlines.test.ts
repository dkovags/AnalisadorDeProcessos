import { describe, expect, it } from "vitest";
import { DEFAULT_FORENSIC, easter, makeCalendar } from "../src/domain/calendar";
import { checkCaseNumber, cnjCheckDigits, courtOfCnj, formatCnj, isValidCnj, normalizeCaseNumber, parseCnj } from "../src/domain/cnj";
import { weekday } from "../src/domain/dates";
import { businessDaysBefore, businessDaysUntil, computeDeadline } from "../src/domain/deadlines";
import { fold, findDates, nameKey, numberFromWords, parseMoney, sameParty, titleCase } from "../src/domain/text";

/** Gera um número CNJ válido para os testes. */
function cnj(seq: string, year: string, j: string, tr: string, origin: string) {
  return formatCnj({ seq, year, j, tr, origin, dv: cnjCheckDigits({ seq, year, j, tr, origin }) });
}

describe("número CNJ", () => {
  it("calcula e confere o dígito verificador", () => {
    const n = cnj("0801234", "2023", "8", "20", "5001");
    expect(isValidCnj(n)).toBe(true);
    expect(isValidCnj(n.replace("0801234", "0801243"))).toBe(false);
    expect(checkCaseNumber(n.replace(/\D/g, ""))?.formatted).toBe(n);
    const wrong = n.replace(/-(\d\d)\./, (_, dv) => `-${String((Number(dv) + 1) % 100).padStart(2, "0")}.`);
    expect(checkCaseNumber(wrong)?.valid).toBe(false);
    expect(checkCaseNumber(wrong)?.message).toMatch(/dígito verificador/i);
  });

  it("identifica o tribunal pelo segmento", () => {
    expect(courtOfCnj(parseCnj(cnj("1000001", "2024", "8", "26", "0100"))!)).toBe("TJSP");
    expect(courtOfCnj({ j: "8", tr: "07" })).toBe("TJDFT");
    expect(courtOfCnj({ j: "4", tr: "03" })).toBe("TRF3");
    expect(courtOfCnj({ j: "5", tr: "02" })).toBe("TRT2");
    expect(courtOfCnj({ j: "5", tr: "00" })).toBe("TST");
    expect(courtOfCnj({ j: "6", tr: "20" })).toBe("TRE-RN");
    expect(normalizeCaseNumber(" 08012345620238205001 ")).toBe("0801234-56.2023.8.20.5001");
  });
});

describe("texto", () => {
  it("remove acentos mantendo as posições", () => {
    const s = "Intimação – “ação” CONTESTAÇÃO";
    expect(fold(s)).toBe('intimacao - "acao" contestacao');
    expect(fold(s).length).toBe(s.length);
  });

  it("lê números por extenso, datas e valores", () => {
    expect(numberFromWords("quinze")).toBe(15);
    expect(numberFromWords("quarenta e oito")).toBe(48);
    expect(numberFromWords("10")).toBe(10);
    expect(findDates("Brasília, 12 de março de 2024; DJe 15/3/2024 e 1º de abril de 2024").map((d) => d.iso)).toEqual([
      "2024-03-12", "2024-03-15", "2024-04-01",
    ]);
    expect(findDates("31/02/2024")).toEqual([]);
    expect(parseMoney("R$ 15.000,50")).toBe(1500050);
  });

  it("compara nomes de partes", () => {
    expect(titleCase("BANCO DO BRASIL S.A.")).toBe("Banco do Brasil S.A.");
    expect(titleCase("MARIA DA SILVA")).toBe("Maria da Silva");
    expect(nameKey("BANCO ALFA S/A")).toBe(nameKey("Banco Alfa SA"));
    expect(sameParty("Banco Alfa S.A.", "BANCO ALFA S/A")).toBe(true);
    expect(sameParty("Maria da Silva", "Maria da Silva Souza")).toBe(true);
    expect(sameParty("Maria", "Maria da Silva")).toBe(false);
  });
});

describe("calendário forense", () => {
  it("calcula a Páscoa e os feriados móveis", () => {
    expect(easter(2024)).toBe("2024-03-31");
    expect(easter(2025)).toBe("2025-04-20");
    expect(easter(2026)).toBe("2026-04-05");
    const cal = makeCalendar();
    expect(cal.isBusiness("2026-02-16")).toBe(false); // carnaval
    expect(cal.info("2026-02-18").partial).toBe(true); // cinzas
    expect(cal.isBusiness("2026-04-03")).toBe(false); // paixão
    expect(cal.isBusiness("2026-06-04")).toBe(true); // Corpus Christi não vem marcado
    expect(makeCalendar({ forensic: { ...DEFAULT_FORENSIC, corpus: true } }).isBusiness("2026-06-04")).toBe(false);
    expect(cal.isBusiness("2026-11-20")).toBe(false); // Consciência Negra
    expect(cal.isBusiness("2023-11-20")).toBe(true); // antes da Lei 14.759/2023
  });

  it("marca o recesso e a suspensão de prazos", () => {
    const cal = makeCalendar();
    expect(cal.info("2026-12-22")).toMatchObject({ expedient: false, suspended: true });
    expect(cal.info("2027-01-12")).toMatchObject({ expedient: true, suspended: true });
    expect(cal.counts("2027-01-21")).toBe(true);
  });

  it("aplica feriados locais só ao tribunal indicado", () => {
    const holidays = [{ id: "1", date: "2026-10-03", yearly: true, label: "Mártires de Cunhaú e Uruaçu", kind: "feriado" as const, courts: ["TJRN"] }];
    expect(makeCalendar({ holidays, court: "TJRN" }).isBusiness("2025-10-03")).toBe(false);
    expect(makeCalendar({ holidays, court: "TJSP" }).isBusiness("2025-10-03")).toBe(true);
  });
});

describe("prazos", () => {
  const cal = makeCalendar();

  it("DJEN: publicação no dia útil seguinte e contagem em dias úteis", () => {
    expect(weekday("2026-10-09")).toBe(5); // sexta-feira
    const r = computeDeadline({ channel: "djen", sentAt: "2026-10-09", days: 15, counting: "uteis" }, cal);
    // 12/10 é feriado: publicação em 13/10, início em 14/10, e 02/11 (Finados) não conta
    expect(r.trigger).toBe("2026-10-13");
    expect(r.start).toBe("2026-10-14");
    expect(r.due).toBe("2026-11-04");
    expect(r.skipped.map((s) => s.date)).toContain("2026-11-02");
  });

  it("intimação pelo sistema: ciência ficta em 10 dias corridos", () => {
    const r = computeDeadline({ channel: "sistema", sentAt: "2026-10-16", days: 5, counting: "uteis", today: "2026-10-20" }, cal);
    expect(r.trigger).toBe("2026-10-26");
    expect(r.provisional).toBe(true);
    expect(r.due).toBe("2026-11-03");
    // consulta antes do fim do prazo
    const lido = computeDeadline({ channel: "sistema", sentAt: "2026-10-16", readAt: "2026-10-19", days: 5, counting: "uteis" }, cal);
    expect(lido.due).toBe("2026-10-26");
    // ciência ficta em domingo passa para segunda
    const dom = computeDeadline({ channel: "sistema", sentAt: "2026-10-15", days: 1, counting: "uteis" }, cal);
    expect(dom.trigger).toBe("2026-10-26");
  });

  it("recesso: o prazo só começa depois de 20/01", () => {
    const r = computeDeadline({ channel: "djen", sentAt: "2026-12-17", days: 15, counting: "uteis" }, cal);
    expect(r.trigger).toBe("2026-12-18");
    expect(r.start).toBe("2027-01-21");
    expect(r.due).toBe("2027-02-12"); // 08 e 09/02/2027 são carnaval
  });

  it("prazo em dobro e vencimento depois da Quarta-feira de Cinzas", () => {
    const r = computeDeadline({ channel: "pessoal", readAt: "2026-02-02", days: 5, counting: "uteis", double: true }, cal);
    // 10 dias úteis a partir de 03/02, sem 16 e 17/02 (carnaval): o 10º é a Quarta-feira de Cinzas, que não pode ser o vencimento
    expect(r.days).toBe(10);
    expect(r.due).toBe("2026-02-19");
    expect(r.steps.some((s) => s.date === "2026-02-19" && /reduzido/.test(s.text))).toBe(true);
  });

  it("dias corridos (processo penal)", () => {
    const sexta = computeDeadline({ channel: "pessoal", readAt: "2026-10-16", days: 5, counting: "corridos", rite: "penal" }, cal);
    expect(sexta.start).toBe("2026-10-19"); // Súmula 310 do STF
    expect(sexta.due).toBe("2026-10-23");
    const domingo = computeDeadline({ channel: "pessoal", readAt: "2026-10-16", days: 7, counting: "corridos" }, cal);
    expect(domingo.due).toBe("2026-10-26");
  });

  it("citação por e-mail e pelo Domicílio Judicial Eletrônico", () => {
    const r = computeDeadline({ channel: "email", readAt: "2026-10-19", days: 15, counting: "uteis" }, cal);
    expect(r.trigger).toBe("2026-10-26");
    const semConfirmacao = computeDeadline({ channel: "domicilio", kind: "citacao", sentAt: "2026-10-19", days: 15, counting: "uteis" }, cal);
    expect(semConfirmacao.due).toBeUndefined();
    expect(semConfirmacao.pending).toMatch(/246/);
  });

  it("audiência como início do prazo e expediente sem prazo", () => {
    const r = computeDeadline({ channel: "correio", readAt: "2026-10-01", days: 15, counting: "uteis", hearingDate: "2026-11-10" }, cal);
    expect(r.trigger).toBe("2026-11-10");
    expect(computeDeadline({ channel: "djen", sentAt: "2026-10-09", counting: "uteis" }, cal).due).toBeUndefined();
  });

  it("dias úteis até o vencimento e prazo interno", () => {
    expect(businessDaysUntil(cal, "2026-10-30", "2026-11-04")).toBe(2); // 03 e 04 (02/11 é feriado)
    expect(businessDaysUntil(cal, "2026-10-30", "2026-10-28")).toBe(-2);
    expect(businessDaysBefore(cal, "2026-11-04", 2)).toBe("2026-10-30");
  });
});
