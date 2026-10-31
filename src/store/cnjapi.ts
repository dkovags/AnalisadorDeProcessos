import { courtOfCnj, digitsOf, normalizeCaseNumber, parseCnj } from "../domain/cnj";
import { isValidISO } from "../domain/dates";
import { instanceLevel, levelOfGrau, type Sighting } from "../domain/instances";
import { fold, isUpper, squash, titleCase } from "../domain/text";
import type { CnjPrefs, Pole } from "../domain/types";
import type { DjenNotice, MovementEntry } from "./actions";
import { decodeEntities, htmlText } from "./extract";

// Busca no CNJ pelo intermediário no Brasil (servidor/aws-lambda): as comunicações publicadas no DJEN para a OAB
// (intimações e editais) e as movimentações dos processos no DataJud. O app chama o endereço configurado, com a senha
// no cabeçalho "x-chave", e o intermediário repassa a consulta ao CNJ. Saem do aparelho só a OAB, as datas da busca e
// os números dos processos.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const browserFetch: Fetch = (url, init) => fetch(url, init);

/** Falha na busca, com a mensagem para mostrar à pessoa. */
export class CnjError extends Error {}

export type CnjConfig = CnjPrefs & { url: string; key: string };
export type DjenConfig = CnjConfig & { oab: string; uf: string };

/** Número da OAB só com os algarismos, sem zeros à esquerda ("012.345" → "12345"). */
export function oabNumber(s: string | undefined): string {
  return digitsOf(s || "").replace(/^0+/, "");
}

/** Endereço e senha do intermediário preenchidos. */
export function cnjReady(c: CnjPrefs | undefined): c is CnjConfig {
  return !!c?.url?.trim() && !!c.key?.trim();
}

/** Pronto para buscar as intimações: intermediário, número da OAB e UF. */
export function djenReady(c: CnjPrefs | undefined): c is DjenConfig {
  return cnjReady(c) && !!oabNumber(c.oab) && /^[A-Z]{2}$/.test(c.uf || "");
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

/** Chama o intermediário e devolve o JSON da resposta. */
async function call(c: CnjConfig, path: string, init: RequestInit, fetchFn: Fetch): Promise<unknown> {
  const base = c.url.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/\s]+(\/\S*)?$/i.test(base))
    throw new CnjError("O endereço do intermediário deve começar com https:// (copie a URL da função na AWS).");
  let res: Response;
  try {
    res = await fetchFn(base + path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "x-chave": c.key.trim() } });
  } catch {
    throw new CnjError("Não foi possível falar com o intermediário: confira a internet e o endereço em Configurações.");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (res.status === 401) throw new CnjError("O intermediário recusou a senha: confira a senha em Configurações (é a mesma da variável CHAVE da função).");
  if (!res.ok) {
    const detail = isObject(body) ? str(body.erro) || str(body.message) || str(body.Message) : undefined;
    if (res.status === 429) throw new CnjError("O CNJ pediu para esperar antes de novas consultas. Tente de novo mais tarde.");
    if (res.status >= 500)
      throw new CnjError(`O CNJ ou o intermediário não respondeu a tempo (HTTP ${res.status}). Tente de novo em alguns minutos.${detail ? ` Detalhe: ${detail}` : ""}`);
    throw new CnjError(`O intermediário não aceitou a consulta (HTTP ${res.status})${detail ? `: ${detail}` : "."}`);
  }
  if (body === undefined) throw new CnjError("O CNJ respondeu num formato inesperado.");
  return body;
}

/* ---------- DJEN ---------- */

/** Comunicação como vem do DJEN (só os campos usados pelo app). */
export interface DjenItem {
  id: number | string;
  /** "2026-10-30" */
  data_disponibilizacao?: string;
  /** "30/10/2026" */
  datadisponibilizacao?: string;
  siglaTribunal?: string;
  /** Intimação, Edital, Lista de distribuição... */
  tipoComunicacao?: string;
  /** Despacho, Decisão, Sentença, Ato Ordinatório Praticado... */
  tipoDocumento?: string;
  nomeOrgao?: string;
  nomeClasse?: string;
  /** Texto simples ou HTML. */
  texto?: string;
  numero_processo?: string;
  numeroprocessocommascara?: string;
  /** "D": DJEN; "E": Plataforma Nacional de Editais. */
  meio?: string;
  link?: string | null;
  ativo?: boolean;
  data_cancelamento?: string | null;
  destinatarios?: { nome?: string; polo?: string }[];
  destinatarioadvogados?: { advogado?: { nome?: string; numero_oab?: string | number; uf_oab?: string } }[];
}

