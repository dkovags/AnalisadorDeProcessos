import { describe, expect, it } from "vitest";
import { cnjCheckDigits, formatCnj } from "../src/domain/cnj";
import { currentInstance, instanceLevel, linkCandidates, looksSeparateAppeal, trackInstance } from "../src/domain/instances";
import type { Case } from "../src/domain/types";
import * as A from "../src/store/actions";
import { MemoryPersistence } from "../src/store/persistence";
import { AppStore } from "../src/store/store";

// Processos e comunicações fictícios; os nomes dos órgãos seguem os formatos publicados no DJEN.

let seq = 0;
const ctx = (): A.Ctx => ({ now: "2026-10-31T12:00:00.000Z", today: "2026-10-31", id: (p = "") => `${p}${++seq}` });

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

const cnj = (seqN: string, origin: string) => {
  const c = { seq: seqN, year: "2026", j: "8", tr: "19", origin };
  return formatCnj({ ...c, dv: cnjCheckDigits(c) });
};
const MAIN = cnj("0801234", "0207");
const AGRAVO = cnj("3000221", "9000");

const djen = (id: string, number: string, extra: Partial<A.DjenNotice> = {}): A.DjenNotice => ({
  id,
  date: "2026-10-20",
  number,
  court: "TJRJ",
  kind: "Intimação",
  docKind: "Despacho",
  body: "20º Juizado Especial Cível da Regional da Ilha do Governador",
  className: "PROCEDIMENTO DO JUIZADO ESPECIAL CíVEL",
  edital: false,
  text: "Intime-se a parte autora para se manifestar no prazo de 5 dias.",
  recipients: [
    { name: "ANA FICTICIA", pole: "ativo" },
    { name: "BANCO EXEMPLO S.A.", pole: "passivo" },
  ],
  lawyers: [],
  cancelled: false,
  ...extra,
});

describe("instância pelo nome do órgão", () => {
  it("separa a origem, o recurso e a uniformização", () => {
    for (const body of [
      "1ª Turma Recursal Fazendária",
      "3ª Turma Recursal Cível",
      "Colégio Recursal - Santos",
      "Gabinete do Des. Fulano de Tal",
      "Gabinete da Desª. Beltrana de Tal",
      "Gabinete da Juíza Convocada Sicrana - 4ª Câmara de Direito Público",
      "SECRETARIA DA 5ª CÂMARA DE DIREITO PRIVADO (ANTIGA 24ª CÂMARA CÍVEL)",
      "Gabinete 2 da 1ª Turma do 2º Núcleo Digital em Segundo Grau",
      "3VP - DIVISAO DE PROCESSAMENTO",
      "Gabinete da 3ª Vice-Presidência",
    ])
      expect([body, instanceLevel(body)]).toEqual([body, "recursal"]);
    for (const body of [
      "20º Juizado Especial Cível da Regional da Ilha do Governador",
      "Comarca da Capital- Cartório da 1ª Vara da Fazenda Pública",
      "Central de Dívida Ativa da Comarca de Exemplo",
      "1º Núcleo de Justiça 4.0 - Instituições Bancárias",
      "Justiça Itinerante - Japeri",
      "Vara Única da Comarca de Exemplo",
    ])
      expect([body, instanceLevel(body)]).toEqual([body, "origem"]);
    expect(instanceLevel("Turma Regional de Uniformização")).toBe("uniformizacao");
    expect(instanceLevel("Terceira Turma", "STJ")).toBe("superior");
  });
});

const base = (): Case => ({
  id: "c1",
  number: MAIN,
  body: "20º Juizado Especial Cível",
  rite: "juizado",
  status: "sentenciado",
  parties: [],
  history: [],
  filedAt: "2026-01-10",
  createdAt: "x",
  updatedAt: "x",
});

