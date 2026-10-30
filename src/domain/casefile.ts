import { classifyText, docTypeFromLabel } from "./analysis";
import { CNJ_RE, formatCnj, parseCnj } from "./cnj";
import { DOC_TYPES } from "./labels";
import type { DocType, Pole } from "./types";
import { findDates, fold, isUpper, parseMoney, squash, titleCase } from "./text";

// Leitura do PDF do processo inteiro baixado do sistema do tribunal ("processo integral").
// PJe: capa com os dados do processo, partes e índice de documentos; cada página tem o carimbo "Num. <Id> - Pág. <n>".
// eproc: capa com "Partes e Representantes" e a tabela de eventos (documentos INIC1, PROC2, CONTES1...); as páginas
//   trazem o carimbo "Processo <número>, Evento <n>, <documento>, Página <p>" e as decisões, o código verificador.
// e-SAJ: cada página traz na margem "assinado digitalmente por ..., protocolado em ..., código <X>".
// Qualquer sistema: quando o PDF tem marcadores (índice), cada marcador vira um documento.
// Sem nada disso, o arquivo inteiro vira um documento (continua pesquisável página por página).

export interface FileParty {
  name: string;
  role: string;
  pole: Pole;
  lawyers: string[];
}

export interface FileDoc {
  courtId?: string;
  title: string;
  type: DocType;
  date?: string;
  signer?: string;
  /** Primeira e última página (1 = primeira). */
  pages: [number, number];
}

/** Marcador (índice) do PDF. */
export interface OutlineEntry {
  title: string;
  page: number;
  /** Nível no índice (0 = primeiro). */
  depth?: number;
  leaf?: boolean;
  parent?: string;
}

export interface CaseFileInfo {
  system?: string;
  number?: string;
  className?: string;
  body?: string;
  filedAt?: string;
  value?: number;
  subjects?: string;
  secret?: boolean;
  freeJustice?: boolean;
  parties: FileParty[];
  docs: FileDoc[];
}

const LAWYER_ROLES = /^(advogad[oa]|procurador[a]?|defensor[a]?( publico| publica)?|representante|curador[a]?|perit[oa])/;
const ACTIVE = /^(autor|autora|paciente|requerente|reclamante|exequente|impetrante|apelante|agravante|embargante|recorrente|demandante|querelante|promovente|denunciante|suscitante|polo ativo|ativo)/;
const PASSIVE = /^(reu|re|requerid|reclamad|executad|impetrad|apelad|agravad|embargad|recorrid|demandad|querelad|promovid|denunciad|acusad|suscitad|autoridade coatora|polo passivo|passivo)/;

export function poleOfRole(role: string): Pole {
  const r = fold(role).trim();
  if (ACTIVE.test(r)) return "ativo";
  if (PASSIVE.test(r)) return "passivo";
  return "terceiro";
}

/** "MARIA (AUTOR) JOSÉ ADV (ADVOGADO)" → pares nome e papel, na ordem. */
function pairs(line: string): { name: string; role: string }[] {
  const out: { name: string; role: string }[] = [];
  for (const m of line.matchAll(/([^()]+?)\s*\(([^()]{2,60})\)/g)) {
    const name = squash(m[1]).replace(/^[-–,;:]\s*/, "");
    if (name.length >= 2) out.push({ name, role: squash(m[2]) });
  }
  return out;
}

// Tipos de documento do PJe, para separar "nome" e "tipo" nas linhas do índice (do mais longo ao mais curto).
const PJE_TYPES = [
  "Petição Inicial Anexos", "Petição Inicial", "Petição Intercorrente", "Petição", "Procuração", "Substabelecimento",
  "Documento de Identificação", "Documento de Comprovação", "Comprovante de Residência", "Outros Documentos", "Documento Diverso",
  "Contestação", "Réplica", "Manifestação", "Decisão", "Despacho", "Sentença", "Acórdão", "Ementa", "Relatório", "Voto",
  "Certidão", "Intimação", "Citação", "Notificação", "Mandado", "Ato Ordinatório", "Ata da Audiência", "Termo de Audiência",
  "Laudo Pericial", "Laudo", "Parecer", "Apelação", "Contrarrazões", "Embargos de Declaração", "Agravo de Instrumento",
  "Agravo Interno", "Recurso Inominado", "Recurso Ordinário", "Recurso", "Guia de Custas", "Custas", "Comprovante",
  "Pedido de Habilitação", "Habilitação", "Informação", "Ofício", "Alvará", "Carta", "Edital", "Termo", "Cálculo",
  "Planilha de Cálculos", "Documento",
].sort((a, b) => b.length - a.length);

