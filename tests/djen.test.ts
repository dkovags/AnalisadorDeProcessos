import { describe, expect, it } from "vitest";
import { cnjCheckDigits, formatCnj } from "../src/domain/cnj";
import * as A from "../src/store/actions";
import { MemoryPersistence } from "../src/store/persistence";
import { AppStore } from "../src/store/store";

// Comunicações e movimentações fictícias, no formato já lido pelo app (store/cnjapi).

let seq = 0;
const ctx = (today = "2026-10-31"): A.Ctx => ({ now: `${today}T12:00:00.000Z`, today, id: (p = "") => `${p}${++seq}` });

function exec<T, Args extends unknown[]>(store: AppStore, action: (ds: never, c: A.Ctx, ...a: Args) => A.Result<T>, ...args: Args): T {
  const { ops, value } = (action as unknown as (ds: unknown, c: A.Ctx, ...a: Args) => A.Result<T>)(store.getSnapshot(), ctx(), ...args);
  store.commit(ops);
  return value;
}

async function setup() {
  const store = new AppStore(new MemoryPersistence());
  await store.load();
  return store;
}

/** Número CNJ válido (com o dígito verificador certo). */
const cnj = (seqN: string, j: string, tr: string, origin: string) => {
  const c = { seq: seqN, year: "2026", j, tr, origin };
  return formatCnj({ ...c, dv: cnjCheckDigits(c) });
};

const N1 = cnj("0801234", "8", "19", "0001");
const N2 = cnj("0100200", "5", "01", "0011");
const N3 = cnj("0800300", "8", "19", "0002");

const djen = (id: string, number: string, extra: Partial<A.DjenNotice> = {}): A.DjenNotice => ({
  id,
  date: "2026-10-28",
  number,
  court: "TJRJ",
  kind: "Intimação",
  docKind: "Despacho",
  body: "1ª Vara Cível da Comarca de Exemplo",
  className: "PROCEDIMENTO COMUM CíVEL",
  edital: false,
  text: "Intime-se a parte autora para, no prazo de 15 (quinze) dias, apresentar réplica à contestação.",
  recipients: [
    { name: "ANA FICTICIA", pole: "ativo" },
    { name: "MUNICIPIO DE EXEMPLO", pole: "passivo" },
  ],
  lawyers: [{ name: "ADVOGADO TESTE", oab: "123456", uf: "RJ" }],
  cancelled: false,
  ...extra,
});