describe("acompanhamento das instâncias", () => {
  it("anota a subida, muda a situação e reconhece a volta à origem", () => {
    let c = trackInstance(base(), { level: "recursal", body: "Gabinete do Juiz Fulano", since: "2026-09-01", source: "djen" }, ctx()).case;
    c = trackInstance(c, { level: "recursal", body: "3ª Turma Recursal Cível", since: "2026-09-15", source: "djen" }, ctx()).case;
    expect(c.status).toBe("recurso");
    expect(c.instances!.map((i) => [i.level, i.body, i.since, i.last])).toEqual([
      ["origem", "20º Juizado Especial Cível", "2026-01-10", undefined],
      ["recursal", "3ª Turma Recursal Cível", "2026-09-01", "2026-09-15"],
    ]);
    expect(c.history.map((h) => h.text)).toEqual(["Processo na instância de recurso: Gabinete do Juiz Fulano", "Situação: Sentenciado → Em grau de recurso"]);
    expect(currentInstance(c)?.level).toBe("recursal");

    // recurso autuado à parte: entra com o número dele, sem mudar a situação nem a instância atual
    c = trackInstance(c, { level: "recursal", body: "1ª Turma Recursal Fazendária", number: AGRAVO, className: "Agravo de Instrumento", since: "2026-10-01", source: "djen" }, ctx()).case;
    expect(c.instances).toHaveLength(3);
    expect(c.history.at(-1)!.text).toBe(`Recurso autuado à parte: Agravo de Instrumento nº ${AGRAVO} (1ª Turma Recursal Fazendária)`);
    expect(currentInstance(c)?.body).toBe("3ª Turma Recursal Cível");

    // comunicação da origem depois do julgamento do recurso: os autos voltaram
    c = trackInstance(c, { level: "origem", body: "Cartório do 20º Juizado", since: "2026-10-25", source: "djen" }, ctx()).case;
    expect(currentInstance(c)?.level).toBe("origem");
    expect(c.history.at(-1)!.text).toBe("Processo de volta à origem: 20º Juizado Especial Cível");
    expect(c.status).toBe("recurso");
  });
});

