// Teste de ponta a ponta do Analisador de Processos: usa o app como uma pessoa usaria e salva capturas de tela.
// Uso: npm run test:e2e  (gera screenshots/ e falha se algo der errado)
// Para usar um Chromium já instalado, informe o caminho em CHROMIUM_PATH.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";

const PORT = 4500 + Math.floor(Math.random() * 300);
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe", detached: true });
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes("Local") && resolve());
  server.on("exit", () => reject(new Error("preview saiu")));
  setTimeout(() => reject(new Error("preview não subiu")), 20000);
});
const URL = `http://localhost:${PORT}/`;
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const shot = async (page, name) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
};
function watch(page) {
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // respostas de erro do intermediário simulado (senha errada, de propósito) não contam como erro do app
  page.on("console", (m) => m.type() === "error" && !/intermediario\.exemplo/.test(m.location()?.url || "") && errors.push(`console: ${m.text()} (${m.location()?.url || ""})`));
}
const closed = (page) => page.locator(".overlay").first().waitFor({ state: "detached" });
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Dígito verificador CNJ (módulo 97)
function cnj(seq, year, j, tr, origin) {
  const dv = String(98n - (BigInt(seq + year + j + tr + origin + "00") % 97n)).padStart(2, "0");
  return `${seq}-${dv}.${year}.${j}.${tr}.${origin}`;
}

/** Gera um PDF com uma página para cada trecho de HTML (com os títulos como marcadores, se pedido). */
async function renderPdf(path, pages, { outline = false } = {}) {
  const page = await browser.newPage();
  await page.setContent(`<html><head><style>
    body { font-family: Arial, sans-serif; font-size: 12px; margin: 0 }
    .p { height: 1040px; position: relative; padding: 30px; box-sizing: border-box; page-break-after: always }
    .stamp { position: absolute; bottom: 20px; left: 30px; font-size: 9px }
    table { border-collapse: collapse } td, th { padding: 2px 12px 2px 0; text-align: left; vertical-align: top }
  </style></head><body>${pages.map((p) => `<div class="p">${p}</div>`).join("")}</body></html>`);
  await page.pdf({ path, format: "A4", margin: { top: 0, bottom: 0, left: 0, right: 0 }, outline, tagged: outline });
  await page.close();
}

/** PDF no formato do "processo integral" do PJe: capa com partes e índice, e o carimbo "Num. Id - Pág. n" em cada página. */
async function makeCaseFilePdf(path, number) {
  const stamp = (id, pag) => `<div class="stamp">Assinado eletronicamente por: JUIZ TESTE - 02/10/2026 16:12:00<br>Num. ${id} - Pág. ${pag}</div>`;
  const pages = [
    `<p><b>Número:</b> ${number}</p><p><b>Classe:</b> PROCEDIMENTO COMUM CÍVEL</p><p><b>Órgão julgador:</b> 5ª Vara Cível da Comarca de Mossoró</p>
     <p><b>Última distribuição :</b> 15/03/2026</p><p><b>Valor da causa:</b> R$ 35.000,00</p><p><b>Assuntos:</b> Indenização por Dano Moral</p>
     <p><b>Segredo de justiça?</b> NÃO</p><p><b>Justiça gratuita?</b> SIM</p>
     <table><tr><th>Partes</th><th>Procurador/Terceiro vinculado</th></tr>
     <tr><td>ANA CLIENTE (AUTOR)</td><td>VOCÊ ADVOGADO (ADVOGADO)</td></tr>
     <tr><td>TELEFONIA GAMA S.A. (REU)</td><td>PEDRO DEFESA (ADVOGADO)</td></tr></table>
     <p><b>Documentos</b></p>
     <table><tr><th>Id.</th><th>Data da Assinatura</th><th>Documento</th><th>Tipo</th></tr>
     <tr><td>40000001</td><td>15/03/2026 10:20</td><td>Petição Inicial</td><td>Petição Inicial</td></tr>
     <tr><td>40000002</td><td>15/03/2026 10:20</td><td>Procuração Ana</td><td>Procuração</td></tr>
     <tr><td>40000003</td><td>20/05/2026 14:00</td><td>Contestação Gama</td><td>Contestação</td></tr>
     <tr><td>40000004</td><td>02/10/2026 16:12</td><td>Despacho</td><td>Despacho</td></tr></table>`,
    `<h3>EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 5ª VARA CÍVEL DE MOSSORÓ</h3><p>ANA CLIENTE vem propor AÇÃO DE INDENIZAÇÃO POR DANOS MORAIS em face de TELEFONIA GAMA S.A., pela cobrança indevida e pela negativação do seu nome.</p>${stamp("40000001", 1)}`,
    `<p>Dos pedidos. Requer a condenação da ré ao pagamento de indenização por dano moral e a exclusão da negativação.</p>${stamp("40000001", 2)}`,
    `<h3>PROCURAÇÃO</h3><p>Outorgante: ANA CLIENTE. Outorgado: VOCÊ ADVOGADO.</p>${stamp("40000002", 1)}`,
    `<h3>CONTESTAÇÃO</h3><p>TELEFONIA GAMA S.A. sustenta a regularidade da cobrança e a inexistência de dano moral.</p>${stamp("40000003", 1)}`,
    `<h3>DESPACHO</h3><p>Intime-se a parte autora para, no prazo de 15 (quinze) dias, apresentar réplica à contestação, devendo juntar o extrato atualizado do SPC e comprovante de residência atualizado.</p><p>Após, conclusos.</p>${stamp("40000004", 1)}`,
  ];
  await renderPdf(path, pages);
}