describe("intimações do DJEN", () => {
  it("registra cada intimação como expediente a conferir, com o ato, o prazo e a providência", async () => {
    const store = await setup();
    const caseId = exec(store, A.saveCase, {
      number: N1,
      rite: "civel",
      status: "ativo",
      parties: [
        { id: "", name: "Ana Fictícia", pole: "ativo", client: true },
        { id: "", name: "Município de Exemplo", pole: "passivo", kind: "publico", doubleTerm: true },
      ],
    });
    const r = exec(store, A.importDjen, [djen("1", N1)], { day: "2026-10-31" });
    expect(r).toEqual({ notices: 1, cases: 0, events: 0, skipped: 0, failed: 0 });
    const ds = store.getSnapshot()!;
    const [n] = Object.values(ds.notices);
    expect(n).toMatchObject({ caseId, kind: "intimacao", channel: "djen", sentAt: "2026-10-28", act: "Réplica", days: 15, counting: "uteis", ref: "djen:1", review: true });
    // a cliente foi intimada junto com o Município: o prazo dela é simples
    expect(n.double).toBeFalsy();
    expect(n.recipients).toEqual(ds.cases[caseId].parties.map((p) => p.id));
    expect(n.content).toMatch(/^Tipo de comunicação: Intimação \(Despacho\)\nProcesso: .* \(Procedimento Comum Cível\)\nÓrgão: 1ª Vara Cível/);
    expect(n.content).toContain("Destinatários: ANA FICTICIA (polo ativo); MUNICIPIO DE EXEMPLO (polo passivo)");
    expect(Object.values(ds.tasks).map((t) => [t.title, t.noticeId])).toEqual([["Réplica", n.id]]);
    expect(ds.prefs.cnj).toMatchObject({ lastRun: "2026-10-31", lastCount: 1 });

    // salvar o expediente conferido mantém a origem: a busca seguinte não repete
    exec(store, A.reviewNotice, n.id);
    expect(store.getSnapshot()!.notices[n.id]).toMatchObject({ review: undefined, ref: "djen:1" });
    expect(exec(store, A.importDjen, [djen("1", N1)])).toMatchObject({ notices: 0, skipped: 1 });
  });

  it("cadastra o processo que não está na base, com as partes, o cliente e o rito", async () => {
    const store = await setup();
    const r = exec(store, A.importDjen, [
      djen("2", N2, {
        court: "TRT1",
        body: "1ª Vara do Trabalho de Exemplo",
        className: "AçãO TRABALHISTA - RITO ORDINáRIO",
        docKind: "Notificação",
        text: "Fica a parte reclamante notificada para, no prazo de 8 dias, manifestar-se sobre os documentos juntados.",
        recipients: [{ name: "CARLOS NOVO DA SILVA", pole: "ativo" }],
      }),
      djen("3", N3, { kind: "Lista de distribuição", docKind: "Outros", text: "Processo distribuído para a 2ª Vara Cível na data de 26/10/2026.", recipients: [{ name: "SIGILO", pole: "ativo" }] }),
      djen("4", N1, { cancelled: true }),
      djen("41", "", { date: "2026-10-28" }),
    ]);
    expect(r).toEqual({ notices: 1, cases: 2, events: 1, skipped: 1, failed: 1 });
    const ds = store.getSnapshot()!;
    const c2 = A.findCaseByNumber(ds, N2)!;
    expect(c2).toMatchObject({ court: "TRT1", rite: "trabalho", className: "Ação Trabalhista - Rito Ordinário", body: "1ª Vara do Trabalho de Exemplo", status: "ativo" });
    expect(c2.parties).toMatchObject([{ name: "Carlos Novo da Silva", pole: "ativo", client: true }]);
    expect(c2.notes).toMatch(/Cadastrado pela busca no DJEN/);
    const n2 = Object.values(ds.notices).find((n) => n.caseId === c2.id)!;
    expect(n2).toMatchObject({ days: 8, review: true, recipients: [c2.parties[0].id] });
    // lista de distribuição: vai para os andamentos, sem expediente; "SIGILO" não vira parte
    const c3 = A.findCaseByNumber(ds, N3)!;
    expect(c3.parties).toEqual([]);
    expect(c3.history).toMatchObject([{ kind: "evento", date: "2026-10-28", ref: "djen:3", text: "Lista de distribuição: Processo distribuído para a 2ª Vara Cível na data de 26/10/2026." }]);
    expect(Object.values(ds.notices).some((n) => n.caseId === c3.id)).toBe(false);
    // a comunicação cancelada não entrou nem criou o processo
    expect(A.findCaseByNumber(ds, N1)).toBeUndefined();
  });

  it("não registra de novo o que a pessoa apagou e avisa de possível repetição com o registrado à mão", async () => {
    const store = await setup();
    exec(store, A.importDjen, [djen("5", N1)]);
    let ds = store.getSnapshot()!;
    const c = A.findCaseByNumber(ds, N1)!;
    const auto = Object.values(ds.notices)[0];
    exec(store, A.deleteNotice, auto.id);
    expect(store.getSnapshot()!.prefs.cnj?.ignored).toEqual(["djen:5"]);
    expect(exec(store, A.importDjen, [djen("5", N1)])).toMatchObject({ notices: 0, skipped: 1 });

    exec(store, A.saveNotice, { caseId: c.id, kind: "intimacao", channel: "djen", recipients: [], sentAt: "2026-10-29", counting: "uteis", act: "Contrarrazões" });
    exec(store, A.importDjen, [djen("6", N1, { date: "2026-10-29" })]);
    ds = store.getSnapshot()!;
    const twin = Object.values(ds.notices).find((n) => n.ref === "djen:6")!;
    expect(twin.notes).toMatch(/Pode ser o mesmo expediente já registrado à mão \(Contrarrazões\)/);

    // apagar o processo também guarda as origens, e as comunicações novas o recriam
    exec(store, A.deleteCase, c.id);
    expect(store.getSnapshot()!.prefs.cnj?.ignored).toEqual(["djen:5", "djen:6"]);
    expect(exec(store, A.importDjen, [djen("6", N1), djen("7", N1)])).toEqual({ notices: 1, cases: 1, events: 0, skipped: 1, failed: 0 });
  });
});

describe("andamentos do DataJud", () => {
  const mov = (date: string, name: string, code = 1, time = "120000"): A.MovementEntry => ({ date, time, name, text: name, ref: `datajud:${code}:${date}T${time}` });

  it("acrescenta só as movimentações novas, depois do último evento do eproc e sem repetir outra fonte", async () => {
    const store = await setup();
    exec(store, A.importDjen, [djen("8", N3, { kind: "Lista de distribuição", text: "Processo distribuído." })]);
    const c = A.findCaseByNumber(store.getSnapshot()!, N3)!;
    // a distribuição já veio do DJEN no mesmo dia: a do DataJud não entra
    const added = exec(store, A.importMovements, c.id, [mov("2026-10-28", "Distribuição", 26), mov("2026-10-29", "Conclusão", 51), mov("2026-10-30", "Despacho", 11010)]);
    expect(added).toBe(2);
    expect(exec(store, A.importMovements, c.id, [mov("2026-10-29", "Conclusão", 51)])).toBe(0);

    // apagada pela pessoa: não volta
    const h = store.getSnapshot()!.cases[c.id].history.find((x) => x.ref === "datajud:51:2026-10-29T120000")!;
    exec(store, A.deleteHistory, c.id, h.id);
    expect(exec(store, A.importMovements, c.id, [mov("2026-10-29", "Conclusão", 51)])).toBe(0);

    // processo do eproc: os eventos do arquivo valem até o último deles
    const eproc = exec(store, A.saveCase, { number: N2, rite: "trabalho", status: "ativo", parties: [] });
    const withEvent = store.getSnapshot()!.cases[eproc];
    store.commit([{ t: "put", c: "cases", v: { ...withEvent, history: [{ id: "h-ev", date: "2026-09-10", at: "x", kind: "evento", text: "Evento 4: Conclusão", ref: "evento:4" }] } }]);
    expect(exec(store, A.importMovements, eproc, [mov("2026-09-01", "Juntada", 2), mov("2026-09-10", "Conclusão", 51), mov("2026-09-12", "Despacho", 11010)])).toBe(1);
    expect(store.getSnapshot()!.cases[eproc].history.map((x) => x.text)).toEqual(["Evento 4: Conclusão", "Despacho"]);
  });
});