/** Separa "Contestação Banco Contestação" em nome e tipo. */
function splitNameType(rest: string): { title: string; typeLabel?: string } {
  const r = squash(rest);
  const fr = fold(r);
  for (const t of PJE_TYPES) {
    const ft = fold(t);
    if (fr.endsWith(" " + ft) || fr === ft) {
      const title = squash(r.slice(0, r.length - t.length));
      return { title: title || t, typeLabel: t };
    }
  }
  // nome e tipo repetidos ("Decisão Decisão")
  const words = r.split(" ");
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    if (fold(words.slice(0, half).join(" ")) === fold(words.slice(half).join(" "))) return { title: words.slice(0, half).join(" "), typeLabel: words.slice(half).join(" ") };
  }
  return { title: r };
}

/** Valor depois de um rótulo na capa ("Classe: PROCEDIMENTO COMUM CÍVEL"). */
function field(lines: string[], label: RegExp): string | undefined {
  for (const line of lines) {
    const f = fold(line);
    const m = f.match(label);
    if (!m) continue;
    const v = line.slice(m.index! + m[0].length).replace(/^\s*\??\s*:?\s*/, "").trim();
    if (v) return v;
  }
  return undefined;
}

const PJE_STAMP = /Num\.\s*(\d{4,14})\s*-\s*P[áa]g\.\s*(\d+)/;
const PJE_SIGNED = /Assinado eletronicamente por:\s*(.+?)\s*-\s*(\d{2}\/\d{2}\/\d{4})/;
const ESAJ_CODE = /c[óo]digo\s+([0-9A-Za-z]{6,})/;
const ESAJ_SIGNED = /assinado digitalmente por\s+(.+?)(?:\s+e\s+Tribunal|,)[^]*?(?:protocolado|liberado nos autos digitais|liberado nos autos)\s+em\s+(\d{2}\/\d{2}\/\d{4})/i;

/** Linhas de uma seção da capa: depois do título até o próximo título conhecido. */
function section(lines: string[], start: RegExp, end: RegExp): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const f = fold(line).trim();
    if (!inside && start.test(f)) {
      inside = true;
      continue;
    }
    if (inside && end.test(f)) break;
    if (inside) out.push(line);
  }
  return out;
}

const SECTION_END = /^(partes e representantes|partes\b|documentos\b|id\.?\s+data|assuntos?\b|informacoes adicionais|eventos?\b|evento\s+data|lembretes|acoes\b)/;

/** Dados da capa (PJe e eproc): número, classe, órgão julgador, autuação, valor, assuntos, sigilo e gratuidade. */
function parseCover(cover: string[], info: CaseFileInfo) {
  const num = field(cover, /^\s*(?:n[o.°]?\s*(?:do\s+)?processo|numero(?:\s+do\s+processo)?|processo\s*n?[o.°]*)\s*:/);
  if (num) {
    const c = parseCnj((num.match(CNJ_RE) || [num])[0]);
    if (c) info.number = formatCnj(c);
  }
  const cls = field(cover, /^\s*classe(?:\s+(?:da acao|processual|judicial))?\s*:/);
  if (cls) info.className = isUpper(cls) ? titleCase(cls) : cls;
  const body = field(cover, /^\s*(?:orgao julgador(?:\s+colegiado)?|juizo|vara)\s*:/);
  if (body) info.body = isUpper(body) ? titleCase(body) : body;
  const dist = field(cover, /^\s*(?:ultima distribuicao|data da distribuicao|distribuicao|data de autuacao|data da autuacao|autuacao|autuado em)\s*:/);
  if (dist) info.filedAt = findDates(dist)[0]?.iso;
  const value = field(cover, /^\s*valor da causa\s*:/);
  if (value) info.value = parseMoney(value) ?? undefined;
  const subjects = field(cover, /^\s*assuntos?\s*:/);
  if (subjects) info.subjects = isUpper(subjects) ? titleCase(subjects) : subjects;
  else {
    // eproc: seção "Assuntos" em tabela (código, descrição, principal)
    const rows = section(cover, /^assuntos?$/, SECTION_END)
      .map((l) => squash(l.replace(/^\s*\d{3,6}\s+/, "").replace(/\s+(sim|nao|não)\s*$/i, "")))
      .filter((l) => l.length > 3 && !/^(codigo|descricao)/.test(fold(l)));
    if (rows.length) info.subjects = rows.slice(0, 6).map((r) => (isUpper(r) ? titleCase(r) : r)).join("; ");
  }
  const secret = field(cover, /^\s*segredo de justica\s*/);
  if (secret) info.secret = /^sim/i.test(fold(secret));
  const sigilo = field(cover, /^\s*nivel de sigilo[^:]*:/);
  if (sigilo) info.secret = !/sem sigilo|nivel 0|publico/.test(fold(sigilo));
  const free = field(cover, /^\s*justica gratuita\s*/);
  if (free) info.freeJustice = /^(sim|deferid|concedid)/.test(fold(free));
}