export const DJEN_PAGE = 100;
const DJEN_MAX_PAGES = 30;

/** Comunicações disponibilizadas para a OAB entre as datas (AAAA-MM-DD), em páginas de 100. */
export async function djenSearch(c: DjenConfig, from: string, to: string, fetchFn: Fetch = browserFetch): Promise<DjenItem[]> {
  const out: DjenItem[] = [];
  for (let page = 1; page <= DJEN_MAX_PAGES; page++) {
    const q = new URLSearchParams({
      numeroOab: oabNumber(c.oab),
      ufOab: c.uf.toUpperCase(),
      dataDisponibilizacaoInicio: from,
      dataDisponibilizacaoFim: to,
      pagina: String(page),
      itensPorPagina: String(DJEN_PAGE),
    });
    const body = await call(c, `/djen?${q}`, { method: "GET" }, fetchFn);
    if (!isObject(body) || !Array.isArray(body.items)) {
      const msg = isObject(body) ? str(body.message) : undefined;
      throw new CnjError(`O DJEN respondeu num formato inesperado${msg ? `: ${msg}` : "."}`);
    }
    for (const it of body.items) if (isObject(it) && it.id !== undefined && it.id !== null) out.push(it as unknown as DjenItem);
    // o total ("count") nem sempre é exato: segue até uma página vir incompleta
    if (body.items.length < DJEN_PAGE) break;
  }
  return out;
}

/** Confere o endereço e a senha com uma consulta mínima ao DJEN (comunicações de hoje). */
export async function cnjPing(c: CnjConfig, today: string, fetchFn: Fetch = browserFetch): Promise<void> {
  const q = new URLSearchParams({
    numeroOab: oabNumber(c.oab) || "1",
    ufOab: (c.uf || "SP").toUpperCase(),
    dataDisponibilizacaoInicio: today,
    dataDisponibilizacaoFim: today,
    pagina: "1",
    itensPorPagina: "5",
  });
  const body = await call(c, `/djen?${q}`, { method: "GET" }, fetchFn);
  if (!isObject(body) || !Array.isArray(body.items)) throw new CnjError("O intermediário respondeu, mas o DJEN mandou algo inesperado.");
}

