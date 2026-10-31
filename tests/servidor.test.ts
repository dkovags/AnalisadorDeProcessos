import { describe, expect, it } from "vitest";
import { responder } from "../servidor/aws-lambda/index.mjs";

const ev = (method: string, rawPath: string, extra: Record<string, unknown> = {}) => ({ rawPath, requestContext: { http: { method } }, headers: { "x-chave": "segredo" }, ...extra });

describe("intermediário na AWS (servidor/aws-lambda)", () => {
  it("exige a senha e só repassa consultas ao DJEN e ao DataJud", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    };
    expect((await responder({ ...ev("GET", "/djen"), headers: {} }, { chave: "segredo", fetch })).statusCode).toBe(401);
    expect((await responder(ev("GET", "/djen"), { chave: undefined, fetch })).statusCode).toBe(401);

    const djen = await responder(ev("GET", "/djen", { rawQueryString: "numeroOab=123456&ufOab=RJ" }), { chave: "segredo", fetch });
    expect(djen).toMatchObject({ statusCode: 200, body: '{"ok":true}' });
    expect(calls[0][0]).toBe("https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=123456&ufOab=RJ");

    const datajud = await responder(ev("POST", "/datajud/api_publica_tjrj", { body: '{"size":1}' }), { chave: "segredo", fetch });
    expect(datajud.statusCode).toBe(200);
    expect(calls[1][0]).toBe("https://api-publica.datajud.cnj.jus.br/api_publica_tjrj/_search");
    expect((calls[1][1]?.headers as Record<string, string>).Authorization).toMatch(/^APIKey /);

    // nada além dos dois endereços do CNJ
    expect((await responder(ev("GET", "/outra-coisa"), { chave: "segredo", fetch })).statusCode).toBe(404);
    expect((await responder(ev("POST", "/datajud/../../outro"), { chave: "segredo", fetch })).statusCode).toBe(404);
    expect(calls).toHaveLength(2);
  });
});
