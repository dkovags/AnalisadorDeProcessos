import { APP_NAME } from "../config";
import { cnjCheckDigits, formatCnj } from "../domain/cnj";
import { addDays, weekday } from "../domain/dates";
import * as A from "./actions";
import { newId } from "./ids";
import { run, type AppStore } from "./store";

// Dados de exemplo para conhecer o app. Pessoas e processos são fictícios; as súmulas são reais.

const DESPACHO = `PODER JUDICIÁRIO
3ª Vara Cível da Comarca de Natal

DESPACHO

Intime-se a parte autora para, no prazo de 15 (quinze) dias, apresentar réplica à contestação, devendo, no mesmo prazo, juntar extrato atualizado dos cadastros de inadimplentes e comprovante de residência atualizado.

Após, conclusos.

Natal, data da assinatura eletrônica.
Juiz de Direito (exemplo fictício)`;

const CONTESTACAO = `EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 3ª VARA CÍVEL DA COMARCA DE NATAL

BANCO ALFA S.A., já qualificado, vem apresentar CONTESTAÇÃO à ação movida por MARIA EXEMPLO.

1. A inscrição do nome da autora decorreu de dívida regular, de modo que não há dano moral a indenizar.

2. Ainda que assim não fosse, a autora possui outras anotações, o que afasta a indenização, conforme a Súmula 385 do STJ.

3. Nesse sentido: STJ, REsp 9.999.999/RN, Rel. Min. Fulano de Tal, Sétima Turma, j. 10/10/2023, DJe 05/10/2023 (citação fictícia, para mostrar a verificação).

Pede deferimento.`;

function cnj(seq: string, year: string, j: string, tr: string, origin: string) {
  return formatCnj({ seq, year, j, tr, origin, dv: cnjCheckDigits({ seq, year, j, tr, origin }) });
}

/** Próximo dia de semana (se cair no fim de semana). */
function weekdayOn(iso: string): string {
  let d = iso;
  while ([0, 6].includes(weekday(d))) d = addDays(d, 1);
  return d;
}

async function textDoc(store: AppStore, caseId: string, title: string, type: A.DocDraft["type"], date: string, text: string) {
  const id = newId("f");
  const blob = new Blob([text], { type: "text/plain" });
  await store.saveFile({ id }, blob, [text]);
  run(store, A.addDocs, {
    file: { id, name: `${title}.txt`, mime: "text/plain", size: blob.size, pageCount: 1, createdAt: new Date().toISOString() },
    caseId,
    docs: [{ title, type, date }],
    origin: "texto",
  });
}

