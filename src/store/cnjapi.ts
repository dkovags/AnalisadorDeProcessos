import { addDays } from "../domain/dates";

// APIs públicas do CNJ: o DJEN (comunicações e intimações publicadas) e o DataJud (movimentações dos processos).
// Antes de buscar intimações e andamentos sozinho, o app testa se elas aceitam consultas feitas direto do navegador
// (a regra de CORS). O teste não envia nenhum dado da pessoa e guarda só os nomes dos campos da resposta.

export const DJEN_URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
export const DATAJUD_URL = "https://api-publica.datajud.cnj.jus.br";
/** Chave pública do DataJud, divulgada pelo CNJ para qualquer pessoa (pode mudar). */
export const DATAJUD_KEY = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

/** "direto": a resposta chega ao app; "bloqueado": o servidor responde, mas não deixa outro site ler; "inacessivel": não respondeu. */
export type Reach = "direto" | "bloqueado" | "inacessivel";

export interface ApiCheck {
  api: "DJEN" | "DataJud";
  reach: Reach;
  status?: number;
  /** Nomes dos campos do primeiro item da resposta, sem os valores ("destinatarios[].nome" para listas). */
  fields?: string[];
  error?: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Campos de um item, com um nível de dentro ("movimentos[].nome", "classe.nome"). */
function itemFields(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(item)) {
    out.push(k);
    const inner = Array.isArray(v) ? v.find(isObject) : isObject(v) ? v : undefined;
    if (inner) for (const sub of Object.keys(inner)) out.push(`${k}${Array.isArray(v) ? "[]" : ""}.${sub}`);
  }
  return out;
}

/** Nomes dos campos do primeiro item: "items" (DJEN), "hits.hits[0]._source" (DataJud) ou o próprio objeto. */
export function fieldNames(json: unknown): string[] {
  if (!isObject(json)) return [];
  const top = Object.keys(json);
  const items = Object.values(json).find((v): v is unknown[] => Array.isArray(v) && v.some(isObject));
  const hits = isObject(json.hits) && Array.isArray(json.hits.hits) ? json.hits.hits : undefined;
  const first = hits?.find(isObject);
  const source = first && isObject(first._source) ? first._source : undefined;
  const item = source || items?.find(isObject);
  return item ? [...top.map((k) => `(resposta) ${k}`), ...itemFields(item)] : top.map((k) => `(resposta) ${k}`);
}

async function check(api: ApiCheck["api"], url: string, init: RequestInit, probe: string, fetchFn: Fetch): Promise<ApiCheck> {
  try {
    const res = await fetchFn(url, init);
    let fields: string[] | undefined;
    try {
      fields = fieldNames(await res.json());
    } catch {
      fields = undefined;
    }
    return { api, reach: "direto", status: res.status, fields };
  } catch (e) {
    // a consulta normal falhou: se o servidor responde a uma consulta "opaca", o que barrou foi a regra de CORS
    try {
      await fetchFn(probe, { mode: "no-cors" });
      return { api, reach: "bloqueado", error: String(e) };
    } catch {
      return { api, reach: "inacessivel", error: String(e) };
    }
  }
}

/** Uma consulta de exemplo em cada API (comunicações do TJRJ na última semana; um processo qualquer do TJRJ). */
export async function testCnj(today: string, fetchFn: Fetch = (u, i) => fetch(u, i)): Promise<ApiCheck[]> {
  const q = new URLSearchParams({
    siglaTribunal: "TJRJ",
    dataDisponibilizacaoInicio: addDays(today, -7),
    dataDisponibilizacaoFim: addDays(today, -1),
    pagina: "1",
    itensPorPagina: "1",
  });
  return Promise.all([
    check("DJEN", `${DJEN_URL}?${q}`, { method: "GET" }, `${DJEN_URL}?${q}`, fetchFn),
    check(
      "DataJud",
      `${DATAJUD_URL}/api_publica_tjrj/_search`,
      {
        method: "POST",
        headers: { Authorization: `APIKey ${DATAJUD_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ size: 1, query: { match_all: {} } }),
      },
      DATAJUD_URL,
      fetchFn,
    ),
  ]);
}

export const REACH_TEXT: Record<Reach, string> = {
  direto: "funciona direto deste site",
  bloqueado: "o servidor respondeu, mas não aceita consulta direta de outro site (vai precisar de um intermediário)",
  inacessivel: "não foi possível falar com o servidor (sem internet ou bloqueio na rede)",
};

/** Resultado em texto, para copiar e mandar a quem está ajustando a busca automática. */
export function cnjReport(checks: ApiCheck[], today: string): string {
  const lines = [`Teste de conexão com o CNJ (${today})`];
  for (const c of checks) {
    lines.push(`${c.api}: ${REACH_TEXT[c.reach]}${c.status ? ` · HTTP ${c.status}` : ""}`);
    if (c.fields?.length) lines.push(`  campos: ${c.fields.join(", ")}`);
    if (c.error && c.reach !== "direto") lines.push(`  erro: ${c.error}`);
  }
  return lines.join("\n");
}