/** PDF no formato do processo completo do eproc: capa com "Partes e Representantes" e eventos, e o carimbo do evento em cada página. */
async function makeEprocPdf(path, number) {
  const stamp = (ev, doc, pag) => `<div class="stamp">Processo ${number}/RS, Evento ${ev}, ${doc}, Página ${pag}</div>`;
  const pages = [
    `<p><b>Nº do processo:</b> ${number}</p><p><b>Classe da ação:</b> PROCEDIMENTO COMUM</p><p><b>Data de autuação:</b> 12/01/2026 09:15:00</p>
     <p><b>Órgão Julgador:</b> Juízo Federal da 1ª VF de Porto Alegre</p><p><b>Nível de sigilo do processo:</b> Sem Sigilo (Nível 0)</p>
     <p><b>Assuntos</b></p>
     <table><tr><th>Código</th><th>Descrição</th><th>Principal</th></tr><tr><td>6114</td><td>Aposentadoria por Tempo de Contribuição (Art. 55/6)</td><td>Sim</td></tr></table>
     <p><b>Partes e Representantes</b></p>
     <table style="font-size: 11px"><tr><th>AUTOR</th><th>RÉU</th></tr>
     <tr><td>JOÃO SEGURADO (123.456.789-09)<br>Procurador(es):<br>VOCÊ ADVOGADO (RS012345)</td>
     <td>INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS (29.979.036/0001-40)<br>Procurador(es):<br>PROCURADORIA REGIONAL FEDERAL DA 4ª REGIÃO (RS000001)</td></tr></table>
     <p><b>Informações Adicionais</b></p><p>Justiça Gratuita: Deferida</p>
     <p><b>Eventos</b></p>
     <table><tr><th>Evento</th><th>Data/Hora</th><th>Descrição</th><th>Documentos</th></tr>
     <tr><td>1</td><td>12/01/2026 09:15:00</td><td>Distribuído por sorteio</td><td>INIC1 PROC2</td></tr>
     <tr><td>15</td><td>18/05/2026 14:00:00</td><td>Juntada de Contestação</td><td>CONTES1</td></tr>
     <tr><td>22</td><td>05/10/2026 16:12:00</td><td>Despacho/Decisão</td><td>DESPADEC1</td></tr></table>`,
    `<h3>EXCELENTÍSSIMO SENHOR JUIZ FEDERAL DA 1ª VARA FEDERAL DE PORTO ALEGRE</h3><p>JOÃO SEGURADO vem propor AÇÃO PREVIDENCIÁRIA em face do INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS, para obter a aposentadoria por tempo de contribuição.</p>${stamp(1, "INIC1", 1)}`,
    `<p>Dos pedidos. Requer a concessão do benefício desde o requerimento administrativo.</p>${stamp(1, "INIC1", 2)}`,
    `<h3>PROCURAÇÃO</h3><p>Outorgante: JOÃO SEGURADO. Outorgado: VOCÊ ADVOGADO.</p>${stamp(1, "PROC2", 1)}`,
    `<h3>CONTESTAÇÃO</h3><p>O INSS sustenta que não foi comprovado o tempo especial alegado na inicial.</p>${stamp(15, "CONTES1", 1)}`,
    `<h3>DESPACHO/DECISÃO</h3><p>Intime-se a parte autora para, no prazo de 15 (quinze) dias, apresentar réplica à contestação, devendo juntar cópia integral do processo administrativo.</p>
     <p>Documento eletrônico assinado por JUIZ FEDERAL TESTE, Juiz Federal, na forma do artigo 1º, inciso III, da Lei 11.419, de 19 de dezembro de 2006.</p>${stamp(22, "DESPADEC1", 1)}`,
  ];
  await renderPdf(path, pages);
}

/**
 * PDF no formato do eproc do TJRJ: folha de rosto, capa com uma coluna por polo (e o Ministério Público à parte),
 * página de separação antes de cada evento, carimbo no alto de cada página, códigos como "PED LIMINAR_ANT TUTE1" e um
 * marcador por documento ("Evento 3 - Doc. 1 - DESPACHO/DECISÃO").
 */