function parsePjeCover(pages: string[], info: CaseFileInfo) {
  // a capa e o índice ocupam as primeiras páginas, antes do primeiro carimbo
  const cover: string[] = [];
  for (const p of pages) {
    if (PJE_STAMP.test(p)) break;
    cover.push(...p.split("\n"));
  }
  if (!cover.length) cover.push(...(pages[0] || "").split("\n"));
  parseCover(cover, info);

  // partes: entre o cabeçalho "Partes" e "Documentos"
  let inParties = false;
  for (const line of cover) {
    const f = fold(line).trim();
    if (/^partes\b/.test(f)) {
      inParties = true;
      continue;
    }
    if (/^documentos\b/.test(f) || /^id\.?\s+data/.test(f)) inParties = false;
    if (!inParties) continue;
    for (const { name, role } of pairs(line)) {
      const fr = fold(role);
      const last = info.parties[info.parties.length - 1];
      if (LAWYER_ROLES.test(fr)) {
        if (last) last.lawyers.push(titleCase(name));
      } else info.parties.push({ name: titleCase(name), role: titleCase(role), pole: poleOfRole(role), lawyers: [] });
    }
  }
}

interface IndexEntry {
  id: string;
  date: string;
  title: string;
  typeLabel?: string;
}

function parsePjeIndex(pages: string[]): Map<string, IndexEntry> {
  const out = new Map<string, IndexEntry>();
  for (const p of pages) {
    if (PJE_STAMP.test(p) && out.size) break;
    for (const line of p.split("\n")) {
      const m = line.trim().match(/^(\d{5,14})\s+(\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?)?\s+(.+)$/);
      if (!m) continue;
      const date = findDates(m[2])[0]?.iso;
      if (!date) continue;
      out.set(m[1], { id: m[1], date, ...splitNameType(m[3]) });
    }
  }
  return out;
}

function parsePje(pages: string[], info: CaseFileInfo) {
  info.system = "PJe";
  parsePjeCover(pages, info);
  const index = parsePjeIndex(pages);
  let current: FileDoc | null = null;
  let currentId = "";
  let coverEnd = 0;
  pages.forEach((text, i) => {
    const page = i + 1;
    const m = text.match(PJE_STAMP);
    if (!m) {
      if (current) current.pages[1] = page;
      else coverEnd = page;
      return;
    }
    if (m[1] !== currentId || !current) {
      currentId = m[1];
      const entry = index.get(m[1]);
      const signed = text.match(PJE_SIGNED);
      const typeFromIndex = entry?.typeLabel ? docTypeFromLabel(entry.typeLabel) : undefined;
      const type = typeFromIndex && typeFromIndex !== "peticao" ? typeFromIndex : classifyText(text) !== "outro" ? classifyText(text) : typeFromIndex || "outro";
      current = {
        courtId: m[1],
        title: entry?.title || DOC_TYPES[type],
        type,
        date: entry?.date || (signed ? findDates(signed[2])[0]?.iso : undefined),
        signer: signed ? titleCase(signed[1]) : undefined,
        pages: [page, page],
      };
      info.docs.push(current);
    } else current.pages[1] = page;
  });
  if (coverEnd > 0) info.docs.unshift({ title: "Capa e índice do processo", type: "outro", pages: [1, coverEnd] });
}

