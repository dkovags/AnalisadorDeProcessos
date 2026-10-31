// Intermediário do Analisador de Processos para as APIs públicas do CNJ.
// Roda no AWS Lambda em São Paulo, de onde o DJEN aceita consultas (ele recusa acessos de fora do Brasil), e devolve
// as respostas ao aplicativo. Só repassa consultas ao DJEN e ao DataJud, e só para quem manda a senha certa no
// cabeçalho "x-chave".

// A senha fica na variável de ambiente CHAVE da função (Configuração → Variáveis de ambiente), nunca neste arquivo:
// ele é público no GitHub.

const DJEN = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
const DATAJUD = "https://api-publica.datajud.cnj.jus.br";
// chave pública do DataJud, divulgada pelo CNJ para qualquer pessoa (se o CNJ trocar, atualize aqui)
const DATAJUD_KEY = "APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });

async function relay(res) {
  return { statusCode: res.status, headers: { "Content-Type": res.headers.get("content-type") || "application/json" }, body: await res.text() };
}

/** Atende uma chamada do aplicativo (separado do handler para dar para testar sem a AWS). */
export async function responder(event, { chave, fetch: fetchFn }) {
  const method = event.requestContext?.http?.method || "GET";
  const path = event.rawPath || "/";
  if (method === "OPTIONS") return { statusCode: 204 };
  if (!chave || event.headers?.["x-chave"] !== chave) return json(401, { erro: "Senha ausente ou errada." });
  try {
    // DJEN: comunicações e intimações publicadas (os parâmetros seguem como vieram: numeroOab, ufOab, datas...)
    if (path === "/djen" && method === "GET") {
      return relay(await fetchFn(`${DJEN}?${event.rawQueryString || ""}`, { headers: { Accept: "application/json" } }));
    }
    // DataJud: movimentações; o caminho diz o tribunal ("/datajud/api_publica_tjrj", "/datajud/api_publica_tre-sp")
    const m = path.match(/^\/datajud\/(api_publica_[a-z0-9]+(?:-[a-z]{2})?)$/);
    if (m && method === "POST") {
      const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
      return relay(
        await fetchFn(`${DATAJUD}/${m[1]}/_search`, { method: "POST", headers: { Authorization: DATAJUD_KEY, "Content-Type": "application/json" }, body }),
      );
    }
    return json(404, { erro: "Caminho desconhecido. Use /djen ou /datajud/api_publica_<tribunal>." });
  } catch (e) {
    return json(502, { erro: `Falha ao consultar o CNJ: ${e?.message || e}` });
  }
}

export const handler = (event) => responder(event, { chave: process.env.CHAVE, fetch: globalThis.fetch });