async function makeEprocRjPdf(path, number) {
  const stamp = (ev, doc, pag) => `<div style="font-size: 9px; margin-bottom: 8px">Processo ${number}/RJ, Evento ${ev}, ${doc}, Página ${pag}</div>`;
  const mark = (ev, n, label) => `<h2 style="font-size: 10px; margin: 0 0 8px">Evento ${ev} - Doc. ${n} - ${label}</h2>`;
  const separator = (ev, description, date) =>
    ["PÁGINA DE SEPARAÇÃO", "(Gerada automaticamente pelo sistema.)", `Evento ${ev}`, "Evento:", description, "Data:", `${date} 10:00:00`, "Usuário:", "SISTEMA", "Processo:", `${number}/RJ`, "Sequência Evento:", ev]
      .map((l) => `<p>${l}</p>`)
      .join("");
  const pages = [
    `<p>Tipo documento: CAPA PROCESSO</p><p>Evento: abertura</p><p>PROCESSO</p><p>Nº ${number}</p><p>Capa: Parte 1</p>`,
    `<p>Nº do processo ${number}</p><p>Classe da ação: Procedimento Comum Cível</p><p>Data de autuação: 02/03/2026 10:00:00</p>
     <p>Órgão Julgador: Juízo da 1ª Vara Cível da Comarca de Exemplo</p>
     <p><b>Assuntos</b></p>
     <table><tr><th>Código</th><th>Descrição</th><th>Principal</th></tr><tr><td>1504050102</td><td>Tratamento médico-hospitalar, DIREITO DA SAÚDE</td><td>Sim</td></tr></table>
     <p><b>Partes e Representantes</b></p>
     <table style="width: 100%; font-size: 11px">
       <tr><th style="width: 50%; text-align: center">REQUERENTE</th><th style="text-align: center">REQUERIDO</th></tr>
       <tr><td style="padding-top: 5px">LÚCIA PACIENTE (123.456.789-09) - Pessoa Física<br>VOCÊ ADVOGADO RJ123456</td>
         <td>MUNICÍPIO DE EXEMPLO (11.222.333/0001-81) - Entidade<br>Procurador(es):<br>CARLOS PROCURADOR MUNICIPAL PGM123456<br>ESTADO EXEMPLAR (22.333.444/0001-55) - Entidade<br>Procurador(es):<br>DIANA PROCURADORA ESTADUAL PGE7654321</td></tr>
       <tr><th colspan="2" style="text-align: center; padding-top: 8px">MINISTÉRIO PÚBLICO</th></tr>
       <tr><td colspan="2" style="text-align: center">MINISTÉRIO PÚBLICO DO ESTADO EXEMPLAR (33.444.555/0001-66)</td></tr>
     </table>
     <p><b>Informações Adicionais</b></p>
     <p>Chave Processo: 123456789012 &nbsp; Valor da Causa: R$ 50.000,00 &nbsp; Nível de Sigilo do Processo: Sem Sigilo (Nível 0)</p><p>Justiça Gratuita: Deferida</p>`,
    separator(1, "DISTRIBUIDO POR SORTEIO EXE01VCIV1J", "02/03/2026"),
    `${stamp(1, "INIC1", 1)}${mark(1, 1, "PETIÇÃO INICIAL")}<p>EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO</p>
     <p>LÚCIA PACIENTE vem propor ação de obrigação de fazer em face do MUNICÍPIO DE EXEMPLO e do ESTADO EXEMPLAR, para obter o tratamento prescrito.</p>`,
    `${stamp(1, "INIC1", 2)}<p>Dos pedidos. Requer a tutela de urgência para o fornecimento do tratamento.</p>`,
    `${stamp(1, "PROC2", 1)}${mark(1, 2, "PROCURAÇÃO")}<p>PROCURAÇÃO</p><p>Outorgante: LÚCIA PACIENTE. Outorgado: VOCÊ ADVOGADO.</p>`,
    separator(2, "AUTOS INCLUIDOS NO JUIZO 100 DIGITAL", "02/03/2026"),
    separator(3, "DECISAO INTERLOCUTORIA", "05/03/2026"),
    `${stamp(3, "DESPADEC1", 1)}${mark(3, 1, "DESPACHO/DECISÃO")}<p>Defiro a tutela de urgência para determinar aos réus o fornecimento do tratamento, no prazo de 5 (cinco) dias.</p>
     <p>Documento assinado eletronicamente por JUÍZA FICTÍCIA, Juíza de Direito , em 05/03/2026, às 18:00:00, conforme art. 1º, III, informando o código verificador 190000000001v1 e o código CRC abcdef12.</p>`,
    separator(4, "PETICAO PEDIDO DE LIMINARANTECIPACAO DE TUTELA", "10/03/2026"),
    `${stamp(4, "PED LIMINAR_ANT TUTE1", 1)}${mark(4, 1, "PEDIDO DE LIMINAR/ANTECIPAÇÃO DE TUTELA")}<p>Requer a intimação dos réus para cumprir a tutela deferida.</p>`,
  ];
  await renderPdf(path, pages, { outline: true });
}

const ACORDAO = `Superior Tribunal de Justiça
AgInt no AGRAVO EM RECURSO ESPECIAL Nº 2.345.678 - RN (2025/0123456-7)
RELATOR : MINISTRO JOÃO EXEMPLO
AGRAVANTE : TELEFONIA GAMA S.A.
ADVOGADO : PEDRO DEFESA - RN001111
AGRAVADO : CARLOS TESTE
ADVOGADO : VOCÊ ADVOGADO - RN002222
EMENTA
AGRAVO INTERNO NO AGRAVO EM RECURSO ESPECIAL. COBRANÇA INDEVIDA DE SERVIÇOS DE TELEFONIA. NEGATIVAÇÃO. DANO MORAL CONFIGURADO. AGRAVO INTERNO NÃO PROVIDO.
1. A inscrição indevida em cadastro de inadimplentes, decorrente de cobrança de serviço não contratado, gera dano moral presumido.
2. Agravo interno a que se nega provimento.
ACÓRDÃO
Vistos e relatados estes autos, acordam os Ministros da QUARTA TURMA do Superior Tribunal de Justiça, por unanimidade, negar provimento ao agravo interno.
Brasília, 03 de março de 2026(Data do Julgamento)`;

