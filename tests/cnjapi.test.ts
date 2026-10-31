import { describe, expect, it } from "vitest";
import { CnjError, datajudIndex, datajudMovements, djenNotice, djenReady, djenSearch, djenText, oabNumber, type DjenItem } from "../src/store/cnjapi";
import { decodeEntities } from "../src/store/extract";

// Dados fictícios, no formato das APIs do CNJ (nenhuma comunicação ou processo real).

const CONF = { url: "https://intermediario.exemplo/", key: "senha-teste", oab: "123456", uf: "RJ" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const item = (id: number, extra: Partial<DjenItem> = {}): DjenItem => ({
  id,
  data_disponibilizacao: "2026-10-28",
  siglaTribunal: "TJRJ",
  tipoComunicacao: "Intimação",
  tipoDocumento: "Despacho",
  nomeOrgao: "1ª Vara Cível da Comarca de Exemplo",
  nomeClasse: "PROCEDIMENTO COMUM CíVEL",
  texto: "Intime-se a parte autora para, no prazo de 15 dias, apresentar réplica.",
  numero_processo: "08012345620268190001",
  numeroprocessocommascara: "0801234-56.2026.8.19.0001",
  meio: "D",
  ativo: true,
  destinatarios: [
    { nome: "ANA FICTICIA", polo: "A" },
    { nome: "EMPRESA EXEMPLO S.A.", polo: "P" },
  ],
  destinatarioadvogados: [{ advogado: { nome: "ADVOGADO TESTE", numero_oab: "123456", uf_oab: "RJ" } }],
  ...extra,
});

describe("busca no CNJ pelo intermediário", () => {
  it("só busca com endereço, senha e OAB preenchidos", () => {
    expect(djenReady(undefined)).toBe(false);
    expect(djenReady({ url: CONF.url, key: CONF.key })).toBe(false);
    expect(djenReady(CONF)).toBe(true);
    expect(oabNumber("012.345")).toBe("12345");
  });

  it("pagina as comunicações do DJEN, com a senha no cabeçalho e a OAB na consulta", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const items = await djenSearch(CONF, "2026-10-01", "2026-10-31", async (url, init) => {
      calls.push({ url, init });
      const page = Number(new URL(url).searchParams.get("pagina"));
      return json({ status: "success", count: 0, items: Array.from({ length: page === 1 ? 100 : 3 }, (_, i) => item(page * 1000 + i)) });
    });
    expect(items).toHaveLength(103);
    expect(calls).toHaveLength(2);
    const q = new URL(calls[0].url);
    expect(q.origin + q.pathname).toBe("https://intermediario.exemplo/djen");
    expect(Object.fromEntries(q.searchParams)).toEqual({
      numeroOab: "123456",
      ufOab: "RJ",
      dataDisponibilizacaoInicio: "2026-10-01",
      dataDisponibilizacaoFim: "2026-10-31",
      pagina: "1",
      itensPorPagina: "100",
    });
    expect((calls[0].init?.headers as Record<string, string>)["x-chave"]).toBe("senha-teste");
  });

  it("explica as falhas: senha errada, sem conexão, CNJ fora do ar", async () => {
    const fail = (fn: () => Promise<Response>) => djenSearch(CONF, "2026-10-01", "2026-10-31", fn);
    await expect(fail(async () => json({ erro: "Senha ausente ou errada." }, 401))).rejects.toThrow(/recusou a senha/);
    await expect(fail(async () => Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow(/Não foi possível falar com o intermediário/);
    await expect(fail(async () => json({ erro: "Falha ao consultar o CNJ: timeout" }, 502))).rejects.toThrow(/não respondeu a tempo.*timeout/);
    await expect(fail(async () => json({ status: "error", message: "Parâmetro inválido" }))).rejects.toThrow(/Parâmetro inválido/);
    await expect(djenSearch({ ...CONF, url: "intermediario.exemplo" }, "2026-10-01", "2026-10-31", async () => json({ items: [] }))).rejects.toBeInstanceOf(CnjError);
  });

  it("lê a comunicação: texto sem HTML, destinatários, advogados e cancelamento", () => {
    const n = djenNotice(
      item(7, {
        meio: "E",
        tipoComunicacao: "Edital",
        texto:
          "<html><head><style>p{}</style></head><body><header><div></div></header><section><b>Interdi&ccedil;&atilde;o N&ordm; 1</b></section>" +
          "<table><tr><td>REQUERENTE</td><td>: JO&Atilde;O FICT&Iacute;CIO</td></tr></table><p>Prazo de 20 dias.</p></body></html>",
      }),
    )!;
    expect(n).toMatchObject({ id: "7", date: "2026-10-28", number: "0801234-56.2026.8.19.0001", court: "TJRJ", edital: true, cancelled: false });
    expect(n.text).toBe("Interdição Nº 1\nREQUERENTE : JOÃO FICTÍCIO\n\nPrazo de 20 dias.");
    expect(n.recipients).toEqual([
      { name: "ANA FICTICIA", pole: "ativo" },
      { name: "EMPRESA EXEMPLO S.A.", pole: "passivo" },
    ]);
    expect(n.lawyers).toEqual([{ name: "ADVOGADO TESTE", oab: "123456", uf: "RJ" }]);
    expect(djenNotice(item(8, { data_cancelamento: "2026-10-29" }))!.cancelled).toBe(true);
    expect(djenNotice(item(9, { data_disponibilizacao: undefined, datadisponibilizacao: "30/10/2026" }))!.date).toBe("2026-10-30");
    expect(djenNotice(item(10, { numero_processo: undefined, numeroprocessocommascara: undefined }))).toBeNull();
  });

  it("limpa o texto simples e as entidades do HTML", () => {
    expect(djenText("Certifico :    1 - Em relação ao crédito\r\n\r\n\r\n2 - Ao autor")).toBe("Certifico : 1 - Em relação ao crédito\n\n2 - Ao autor");
    expect(decodeEntities("A&ccedil;&Atilde;O &sect; 1&ordm; &#233; &#xE7;&amp;")).toBe("AçÃO § 1º é ç&");
    expect(decodeEntities("&naoexiste; &#0;")).toBe("&naoexiste; &#0;");
  });

  it("traz as movimentações do DataJud, de todos os graus, sem repetir", async () => {
    expect(datajudIndex("TJRJ")).toBe("api_publica_tjrj");
    expect(datajudIndex("TRE-SP")).toBe("api_publica_tre-sp");
    let sent: { url: string; body: unknown } | undefined;
    const r = await datajudMovements({ url: CONF.url, key: CONF.key }, "TJRJ", "0801234-56.2026.8.19.0001", async (url, init) => {
      sent = { url, body: JSON.parse(String(init?.body)) };
      return json({
        hits: {
          hits: [
            {
              _source: {
                numeroProcesso: "08012345620268190001",
                grau: "G1",
                dataHoraUltimaAtualizacao: "2026-09-01T10:00:00.000Z",
                movimentos: [
                  { codigo: 51, nome: "Conclusão", dataHora: "2026-08-20T17:57:50.000Z" },
                  { codigo: 581, nome: "Documento", dataHora: "20260810093000", complementosTabelados: [{ nome: "Petição", descricao: "tipo_de_documento" }] },
                  { codigo: 51, nome: "Conclusão", dataHora: "2026-08-20T17:57:50.000Z" },
                  { nome: "Sem data" },
                ],
              },
            },
            { _source: { numeroProcesso: "99999999999999999999", movimentos: [{ codigo: 1, nome: "Outro processo", dataHora: "2026-08-01" }] } },
          ],
        },
      });
    });
    expect(sent?.url).toBe("https://intermediario.exemplo/datajud/api_publica_tjrj");
    expect(sent?.body).toEqual({ size: 10, query: { match: { numeroProcesso: "08012345620268190001" } } });
    expect(r.found).toBe(true);
    expect(r.updatedAt).toBe("2026-09-01T10:00:00.000Z");
    expect(r.entries).toEqual([
      { date: "2026-08-10", time: "093000", name: "Documento", text: "Documento (Petição)", ref: "datajud:581:2026-08-10T093000" },
      { date: "2026-08-20", time: "175750", name: "Conclusão", text: "Conclusão", ref: "datajud:51:2026-08-20T175750" },
    ]);
    const none = await datajudMovements({ url: CONF.url, key: CONF.key }, "TJRJ", "0801234-56.2026.8.19.0001", async () => json({ hits: { hits: [] } }));
    expect(none).toEqual({ found: false, entries: [], updatedAt: undefined });
    await expect(datajudMovements({ url: CONF.url, key: CONF.key }, "TJRJ", "123", async () => json({}))).rejects.toThrow(/20 algarismos/);
  });
});