function parseEsaj(pages: string[], info: CaseFileInfo) {
  info.system = "e-SAJ";
  let current: FileDoc | null = null;
  let code = "";
  pages.forEach((text, i) => {
    const page = i + 1;
    const m = text.match(ESAJ_CODE);
    if (!m) {
      if (current) current.pages[1] = page;
      return;
    }
    if (m[1] !== code || !current) {
      code = m[1];
      const signed = text.match(ESAJ_SIGNED);
      const type = classifyText(text);
      current = {
        courtId: m[1],
        title: DOC_TYPES[type],
        type,
        date: signed ? findDates(signed[2])[0]?.iso : undefined,
        signer: signed ? titleCase(signed[1]) : undefined,
        pages: [page, page],
      };
      info.docs.push(current);
    } else current.pages[1] = page;
  });
  const anyText = pages.join("\n");
  const proc = fold(anyText).match(/informe o processo\s+(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
  if (proc) info.number = proc[1];
}

/* ---------- eproc ---------- */

// Tipos de documento do eproc pelo código ("INIC1" = petição inicial, "PROC2" = procuração). A ordem importa.
const EPROC_CODES: [RegExp, DocType, string][] = [
  [/^INIC/, "inicial", "Petição inicial"],
  [/^PROCADM/, "outro", "Processo administrativo"],
  [/^PROC/, "procuracao", "Procuração"],
  [/^SUBST/, "procuracao", "Substabelecimento"],
  [/^DECL/, "outro", "Declaração"],
  [/^(RG|CPF|CNH|IDENT|DOCPESS|CTPS|CERTNASC|CERTCAS)/, "pessoal", "Documento pessoal"],
  [/^(COMP|EXTR|FATURA|GUIA|CUSTAS|DARF|GRU|BOLETO|RECIBO|NF)/, "comprovante", "Comprovante"],
  [/^CONTES/, "contestacao", "Contestação"],
  [/^(CONTRAZ|CONTRARRAZ)/, "contrarrazoes", "Contrarrazões"],
  [/^CONTR/, "contrato", "Contrato"],
  [/^(REPLICA|IMPUGCONT)/, "replica", "Réplica"],
  [/^(APELACAO|APEL|AGRAVO|AGRINT|AGINT|EMBDECL|EMBARG|RECURSO|RECINO|RECESP|RECEXT|RESP|REXT|RECADESIVO)/, "recurso", "Recurso"],
  [/^DESPADEC/, "despacho", "Despacho ou decisão"],
  [/^DESP/, "despacho", "Despacho"],
  [/^DEC/, "decisao", "Decisão"],
  [/^SENT/, "sentenca", "Sentença"],
  [/^(ACOR|RELVOTO|VOTO|EMENTA|RELATORIO)/, "acordao", "Acórdão, relatório ou voto"],
  [/^CERT/, "certidao", "Certidão"],
  [/^ATOORD/, "ato", "Ato ordinatório"],
  [/^INTIM/, "intimacao", "Intimação"],
  [/^CITA/, "citacao", "Citação"],
  [/^MAND/, "mandado", "Mandado"],
  [/^(TERMOAUD|ATAAUD|ATA|TERMO)/, "ata", "Termo de audiência"],
  [/^LAUDO/, "laudo", "Laudo"],
  [/^(PARECER|PROMOCAO)/, "parecer", "Parecer"],
  [/^PET/, "peticao", "Petição"],
  [/^(CALC|PLANILHA)/, "outro", "Cálculo"],
  [/^OFIC/, "outro", "Ofício"],
  [/^AR$/, "outro", "Aviso de recebimento"],
  [/^INF/, "outro", "Informação"],
  [/^(OUT|ANEXO|DOC)/, "outro", "Outro documento"],
];

/** "INIC1" → { type: "inicial", label: "Petição inicial" } (null se não for código do eproc). */
export function eprocDoc(code: string): { type: DocType; label: string } | null {
  const m = code.match(/^([A-Z]{2,14})(\d{1,3})$/);
  if (!m) return null;
  for (const [re, type, label] of EPROC_CODES) if (re.test(m[1])) return { type, label };
  return null;
}

const EPROC_STAMP = /\b[Ee][Vv][Ee][Nn][Tt][Oo]\s*:?\s*(\d{1,4})\s*[,;:–-]?\s*(?:[Dd][Oo][Cc][Uu][Mm][Ee][Nn][Tt][Oo]\s*:?\s*)?([A-Z]{2,14}\d{1,3})\b/;
const EPROC_VERIFIER = /c[óo]digo verificador\s*:?\s*(\d{6,}v\d+)/i;
const EPROC_FOOTER = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\s+(\d{6,})\s*\.\s*V(\d+)\b/;
const EPROC_SIGNED = /(?:documento eletr[ôo]nico assinado por|assinado eletronicamente por|signat[áa]rio\s*\(a\)\s*:)\s*([^,\n]+?)\s*(?:,|\n|$)/i;
const EPROC_SIGNED_DATE = /(?:data e hora\s*:?|assinado[^\n]{0,80}?em)\s*(\d{2}\/\d{2}\/\d{4})/i;

interface EprocEvent {
  n: number;
  date: string;
  description: string;
}

/** Tabela de eventos da capa: "15  10/02/2023 14:22:33  Juntada de Contestação ... CONTES1 PROC2". */
function eprocEvents(lines: string[]): Map<string, EprocEvent> {
  const out = new Map<string, EprocEvent>();
  for (const line of lines) {
    const m = line.trim().match(/^(\d{1,4})\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}(?::\d{2})?\s+(.+)$/);
    if (!m) continue;
    const date = findDates(m[2])[0]?.iso;
    if (!date) continue;
    const codes = [...m[3].matchAll(/\b([A-Z]{2,14}\d{1,3})\b/g)].map((x) => x[1]).filter((c) => eprocDoc(c));
    const description = squash(m[3].replace(/\b[A-Z]{2,14}\d{1,3}\b/g, ""));
    for (const code of codes) out.set(`${Number(m[1])}:${code}`, { n: Number(m[1]), date, description });
    out.set(`${Number(m[1])}:`, { n: Number(m[1]), date, description });
  }
  return out;
}

const ROLE_HEADERS = [
  "ministerio publico", "polo ativo", "polo passivo", "terceiro interessado", "autoridade coatora", "autor", "autora", "reu", "re",
  "requerente", "requerido", "requerida", "exequente", "executado", "executada", "impetrante", "impetrado", "apelante", "apelado",
  "apelada", "agravante", "agravado", "agravada", "embargante", "embargado", "embargada", "recorrente", "recorrido", "recorrida",
  "reclamante", "reclamado", "reclamada", "interessado", "interessada", "perito", "perita", "assistente", "denunciante",
  "denunciado", "denunciada", "investigado", "vitima", "terceiro",
].sort((a, b) => b.length - a.length);

/** "AUTOR RÉU" → ["Autor", "Réu"]; null se a linha não for só de papéis. */
function roleHeader(line: string): string[] | null {
  const words = squash(line).split(" ").filter((w) => /\p{L}/u.test(w));
  const folded = words.map((w) => fold(w).replace(/[^a-z]/g, ""));
  if (!words.length || words.length > 8) return null;
  const roles: string[] = [];
  for (let i = 0; i < words.length; ) {
    const r = ROLE_HEADERS.find((h) => h.split(" ").every((x, k) => folded[i + k] === x));
    if (!r) return null;
    const n = r.split(" ").length;
    roles.push(titleCase(words.slice(i, i + n).join(" ")));
    i += n;
  }
  return roles;
}

const DOC_NUMBER = "\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}|\\d{2}\\.?\\d{3}\\.?\\d{3}\\/?\\d{4}-?\\d{2}";
const PARTY_ENTRY = new RegExp(`([^()]{3,140}?)\\s*\\((${DOC_NUMBER})\\)`, "g");
const LAWYER_ENTRY = /([^()]{3,120}?)\s*\((?:OAB\s*\/?\s*)?([A-Z]{2})\s*-?\s*(\d{3,7}[A-Z]?)\)/g;
// "Procurador(es):" ou "Advogado:" antes do nome; exige os dois-pontos para não cortar o início de "Procuradoria"
const ROLE_PREFIX = /^(?:procurador(?:es|as?|\((?:es|a|as)\))?|advogad[oa]s?(?:\((?:s|as)\))?)\s*:\s*/i;

/** "Partes e Representantes" do eproc: colunas por polo (AUTOR | RÉU), parte com CPF/CNPJ e procuradores com OAB. */
function eprocParties(cover: string[]): FileParty[] {
  const lines = section(cover, /^partes e representantes/, /^(informacoes adicionais|assuntos?\b|eventos?\b|evento\s+data|lembretes|acoes\b)/);
  const out: FileParty[] = [];
  let columns: string[] = [];
  let lastOf: FileParty[] = [];
  for (const raw of lines) {
    const line = squash(raw);
    if (!line) continue;
    const header = roleHeader(line);
    if (header) {
      columns = header;
      lastOf = [];
      continue;
    }
    if (!columns.length) continue;
    const lawyers = [...line.matchAll(LAWYER_ENTRY)];
    const parties = [...line.matchAll(PARTY_ENTRY)];
    if (parties.length) {
      parties.forEach((m, i) => {
        const role = columns[Math.min(i, columns.length - 1)];
        const name = squash(m[1].replace(/^[\s:;,–-]+/, "").replace(ROLE_PREFIX, ""));
        const party = { name: titleCase(name), role, pole: poleOfRole(role), lawyers: [] as string[] };
        if (!out.some((p) => fold(p.name) === fold(party.name))) out.push(party);
        lastOf[Math.min(i, columns.length - 1)] = party;
      });
      continue;
    }
    lawyers.forEach((m, i) => {
      const owner = lastOf[Math.min(i, columns.length - 1)] || lastOf.find(Boolean);
      const name = squash(m[1].replace(/^[\s:;,–-]+/, "").replace(ROLE_PREFIX, ""));
      if (owner && name) owner.lawyers.push(`${titleCase(name)} (${m[2]}${m[3]})`);
    });
  }
  return out;
}

function parseEproc(pages: string[], info: CaseFileInfo, outline?: OutlineEntry[]) {
  info.system = "eproc";
  const keyOf = (text: string): { key: string; event?: number; code?: string; verifier?: string } | null => {
    const st = text.match(EPROC_STAMP);
    if (st && eprocDoc(st[2])) return { key: `${Number(st[1])}:${st[2]}`, event: Number(st[1]), code: st[2] };
    const ver = text.match(EPROC_VERIFIER) || text.match(EPROC_FOOTER);
    if (ver) return { key: `cv:${ver[1].replace(/v\d+$/i, "")}`, verifier: ver[1] };
    return null;
  };
  const keyed = pages.map(keyOf);
  // sem o carimbo do evento nas páginas, os marcadores do PDF separam os documentos melhor que o código verificador
  const marks = docMarks(outline || [], pages.length);
  const byOutline = marks.length > 0 && !keyed.some((k) => k?.event !== undefined);
  const firstDoc = byOutline ? marks[0].page - 1 : keyed.findIndex(Boolean);
  const coverEnd = firstDoc < 0 ? Math.min(pages.length, 1) : firstDoc;
  const cover = pages.slice(0, Math.max(coverEnd, 1)).join("\n").split("\n");
  parseCover(cover, info);
  info.parties = eprocParties(cover);
  const events = eprocEvents(cover);
  if (byOutline) return splitByOutline(pages, marks, info, events);
  if (firstDoc < 0) return;
  let current: FileDoc | null = null;
  let currentKey = "";
  keyed.forEach((k, i) => {
    const page = i + 1;
    if (page <= coverEnd) return;
    if (!k || k.key === currentKey) {
      if (current) current.pages[1] = page;
      return;
    }
    currentKey = k.key;
    const text = pages[i];
    const known = k.code ? eprocDoc(k.code) : null;
    const byText = classifyText(text);
    const type = known && known.type !== "outro" && !(known.type === "despacho" && byText === "decisao") ? known.type : byText !== "outro" ? byText : known?.type || "outro";
    const ev = k.event !== undefined ? events.get(`${k.event}:${k.code}`) || events.get(`${k.event}:`) : undefined;
    const signed = text.match(EPROC_SIGNED);
    const signedDate = text.match(EPROC_SIGNED_DATE);
    current = {
      courtId: k.code ? `Evento ${k.event}, ${k.code}` : k.verifier,
      title: k.code ? `${known && known.type === type ? known.label : DOC_TYPES[type]} (${k.code})` : DOC_TYPES[type],
      type,
      date: ev?.date || (signedDate ? findDates(signedDate[1])[0]?.iso : undefined),
      signer: signed ? titleCase(signed[1]) : undefined,
      pages: [page, page],
    };
    info.docs.push(current);
  });
  if (coverEnd > 0) info.docs.unshift({ title: "Capa do processo", type: "outro", pages: [1, coverEnd] });
}

const EVENT_TITLE = /\bevento\s*:?\s*(\d{1,4})/i;

/** Código de documento do eproc no título do marcador ("INIC1", "Evento 1 - CONTES1"). */
function codeIn(title: string): string | undefined {
  for (const m of title.matchAll(/\b([A-Z]{2,14}\d{1,3})\b/g)) if (eprocDoc(m[1])) return m[1];
  return undefined;
}

/**
 * Marcadores que começam um documento. No eproc, os que têm o código do documento (INIC1, PROC2...) ou, sem os códigos,
 * os de baixo de cada evento. Nos outros sistemas, o primeiro nível com mais de um marcador: os de baixo costumam ser
 * seções do mesmo documento.
 */
function docMarks(outline: OutlineEntry[], pageCount: number): OutlineEntry[] {
  const valid = outline.filter((o) => o.page >= 1 && o.page <= pageCount);
  let marks = valid.filter((o) => codeIn(o.title));
  if (!marks.length && valid.some((o) => EVENT_TITLE.test(o.title))) marks = valid.filter((o) => o.leaf !== false);
  if (!marks.length) {
    const depthOf = (o: OutlineEntry) => o.depth || 0;
    const depths = [...new Set(valid.map(depthOf))].sort((a, b) => a - b);
    const level = depths.find((d) => valid.filter((o) => depthOf(o) === d).length >= 2) ?? depths[0];
    marks = valid.filter((o) => depthOf(o) === level);
  }
  return marks.sort((a, b) => a.page - b.page).filter((o, i, list) => i === 0 || o.page !== list[i - 1].page);
}

/** Separa os documentos pelos marcadores do PDF: cada um começa um documento, que vai até o próximo. */
function splitByOutline(pages: string[], marks: OutlineEntry[], info: CaseFileInfo, events = new Map<string, EprocEvent>()) {
  if (!marks.length) return;
  if (marks[0].page > 1) info.docs.push({ title: "Capa do processo", type: "outro", pages: [1, marks[0].page - 1] });
  marks.forEach((o, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].page - 1 : pages.length;
    const code = codeIn(o.title);
    const known = code ? eprocDoc(code) : null;
    const eventIn = o.parent && EVENT_TITLE.test(o.parent) ? o.parent : undefined;
    const event = Number((o.title.match(EVENT_TITLE) || eventIn?.match(EVENT_TITLE))?.[1]) || undefined;
    const text = pages[o.page - 1] || "";
    const byText = classifyText(text);
    const type = known && known.type !== "outro" ? known.type : docTypeFromLabel(o.title) || (byText !== "outro" ? byText : known?.type || "outro");
    const ev = event !== undefined ? events.get(`${event}:${code}`) || events.get(`${event}:`) : undefined;
    const signed = text.match(EPROC_SIGNED) || text.match(PJE_SIGNED);
    // marcador que é só o código ("INIC1") ganha o nome do documento; sem o código, o evento ajuda a achá-lo nos autos
    const onlyCode = !!known && fold(o.title).replace(/[^a-z0-9]/g, "") === fold(code!);
    const title = onlyCode ? `${known!.label} (${code})` : !code && event && !EVENT_TITLE.test(o.title) ? `${o.title} (Evento ${event})` : o.title;
    info.docs.push({
      courtId: event && code ? `Evento ${event}, ${code}` : `${o.title} · p. ${o.page}`,
      title,
      type,
      date: ev?.date || findDates(o.title)[0]?.iso || (eventIn ? findDates(eventIn)[0]?.iso : undefined),
      signer: signed ? titleCase(signed[1]) : undefined,
      pages: [o.page, Math.max(o.page, end)],
    });
  });
}