const PETICAO = `Nesse sentido:

"AGRAVO INTERNO NO AGRAVO EM RECURSO ESPECIAL. COBRANÇA INDEVIDA DE SERVIÇOS DE TELEFONIA. [...] 1. A inscrição indevida em cadastro de inadimplentes gera sempre dano moral presumido."
(STJ, AgInt no AREsp 2.345.678/RN, Rel. Min. João Exemplo, Quarta Turma, j. 03/03/2026, DJe 06/03/2026)

Também: STJ, REsp 1.111.111/SP, Rel. Min. Fulano Beltrano, Sétima Turma, j. 10/10/2023, DJe 05/10/2023.

Aplica-se a Súmula 297 do STJ e, por analogia, a Súmula 800 do STF.`;

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "pt-BR", reducedMotion: "reduce", acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(URL);
  await page.getByText("Boas-vindas ao Analisador de Processos").waitFor();
  await shot(page, "01-boas-vindas");

  // exemplo: dois processos fictícios com prazos, documentos e súmulas
  await page.getByRole("button", { name: /Ver um exemplo/ }).click();
  await page.getByRole("heading", { name: "Maria Exemplo x Banco Alfa (exemplo)" }).waitFor();
  await page.getByText(/parece pedir "Réplica"|Réplica/).first().waitFor();
  await shot(page, "02-processo-resumo");

  await page.getByRole("tab", { name: /Expedientes e prazos/ }).click();
  await page.getByText("Documentos para instruir a petição").first().waitFor();
  await page.getByText("Expedientes por parte").waitFor();
  expect((await page.locator(".by-party tbody tr").count()) === 1, "o resumo por parte deveria listar a cliente");
  await page.getByRole("button", { name: /Memória de cálculo/ }).first().click();
  await page.getByText(/Publicação: primeiro dia útil seguinte/).waitFor();
  await shot(page, "03-processo-prazos");

  await page.goto(URL + "#/");
  await page.getByText("Próximos prazos").waitFor();
  await shot(page, "04-painel");

  // processo integral do PJe
  const number = cnj("0805555", "2026", "8", "20", "5106");
  const pdfPath = `${OUT}/processo-integral.pdf`;
  await makeCaseFilePdf(pdfPath, number);
  expect(statSync(pdfPath).size > 1000, "PDF de teste não foi gerado");
  await page.goto(URL + "#/processos");
  await page.getByRole("button", { name: /Importar PDF do processo/ }).click();
  await page.locator(".modal input[type=file]").setInputFiles(pdfPath);
  await page.getByText("Conferir o processo").waitFor();
  await page.getByText("Partes encontradas: quem é o seu cliente?").waitFor();
  expect(await page.getByText(number).count(), "número do processo não foi lido da capa");
  expect((await page.locator(".doc-preview-row").count()) === 5, `esperava 5 documentos, veio ${await page.locator(".doc-preview-row").count()}`);
  await shot(page, "05-importar-processo-integral");
  await page.getByRole("button", { name: "Criar o processo" }).click();
  await closed(page);
  await page.getByRole("heading", { name: "Ana Cliente x Telefonia Gama S.A." }).waitFor();
  // o último despacho ainda não tem expediente: o resumo avisa o que ele pede
  await page.getByRole("tab", { name: /Resumo/ }).click();
  await page.getByText(/parece pedir "Réplica"/).waitFor();
  await shot(page, "06-resumo-com-sugestao");
  await page.getByRole("tab", { name: /Documentos/ }).click();
  await page.getByRole("button", { name: /\d+ documentos/ }).click();
  await page.getByText("Contestação Gama").waitFor();
  await shot(page, "07-documentos");

  // pesquisa nos documentos do processo
  await page.getByLabel("Pesquisar nos documentos do processo").fill("negativação");
  await page.locator(".result").first().waitFor();
  await shot(page, "08-pesquisa-no-processo");
  await page.locator(".result").first().click();
  await page.locator("mark.hit").first().waitFor();
  await page.getByRole("button", { name: "Fechar" }).click();
  await closed(page);

  // o despacho pede réplica: registra o expediente a partir do documento
  await page.getByLabel("Pesquisar nos documentos do processo").fill("");
  const despacho = page.locator(".doc-row", { hasText: "Despacho" }).first();
  await despacho.getByRole("button", { name: /Analisar/ }).click();
  await page.getByText("Exige petição: Réplica").waitFor();
  expect((await page.locator(".draft-item input").count()) >= 2, "documentos pedidos no despacho não viraram itens");
  await shot(page, "09-expediente-analisado");
  await page.getByRole("button", { name: "Salvar" }).click();
  await closed(page);
  await page.getByRole("tab", { name: /Expedientes e prazos/ }).click();
  await page.getByText("Extrato atualizado do SPC", { exact: true }).waitFor();

  // processo completo do eproc: a capa tem "Partes e Representantes" e cada página traz o evento e o documento
  const eprocNumber = cnj("5004321", "2026", "4", "04", "7100");
  const eprocPath = `${OUT}/processo-eproc.pdf`;
  await makeEprocPdf(eprocPath, eprocNumber);
  await page.goto(URL + "#/processos");
  await page.getByRole("button", { name: /Importar PDF do processo/ }).click();
  await page.locator(".modal input[type=file]").setInputFiles(eprocPath);
  await page.getByText("Conferir o processo").waitFor();
  expect(await page.getByText(eprocNumber).count(), "número do processo não foi lido da capa do eproc");
  const eprocRows = await page.locator(".doc-preview-row").allInnerTexts();
  expect(eprocRows.length === 5, `eproc: esperava 5 documentos, veio ${eprocRows.length}`);
  expect(eprocRows.some((r) => r.includes("Evento 15, CONTES1") && r.includes("18/05/2026")), `eproc: contestação sem evento ou data: ${eprocRows.join(" | ")}`);
  await page.getByText(/procurador: Procuradoria Regional Federal da 4ª Região \(RS000001\)/).waitFor();
  await shot(page, "09b-importar-eproc");
  await page.getByRole("button", { name: "Criar o processo" }).click();
  await closed(page);
  await page.getByRole("heading", { name: "João Segurado x Instituto Nacional do Seguro Social - INSS" }).waitFor();
  await page.getByRole("tab", { name: /Resumo/ }).click();
  await page.getByText(/parece pedir "Réplica"/).waitFor();
  await page.getByRole("tab", { name: /Documentos/ }).click();
  await page.getByRole("button", { name: /\d+ documentos/ }).click();
  await page.getByText("Evento 22, DESPADEC1").waitFor();
  await shot(page, "09c-documentos-eproc");

  // eproc do TJRJ: partes em colunas (o polo vem da posição na capa), páginas de separação e eventos nos andamentos
  const rjNumber = cnj("3001234", "2026", "8", "19", "0001");
  const rjPath = `${OUT}/processo-eproc-rj.pdf`;
  await makeEprocRjPdf(rjPath, rjNumber);
  await page.goto(URL + "#/processos");
  await page.getByRole("button", { name: /Importar PDF do processo/ }).click();
  await page.locator(".modal input[type=file]").setInputFiles(rjPath);
  await page.getByText("Conferir o processo").waitFor();
  const rjRows = await page.locator(".doc-preview-row").allInnerTexts();
  expect(rjRows.length === 5, `eproc RJ: esperava 5 documentos, veio ${rjRows.length}: ${rjRows.join(" | ")}`);
  expect(
    rjRows.some((r) => r.includes("Decisão interlocutória (DESPADEC1)") && r.includes("Evento 3, DESPADEC1") && r.includes("05/03/2026")),
    `eproc RJ: decisão sem nome, evento ou data: ${rjRows.join(" | ")}`,
  );
  expect(rjRows.some((r) => r.includes("Pedido de liminar/antecipação de tutela") && r.includes("Evento 4, PED LIMINAR_ANT TUTE1")), `eproc RJ: pedido de liminar: ${rjRows.join(" | ")}`);
  const parties = (await page.locator(".client-pick label").allInnerTexts()).map((p) => p.replace(/\s+/g, " ").trim());
  expect(
    parties.some((p) => /^Município de Exemplo \(Requerido · polo passivo\) · ente público, prazo em dobro · procurador: Carlos Procurador Municipal \(PGM123456\)/.test(p)),
    `eproc RJ: município fora do polo passivo ou sem procurador: ${parties.join(" | ")}`,
  );
  expect(parties.some((p) => /^Lúcia Paciente \(Requerente · polo ativo\) · procurador: Você Advogado \(RJ123456\)/.test(p)), `eproc RJ: requerente: ${parties.join(" | ")}`);
  expect(parties.some((p) => p.startsWith("Ministério Público do Estado Exemplar (Ministério Público")), `eproc RJ: Ministério Público: ${parties.join(" | ")}`);
  await page.getByText("4 movimentações (eventos) entram nos andamentos do processo.").waitFor();
  await shot(page, "09d-importar-eproc-rj");
  await page.getByRole("button", { name: "Criar o processo" }).click();
  await closed(page);
  await page.getByRole("heading", { name: "Lúcia Paciente x Município de Exemplo" }).waitFor();
  await page.getByRole("tab", { name: /Andamentos/ }).click();
  await page.getByText("Evento 2: Autos incluídos no juízo 100% digital").waitFor();
  await page.getByRole("button", { name: "Evento 3: Decisão interlocutória" }).waitFor();
  await shot(page, "09e-andamentos-eproc-rj");

  // PDF de outro sistema, sem carimbo: os marcadores (índice) do PDF separam os documentos
  const marksPath = `${OUT}/processo-marcadores.pdf`;
  await renderPdf(
    marksPath,
    [
      `<h1>Petição inicial</h1><h2>Dos fatos</h2><p>A autora contratou o serviço e foi cobrada em duplicidade.</p>`,
      `<h2>Dos pedidos</h2><p>Requer a devolução em dobro.</p>`,
      `<h1>Sentença</h1><p>Ante o exposto, julgo procedente o pedido.</p>`,
    ],
    { outline: true },
  );
  await page.goto(URL + "#/processos");
  await page.getByRole("button", { name: /Importar PDF do processo/ }).click();
  await page.locator(".modal input[type=file]").setInputFiles(marksPath);
  await page.getByText("Conferir o processo").waitFor();
  const markRows = await page.locator(".doc-preview-row").allInnerTexts();
  expect(
    markRows.length === 2 && markRows[0].includes("Petição inicial") && markRows[0].includes("p. 1–2") && markRows[1].includes("Sentença"),
    `marcadores: documentos inesperados: ${markRows.join(" | ")}`,
  );
  await page.getByRole("button", { name: "Fechar" }).click();
  await closed(page);

  // jurisprudência: cola o acórdão e confere as partes
  await page.goto(URL + "#/jurisprudencia");
  await page.getByRole("button", { name: /Nova jurisprudência/ }).click();
  await page.getByPlaceholder(/RECURSO ESPECIAL/).fill(ACORDAO);
  await page.getByRole("button", { name: "Ler e preencher" }).click();
  expect((await page.locator(".modal input[list=classes]").inputValue()) === "AgInt no AREsp", "classe não foi lida");
  expect((await page.locator(".party-form").count()) === 2, "partes não foram identificadas");
  await page.getByRole("textbox", { name: "Fonte" }).fill("DJe");
  await page.locator(".modal input[type=date]").nth(1).fill("2026-03-06");
  await page.getByText(/Conferi os dados na fonte oficial/).click();
  await shot(page, "10-nova-jurisprudencia");
  await page.getByRole("button", { name: "Salvar" }).click();
  await closed(page);
  await page.getByText("Parte em comum com os seus processos").waitFor();
  await shot(page, "11-jurisprudencia");

  // verificação de citações
  await page.goto(URL + "#/citacoes");
  await page.getByPlaceholder(/Cole aqui a petição/).fill(PETICAO);
  await page.getByRole("button", { name: "Verificar" }).click();
  await page.locator(".check-card").first().waitFor();
  const levels = await page.locator(".check-card").evaluateAll((els) => els.map((e) => [...e.classList].find((c) => c.startsWith("level-"))));
  expect(
    JSON.stringify(levels) === JSON.stringify(["level-alerta", "level-erro", "level-ok", "level-erro"]),
    `níveis inesperados: ${JSON.stringify(levels)}`,
  );
  await page.locator(".diff").first().waitFor();
  await shot(page, "12-verificar-citacoes");

  // prazos, calculadora e exportação para a agenda
  await page.goto(URL + "#/prazos");
  await page.getByText("Prazos e audiências").first().waitFor();
  await shot(page, "13-prazos");
  const [ics] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Exportar para a agenda/ }).click()]);
  const icsText = readFileSync(await ics.path(), "utf8");
  expect(icsText.includes("BEGIN:VEVENT") && icsText.includes("Réplica"), "arquivo .ics sem os prazos");
  await page.getByRole("button", { name: /Calculadora/ }).click();
  await page.getByText(/Vencimento:/).waitFor();
  await shot(page, "14-calculadora");
  await page.getByRole("button", { name: "Fechar" }).click();

  // cópia de segurança
  await page.goto(URL + "#/configuracoes");
  const [zip] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Fazer cópia de segurança/ }).click()]);
  expect(statSync(await zip.path()).size > 2000, "cópia de segurança vazia");
  await shot(page, "15-configuracoes");

  // feriado local do TJRN no dia do vencimento: o prazo passa para o próximo dia útil
  await page.goto(URL + "#/prazos");
  const recurso = page.locator(".agenda-row", { hasText: "Recurso inominado" });
  const before = (await recurso.locator(".date-tile").innerText()).replace(/\s+/g, " ");
  const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const [mon, day] = before.split(" ");
  const year = new Date().getFullYear() + (MONTHS.indexOf(mon) < new Date().getMonth() ? 1 : 0);
  const dueISO = `${year}-${String(MONTHS.indexOf(mon) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  await page.goto(URL + "#/configuracoes");
  await page.locator(".holiday-form input[type=date]").first().fill(dueISO);
  await page.getByPlaceholder(/feriado municipal/).fill("Feriado municipal (teste)");
  await page.getByPlaceholder("TJRN, TRT21").fill("TJRN");
  await page.getByRole("button", { name: "Incluir" }).click();
  await page.getByText("Feriado municipal (teste)").first().waitFor();
  await page.goto(URL + "#/prazos");
  const after = (await page.locator(".agenda-row", { hasText: "Recurso inominado" }).locator(".date-tile").innerText()).replace(/\s+/g, " ");
  expect(before !== after, `o feriado local não mudou o vencimento (${before} → ${after})`);

  // anotação nos andamentos e cadastro manual de processo
  await page.goto(URL + "#/processos");
  await page.getByText("Ana Cliente x Telefonia Gama S.A.").click();
  await page.getByRole("tab", { name: /Andamentos/ }).click();
  await page.getByRole("button", { name: /Nova anotação/ }).click();
  await page.getByLabel(/Anotação/).fill("Cliente avisada da réplica por telefone.");
  await page.getByRole("button", { name: "Salvar" }).click();
  await closed(page);
  await page.getByText("Cliente avisada da réplica por telefone.").waitFor();
  await page.locator(".timeline").getByRole("button", { name: "Despacho", exact: true }).waitFor();
  await shot(page, "16-andamentos");

  await page.goto(URL + "#/processos");
  await page.getByRole("button", { name: /Novo processo/ }).click();
  const num = page.getByPlaceholder("0801234-56.2023.8.20.5001");
  await num.fill("0801234-00.2026.8.26.0100");
  await page.getByText(/Dígito verificador não confere/).waitFor();
  await num.fill(cnj("1004321", "2026", "8", "26", "0100"));
  await page.getByText(/Número válido · TJSP/).waitFor();
  const names = page.getByLabel("Nome da parte");
  await names.nth(0).fill("Bruno Cliente");
  await names.nth(1).fill("Construtora Delta Ltda.");
  await page.getByPlaceholder(/Ex.: 3ª Vara/).fill("2ª Vara Cível do Foro Central");
  await shot(page, "17-novo-processo");
  await page.getByRole("button", { name: "Salvar" }).click();
  await closed(page);
  await page.getByRole("heading", { name: "Bruno Cliente x Construtora Delta Ltda." }).waitFor();

  // verificar as citações da contestação do exemplo, a partir do documento
  await page.goto(URL + "#/processos");
  await page.getByText("Maria Exemplo x Banco Alfa (exemplo)").click();
  await page.getByRole("tab", { name: /Documentos/ }).click();
  await page.locator(".doc-row", { hasText: "Contestação" }).locator(".doc-main").click();
  await page.getByRole("button", { name: /Verificar citações/ }).click();
  await page.locator(".check-card").first().waitFor();
  expect((await page.locator(".check-card.level-erro").count()) === 1, "a citação fictícia da contestação deveria apontar erro");
  expect((await page.locator(".check-card.level-ok").count()) === 1, "a Súmula 385 do STJ deveria conferir com a base");

  // apagar tudo e restaurar a cópia de segurança
  await page.goto(URL + "#/configuracoes");
  await page.getByRole("button", { name: /Apagar todos os dados/ }).click();
  await page.getByRole("button", { name: "Apagar tudo", exact: true }).click();
  await page.goto(URL + "#/");
  await page.getByText("Boas-vindas ao Analisador de Processos").waitFor();
  await page.goto(URL + "#/configuracoes");
  await page.locator("input[type=file][accept*=zip]").setInputFiles(await zip.path());
  await page.getByRole("button", { name: "Restaurar", exact: true }).click();
  await page.getByText("Cópia restaurada.").waitFor();

  // os dados ficam no aparelho: recarrega e continua tudo lá
  await page.reload();
  await page.goto(URL + "#/processos");
  await page.getByText("Ana Cliente x Telefonia Gama S.A.").waitFor();
  expect((await page.locator(".case-row").count()) === 5, "processos não ficaram guardados");
  await page.getByText("Ana Cliente x Telefonia Gama S.A.").click();
  await page.getByRole("tab", { name: /Documentos/ }).click();
  await page.getByLabel("Pesquisar nos documentos do processo").fill("negativação");
  await page.locator(".result").first().waitFor();

  // busca no DJEN e no DataJud pelo intermediário (simulado aqui, com dados fictícios)
  const novo = cnj("0809999", "2026", "8", "19", "0001");
  const cnjCalls = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "x-chave, content-type", "access-control-allow-methods": "GET, POST" };
  const reply = (route, status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  const djenItem = (id, numero, nome, polo, texto, tipoDocumento = "Despacho") => ({
    id,
    data_disponibilizacao: "2026-10-28",
    siglaTribunal: numero === novo ? "TJRJ" : "TJRN",
    tipoComunicacao: "Intimação",
    tipoDocumento,
    nomeOrgao: numero === novo ? "3ª Vara Cível da Comarca de Exemplo" : "5ª Vara Cível da Comarca de Mossoró",
    nomeClasse: "PROCEDIMENTO COMUM CíVEL",
    texto,
    numeroprocessocommascara: numero,
    meio: "D",
    ativo: true,
    destinatarios: [{ nome, polo }],
    destinatarioadvogados: [{ advogado: { nome: "VOCÊ ADVOGADO", numero_oab: "123456", uf_oab: "RJ" } }],
  });
  await page.route("https://intermediario.exemplo/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.headers()["x-chave"] !== "senha-teste") return reply(route, 401, { erro: "Senha ausente ou errada." });
    const u = new globalThis.URL(req.url());
    cnjCalls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams) });
    if (u.pathname === "/djen")
      return reply(route, 200, {
        status: "success",
        items:
          u.searchParams.get("dataDisponibilizacaoInicio") === u.searchParams.get("dataDisponibilizacaoFim")
            ? []
            : [
                djenItem(9001, novo, "CARLOS NOVO CLIENTE", "A", "Intime-se a parte autora para, no prazo de 15 (quinze) dias, apresentar réplica à contestação."),
                djenItem(9002, number, "ANA CLIENTE", "A", "Intime-se a parte autora para se manifestar sobre o laudo pericial, no prazo de 15 dias."),
              ],
      });
    if (u.pathname === "/datajud/api_publica_tjrj")
      return reply(route, 200, {
        hits: {
          hits: [
            {
              _source: {
                numeroProcesso: novo.replace(/\D/g, ""),
                dataHoraUltimaAtualizacao: "2026-10-30T10:00:00.000Z",
                movimentos: [
                  { codigo: 26, nome: "Distribuição", dataHora: "2026-10-01T09:00:00.000Z" },
                  { codigo: 51, nome: "Conclusão", dataHora: "2026-10-27T15:30:00.000Z" },
                ],
              },
            },
          ],
        },
      });
    return reply(route, 404, { erro: "Caminho desconhecido." });
  });
  await page.goto(URL + "#/configuracoes");
  await page.getByLabel("Endereço do intermediário").fill("https://intermediario.exemplo/");
  await page.getByLabel("Senha do intermediário").fill("senha-errada");
  await page.getByLabel("OAB (número)").fill("123456");
  await page.getByLabel("UF da OAB").selectOption("RJ");
  await page.getByRole("button", { name: "Testar a conexão" }).click();
  await page.getByText(/O intermediário recusou a senha/).waitFor();
  await page.getByLabel("Senha do intermediário").fill("senha-teste");
  await page.getByRole("button", { name: "Testar a conexão" }).click();
  await page.getByText(/Conexão funcionando/).waitFor();
  await page.getByRole("button", { name: "Buscar intimações agora" }).click();
  await page.getByText(/2 comunicações encontradas; 2 intimações novas registradas, 1 processo cadastrado/).waitFor();
  const busca = cnjCalls.filter((c) => c.path === "/djen").at(-1).q;
  expect(busca.numeroOab === "123456" && busca.ufOab === "RJ" && busca.itensPorPagina === "100", `consulta ao DJEN inesperada: ${JSON.stringify(busca)}`);
  await shot(page, "24-busca-djen");

  // as intimações registradas pedem conferência: a do processo novo traz a réplica com 15 dias
  await page.goto(URL + "#/");
  await page.getByText("2 intimações do DJEN para conferir.").waitFor();
  await shot(page, "25-painel-djen");
  await page.locator(".banner-actions button", { hasText: "Carlos Novo Cliente" }).click();
  await page.getByText(/Registrado pela busca no DJEN/).waitFor();
  expect((await page.getByRole("textbox", { name: "Ato a praticar", exact: true }).inputValue()) === "Réplica", "ato da intimação do DJEN não foi lido");
  await shot(page, "26-conferir-djen");
  await page.getByRole("button", { name: "Salvar" }).click();
  await closed(page);
  await page.getByText("1 intimação do DJEN para conferir.").waitFor();

  // andamentos do DataJud no processo cadastrado pela busca
  await page.goto(URL + "#/processos");
  await page.getByText("Carlos Novo Cliente").first().click();
  await page.getByRole("tab", { name: /Andamentos/ }).click();
  await page.getByRole("button", { name: "Atualizar andamentos (DataJud)" }).click();
  await page.getByText(/2 andamentos novos no DataJud/).waitFor();
  await page.locator(".timeline").getByText("Conclusão", { exact: true }).waitFor();
  await shot(page, "27-andamentos-datajud");
  await page.getByRole("tab", { name: /Expedientes e prazos/ }).click();
  await page.locator(".item-card", { hasText: "Réplica" }).first().waitFor();

  // tema escuro
  await page.goto(URL + "#/configuracoes");
  await page.getByRole("combobox", { name: /Tema/ }).selectOption("dark");
  await page.goto(URL + "#/");
  await page.getByText("Próximos prazos").waitFor();
  await shot(page, "18-painel-escuro");
  await page.goto(URL + "#/citacoes");
  await shot(page, "19-citacoes-escuro");

  // celular
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "pt-BR", reducedMotion: "reduce", isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  watch(m);
  await m.goto(URL);
  await m.getByRole("button", { name: /Ver um exemplo/ }).click();
  await m.getByText("Maria Exemplo x Banco Alfa (exemplo)").first().waitFor();
  await shot(m, "20-celular-processo");
  await m.goto(URL + "#/");
  await m.getByText("Próximos prazos").waitFor();
  await shot(m, "21-celular-painel");
  await m.goto(URL + "#/prazos");
  await m.locator(".agenda-row").first().waitFor();
  await shot(m, "22-celular-prazos");
  await m.locator(".agenda-main").first().click();
  await m.locator(".modal").waitFor();
  await shot(m, "23-celular-providencia");
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 0, `a página rola para o lado no celular (${overflow}px)`);

  if (errors.length) throw new Error("Erros no navegador:\n" + errors.join("\n"));
  console.log(`ok: teste de ponta a ponta do Analisador de Processos passou (capturas em ${OUT}/)`);
} catch (e) {
  console.error(e);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {
    server.kill();
  }
}