export async function loadExample(store: AppStore, today: string): Promise<string> {
  const c1 = run(store, A.saveCase, {
    number: cnj("0809876", "2025", "8", "20", "5001"),
    title: "Maria Exemplo x Banco Alfa (exemplo)",
    court: "TJRN",
    system: "PJe",
    body: "3ª Vara Cível da Comarca de Natal",
    className: "Procedimento Comum Cível",
    subjects: "Indenização por dano moral; inscrição indevida em cadastro de inadimplentes",
    rite: "civel",
    status: "aguardando",
    value: 2000000,
    filedAt: addDays(today, -120),
    freeJustice: true,
    parties: [
      { id: "", name: "Maria Exemplo", pole: "ativo", role: "Autora", client: true, kind: "pf", lawyers: "Você (advogado da autora)" },
      { id: "", name: "Banco Alfa S.A.", pole: "passivo", role: "Réu", kind: "pj", lawyers: "Pedro Procurador (OAB/RN 0000)" },
    ],
    notes: `Processo fictício, criado para mostrar o funcionamento do ${APP_NAME}. Pode apagar quando quiser.`,
  });
  const ds1 = store.getSnapshot()!;
  const maria = ds1.cases[c1].parties.find((p) => p.client)!;
  const sent = weekdayOn(addDays(today, -14));
  await textDoc(store, c1, "Contestação", "contestacao", addDays(today, -20), CONTESTACAO);
  await textDoc(store, c1, "Despacho", "despacho", addDays(sent, -1), DESPACHO);
  const despachoId = Object.values(store.getSnapshot()!.docs).find((d) => d.caseId === c1 && d.type === "despacho")?.id;
  run(
    store,
    A.saveNotice,
    {
      caseId: c1,
      kind: "intimacao",
      channel: "djen",
      recipients: [maria.id],
      sentAt: sent,
      days: 15,
      counting: "uteis",
      act: "Réplica",
      basis: "CPC, arts. 350 e 351",
      petition: true,
      content: DESPACHO,
      docId: despachoId,
    },
    [{ title: "Réplica", kind: "peticao", basis: "CPC, arts. 350 e 351", checklist: ["Extrato atualizado dos cadastros de inadimplentes", "Comprovante de residência atualizado", "Documentos novos que respondam à defesa (CPC, art. 435)"] }],
  );
  const hearing = weekdayOn(addDays(today, 24));
  run(
    store,
    A.saveNotice,
    {
      caseId: c1,
      kind: "intimacao",
      channel: "djen",
      recipients: [],
      sentAt: weekdayOn(addDays(today, -2)),
      counting: "uteis",
      act: "Audiência de instrução e julgamento",
      content: `Fica designada audiência de instrução e julgamento para o dia ${hearing.split("-").reverse().join("/")}, às 14h00, por videoconferência.`,
      hearing: { date: hearing, time: "14:00", kind: "Audiência de instrução e julgamento", place: "Por videoconferência" },
    },
    [{ title: "Audiência de instrução e julgamento", kind: "audiencia", checklist: ["Avisar a cliente e confirmar a presença", "Rol de testemunhas (CPC, art. 357, § 4º)", "Testemunhas: intimar ou levar (CPC, art. 455)"] }],
  );

  const c2 = run(store, A.saveCase, {
    number: cnj("0801111", "2026", "8", "20", "5004"),
    title: "João Exemplo x Seguradora Beta (exemplo)",
    court: "TJRN",
    system: "PJe",
    body: "2º Juizado Especial Cível de Natal",
    className: "Procedimento do Juizado Especial Cível",
    rite: "juizado",
    status: "sentenciado",
    parties: [
      { id: "", name: "João Exemplo", pole: "ativo", role: "Autor", client: true, kind: "pf" },
      { id: "", name: "Seguradora Beta S.A.", pole: "passivo", role: "Ré", kind: "pj" },
    ],
  });
  const joao = store.getSnapshot()!.cases[c2].parties.find((p) => p.client)!;
  run(
    store,
    A.saveNotice,
    {
      caseId: c2,
      kind: "intimacao",
      channel: "sistema",
      recipients: [joao.id],
      sentAt: weekdayOn(addDays(today, -11)),
      readAt: weekdayOn(addDays(today, -10)),
      days: 10,
      counting: "uteis",
      act: "Recurso inominado",
      basis: "Lei 9.099/1995, art. 42",
      petition: true,
      content: "SENTENÇA. Ante o exposto, JULGO IMPROCEDENTE o pedido. Sem custas e honorários (Lei 9.099/1995, art. 55). Intimem-se.",
    },
    [{ title: "Recurso inominado", kind: "recurso", basis: "Lei 9.099/1995, art. 42", checklist: ["Preparo em até 48 horas depois da interposição (Lei 9.099/1995, art. 42, § 1º)"] }],
  );

  const sumulas = [
    ["297", "O Código de Defesa do Consumidor é aplicável às instituições financeiras."],
    ["479", "As instituições financeiras respondem objetivamente pelos danos gerados por fortuito interno relativo a fraudes e delitos praticados por terceiros no âmbito de operações bancárias."],
    ["385", "Da anotação irregular em cadastro de proteção ao crédito, não cabe indenização por dano moral, quando preexistente legítima inscrição, ressalvado o direito ao cancelamento."],
  ];
  for (const [number, summary] of sumulas) {
    const ds = store.getSnapshot()!;
    if (A.findPrecedent(ds, { court: "STJ", className: "Súmula", number })) continue;
    run(store, A.savePrecedent, {
      court: "STJ",
      className: "Súmula",
      number,
      body: "Segunda Seção",
      summary,
      binding: "sumula",
      standing: "vigente",
      parties: [],
      topics: ["consumidor", "instituições financeiras"],
      caseIds: [c1],
    });
  }
  return c1;
}