/** Partes escritas como "Autor: FULANO" ou "Requerido: BANCO X" (petições, capas de outros sistemas). */
function partiesFromLabels(text: string): FileParty[] {
  const out: FileParty[] = [];
  const re = /^\s*(autor\w*|requerente\w*|reclamante\w*|exequente\w*|impetrante\w*|apelante\w*|agravante\w*|recorrente\w*|reu|re|reus|requerid\w*|reclamad\w*|executad\w*|impetrad\w*|apelad\w*|agravad\w*|recorrid\w*)\s*(?:\(s\)|\(a\)|\(as\))?\s*:\s*(.+)$/;
  for (const line of text.split("\n").slice(0, 400)) {
    const m = fold(line).match(re);
    if (!m) continue;
    const name = squash(line.slice(line.length - m[2].length)).replace(/\s*\(.*$/, "");
    if (name.length < 3 || name.length > 120) continue;
    if (!out.some((p) => fold(p.name) === fold(name))) out.push({ name: titleCase(name), role: titleCase(m[1]), pole: poleOfRole(m[1]), lawyers: [] });
  }
  return out;
}

/**
 * Como mostrar a referência do documento nos autos: "Id. 123" no PJe e no e-SAJ, "Evento 1, INIC1" no eproc.
 * Os separados só pelos marcadores do PDF (título · página) não têm referência própria para mostrar.
 */
export function courtRef(courtId?: string): string | undefined {
  if (!courtId || courtId.includes(" · p. ")) return undefined;
  if (/^evento\b/i.test(courtId)) return courtId;
  if (/^\d{6,}v\d+$/i.test(courtId)) return `Cód. verificador ${courtId}`;
  return `Id. ${courtId}`;
}

/** Lê o texto das páginas do processo integral (e os marcadores do PDF, quando houver). */
export function parseCaseFile(pages: string[], opts: { outline?: OutlineEntry[] } = {}): CaseFileInfo {
  const info: CaseFileInfo = { parties: [], docs: [] };
  const sample = pages.slice(0, 12).join("\n");
  const eprocStamps = pages.filter((p) => EPROC_STAMP.test(p)).length;
  const eprocHints =
    /partes e representantes|informa[çc][õo]es adicionais|eproc|c[óo]digo verificador/i.test(sample) ||
    !!opts.outline?.some((o) => codeIn(o.title)) ||
    (opts.outline || []).filter((o) => /^\s*evento\s*:?\s*\d/i.test(o.title)).length >= 2;
  if (pages.some((p) => PJE_STAMP.test(p))) parsePje(pages, info);
  else if (pages.filter((p) => ESAJ_CODE.test(p)).length >= Math.min(2, pages.length)) parseEsaj(pages, info);
  else if (eprocStamps >= 1 || eprocHints) parseEproc(pages, info, opts.outline);
  else {
    const marks = docMarks(opts.outline || [], pages.length);
    if (marks.length >= 2) {
      parseCover(pages.slice(0, 2).join("\n").split("\n"), info);
      splitByOutline(pages, marks, info);
    }
  }

  if (!info.number) {
    // número mais frequente nas primeiras páginas
    const count = new Map<string, number>();
    for (const m of sample.matchAll(CNJ_RE)) {
      const c = parseCnj(m[0]);
      if (c) count.set(formatCnj(c), (count.get(formatCnj(c)) || 0) + 1);
    }
    info.number = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  if (!info.parties.length) info.parties = partiesFromLabels(sample);
  if (!info.docs.length) info.docs.push({ title: "Processo integral", type: "processo", pages: [1, Math.max(1, pages.length)] });
  return info;
}