describe("intimações da turma recursal", () => {
  it("o recurso nos mesmos autos fica no processo; o autuado à parte pode ser ligado a ele", async () => {
    const store = await setup();
    const mainId = exec(store, A.saveCase, {
      number: MAIN,
      body: "20º Juizado Especial Cível da Regional da Ilha do Governador",
      rite: "juizado",
      status: "sentenciado",
      parties: [
        { id: "", name: "Ana Fictícia", pole: "ativo", client: true },
        { id: "", name: "Banco Exemplo S.A.", pole: "passivo" },
      ],
    });
    const r = exec(store, A.importDjen, [
      djen("1", MAIN, { date: "2026-09-02", body: "3ª Turma Recursal Cível", className: "RECURSO INOMINADO CíVEL", text: "Processo distribuído." }),
      djen("2", AGRAVO, { date: "2026-10-01", body: "1ª Turma Recursal Fazendária", className: "AGRAVO DE INSTRUMENTO", docKind: "Decisão", text: "Intime-se o agravado para contrarrazões." }),
    ]);
    expect(r).toMatchObject({ notices: 2, cases: 1 });
    let ds = store.getSnapshot()!;
    const main = ds.cases[mainId];
    expect(main.status).toBe("recurso");
    expect(main.instances!.map((i) => [i.level, i.body])).toEqual([
      ["origem", "20º Juizado Especial Cível da Regional da Ilha do Governador"],
      ["recursal", "3ª Turma Recursal Cível"],
    ]);
    // o agravo veio com número novo: virou um processo à parte, já em grau de recurso, e parece recurso de outro
    const agravo = A.findCaseByNumber(ds, AGRAVO)!;
    expect(agravo).toMatchObject({ status: "recurso", body: "1ª Turma Recursal Fazendária", className: "Agravo de Instrumento" });
    expect(looksSeparateAppeal(agravo)).toBe(true);
    expect(looksSeparateAppeal(main)).toBe(false);
    expect(linkCandidates(ds, agravo)[0]).toMatchObject({ case: { id: mainId }, common: 2 });

    // ligado ao principal: o expediente e os andamentos passam para ele, e o número do agravo vira uma instância
    exec(store, A.linkCases, agravo.id, mainId);
    ds = store.getSnapshot()!;
    expect(ds.cases[agravo.id]).toBeUndefined();
    expect(Object.values(ds.notices).every((n) => n.caseId === mainId)).toBe(true);
    // as anotações de instância do agravo não vão para o principal (ele não subiu à Turma Fazendária)
    expect(ds.cases[mainId].history.some((h) => /Fazendária/.test(h.text) && h.text.startsWith("Processo na"))).toBe(false);
    const moved = Object.values(ds.notices).find((n) => n.ref === "djen:2")!;
    expect(moved.recipients.every((id) => ds.cases[mainId].parties.some((p) => p.id === id))).toBe(true);
    expect(ds.cases[mainId].parties).toHaveLength(2);
    expect(ds.cases[mainId].instances!.find((i) => i.number)).toMatchObject({ number: AGRAVO, level: "recursal", className: "Agravo de Instrumento" });
    // a próxima comunicação do agravo já cai no principal
    expect(exec(store, A.importDjen, [djen("3", AGRAVO, { date: "2026-10-20", body: "1ª Turma Recursal Fazendária" })])).toMatchObject({ notices: 1, cases: 0 });
    expect(Object.values(store.getSnapshot()!.notices).find((n) => n.ref === "djen:3")!.caseId).toBe(mainId);
    expect(() => exec(store, A.saveCase, { number: AGRAVO, rite: "civel", status: "ativo", parties: [] })).toThrow(/recurso ligado/);
  });

  it("guarda o link da consulta pública de cada instância", async () => {
    const store = await setup();
    const id = exec(store, A.saveCase, { number: MAIN, body: "20º Juizado Especial Cível", rite: "juizado", status: "ativo", parties: [] });
    expect(() => exec(store, A.saveInstance, id, { level: "origem", url: "consulta.tjrj" })).toThrow(/https/);
    expect(() => exec(store, A.saveInstance, id, { level: "recursal", number: MAIN })).toThrow(/próprio processo/);
    const inst = exec(store, A.saveInstance, id, { level: "origem", body: "20º Juizado Especial Cível", url: "https://consulta.exemplo/processo?n=1" });
    exec(store, A.saveInstance, id, { id: inst, level: "origem", body: "20º Juizado Especial Cível", url: "https://consulta.exemplo/processo?n=2" });
    expect(store.getSnapshot()!.cases[id].instances).toMatchObject([{ id: inst, url: "https://consulta.exemplo/processo?n=2", source: "manual" }]);
    exec(store, A.removeInstance, id, inst);
    expect(store.getSnapshot()!.cases[id].instances).toEqual([]);
  });

  it("os registros do DataJud em outro grau também mostram a subida", async () => {
    const store = await setup();
    const id = exec(store, A.saveCase, { number: MAIN, body: "20º Juizado Especial Cível", rite: "juizado", status: "ativo", parties: [] });
    const added = exec(
      store,
      A.importMovements,
      id,
      [
        { date: "2026-05-02", name: "Sentença", text: "Sentença", ref: "datajud:22:2026-05-02T100000" },
        { date: "2026-07-10", name: "Conclusão", text: "Conclusão", ref: "datajud:51:2026-07-10T120000", body: "3ª Turma Recursal Cível" },
      ],
      [
        { level: "origem", body: "1º Juizado Especial Civel", number: MAIN, since: "2026-05-02", last: "2026-05-02", source: "datajud" },
        { level: "recursal", body: "3ª Turma Recursal Cível", number: MAIN, since: "2026-07-10", last: "2026-07-10", source: "datajud" },
      ],
    );
    expect(added).toBe(2);
    const c = store.getSnapshot()!.cases[id];
    expect(c.status).toBe("recurso");
    expect(c.instances!.map((i) => i.level)).toEqual(["origem", "recursal"]);
    expect(c.history.find((h) => h.ref === "datajud:51:2026-07-10T120000")!.body).toBe("3ª Turma Recursal Cível");
  });
});