/** Texto da comunicação: o DJEN manda texto simples ou HTML (com tabelas e acentos como &ccedil;). */
export function djenText(raw: string): string {
  const html = /<\/?[a-z][^>]*>/i.test(raw);
  const t = html ? htmlText(raw.replace(/<\/t[dh]>/gi, " ")) : decodeEntities(raw);
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const POLES: Record<string, Pole> = { A: "ativo", P: "passivo" };

/** Comunicação pronta para registrar: texto sem HTML, destinatários e advogados. */
export function djenNotice(it: DjenItem): DjenNotice | null {
  const number = str(it.numeroprocessocommascara) || str(it.numero_processo);
  const br = str(it.datadisponibilizacao)?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const date = str(it.data_disponibilizacao)?.slice(0, 10) || (br ? `${br[3]}-${br[2]}-${br[1]}` : undefined);
  if (!number || !date || !isValidISO(date)) return null;
  const recipients: DjenNotice["recipients"] = [];
  for (const d of it.destinatarios || []) {
    const name = str(d?.nome);
    const pole = POLES[str(d?.polo)?.toUpperCase() || ""] || "terceiro";
    if (name && !recipients.some((r) => r.name === name && r.pole === pole)) recipients.push({ name, pole });
  }
  const lawyers: DjenNotice["lawyers"] = [];
  for (const x of it.destinatarioadvogados || []) {
    const a = x?.advogado;
    const name = str(a?.nome);
    if (name && !lawyers.some((l) => l.name === name)) lawyers.push({ name, oab: str(a?.numero_oab), uf: str(a?.uf_oab)?.toUpperCase() });
  }
  return {
    id: String(it.id),
    date,
    number,
    court: str(it.siglaTribunal)?.toUpperCase(),
    kind: str(it.tipoComunicacao),
    docKind: str(it.tipoDocumento),
    body: str(it.nomeOrgao),
    className: str(it.nomeClasse),
    edital: it.meio === "E",
    link: str(it.link),
    text: djenText(it.texto || ""),
    recipients,
    lawyers,
    cancelled: it.ativo === false || !!it.data_cancelamento,
  };
}

/* ---------- DataJud ---------- */

export interface DatajudResult {
  /** O processo está no DataJud. */
  found: boolean;
  /** Movimentações (de todos os graus e de todos os números), da mais antiga para a mais nova. */
  entries: MovementEntry[];
  /** Última atualização dos dados no CNJ (o DataJud costuma andar semanas ou meses atrás do tribunal). */
  updatedAt?: string;
  /** Um registro por grau em que o processo aparece (origem, turma recursal, segundo grau...), com o órgão e as datas. */
  sightings: Sighting[];
}

/** Índice do tribunal no DataJud: "TJRJ" → "api_publica_tjrj", "TRT1" → "api_publica_trt1", "TRE-SP" → "api_publica_tre-sp". */
export function datajudIndex(court: string): string {
  return `api_publica_${court.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
}

/** Data e hora da movimentação ("2026-03-13T17:57:50.000Z" e, em alguns tribunais, "20260313175750"). */
function movementWhen(s: string): { date: string; time: string } | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/) || s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return isValidISO(date) ? { date, time: `${m[4] || "00"}${m[5] || "00"}${m[6] || "00"}` } : null;
}

const nice = (v: string | undefined) => (v ? (isUpper(v) ? titleCase(v) : squash(v)) : undefined);

/**
 * Movimentações do processo no DataJud, pelo número dele e pelos das instâncias (recurso autuado à parte). O tribunal
 * de cada número vem do próprio número (o do STJ vai ao índice do STJ); sem isso, vale o tribunal do processo.
 */
export async function datajudMovements(c: CnjConfig, court: string, numbers: string | string[], fetchFn: Fetch = browserFetch): Promise<DatajudResult> {
  const list = [...new Set((Array.isArray(numbers) ? numbers : [numbers]).map((n) => digitsOf(n)).filter((d) => d.length === 20))];
  if (!list.length) throw new CnjError("O DataJud só encontra processos pelo número no padrão do CNJ (20 algarismos).");
  const entries: MovementEntry[] = [];
  const sightings: Sighting[] = [];
  const refs = new Set<string>();
  let updatedAt: string | undefined;
  let found = false;
  let failure: unknown;
  for (const digits of list) {
    const cnj = parseCnj(digits);
    const index = datajudIndex((cnj && courtOfCnj(cnj)) || court);
    let body: unknown;
    try {
      body = await call(
        c,
        `/datajud/${index}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: digits } } }) },
        fetchFn,
      );
    } catch (e) {
      // um número que falha (ex.: índice que o DataJud não tem) não impede os outros
      failure ??= e;
      continue;
    }
    const hits = isObject(body) && isObject(body.hits) && Array.isArray(body.hits.hits) ? body.hits.hits : undefined;
    if (!hits) {
      failure ??= new CnjError("O DataJud respondeu num formato inesperado.");
      continue;
    }
    for (const h of hits) {
      const src = isObject(h) && isObject(h._source) ? h._source : undefined;
      if (!src || digitsOf(String(src.numeroProcesso ?? "")) !== digits) continue;
      found = true;
      const at = str(src.dataHoraUltimaAtualizacao);
      if (at && (!updatedAt || at > updatedAt)) updatedAt = at;
      const orgao = nice(isObject(src.orgaoJulgador) ? str(src.orgaoJulgador.nome) : undefined);
      const level = levelOfGrau(str(src.grau)) || instanceLevel(orgao);
      const dates: string[] = [];
      for (const m of Array.isArray(src.movimentos) ? src.movimentos : []) {
        if (!isObject(m)) continue;
        const name = str(m.nome);
        const when = movementWhen(str(m.dataHora) || "");
        if (!name || !when) continue;
        dates.push(when.date);
        const extras = (Array.isArray(m.complementosTabelados) ? m.complementosTabelados : [])
          .map((x) => (isObject(x) ? str(x.nome) : undefined))
          .filter((x): x is string => !!x && fold(x) !== fold(name));
        const ref = `datajud:${str(m.codigo) || fold(name).replace(/[^a-z0-9]+/g, "-")}:${when.date}T${when.time}`;
        if (refs.has(ref)) continue;
        refs.add(ref);
        entries.push({
          date: when.date,
          time: when.time,
          name,
          text: extras.length ? `${name} (${[...new Set(extras)].join(", ")})` : name,
          ref,
          body: level !== "origem" ? orgao : undefined,
        });
      }
      dates.sort();
      if (dates.length)
        sightings.push({
          level,
          body: orgao,
          number: normalizeCaseNumber(digits),
          className: nice(isObject(src.classe) ? str(src.classe.nome) : undefined),
          since: dates[0],
          last: dates[dates.length - 1],
          source: "datajud",
        });
    }
  }
  if (!found && failure) throw failure;
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
  return { found, entries, updatedAt, sightings };
}
