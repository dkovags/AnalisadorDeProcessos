import { classifyText, docTypeFromLabel } from "./analysis";
import { CNJ_RE, formatCnj, parseCnj } from "./cnj";
import { validDate } from "./dates";
import { DOC_TYPES } from "./labels";
import type { DocType, PersonKind, Pole } from "./types";
import { findDates, fold, isUpper, parseMoney, squash, titleCase } from "./text";

// Leitura do PDF do processo inteiro baixado do sistema do tribunal ("processo integral").
// PJe: capa com os dados do processo, partes e índice de documentos; cada página tem o carimbo "Num. <Id> - Pág. <n>".
// eproc: capa com "Partes e Representantes" (uma coluna por polo) e, em alguns tribunais, a tabela de eventos; antes de
//   cada evento, uma "página de separação" com a descrição e a data; cada página dos documentos traz o carimbo
//   "Processo <número>, Evento <n>, <documento>, Página <p>" (INIC1, PROC2...) e os marcadores dizem o nome de cada um
//   ("Evento 1 - Doc. 2 - PROCURAÇÃO"). As decisões trazem o código verificador.
// e-SAJ: cada página traz na margem "assinado digitalmente por ..., protocolado em ..., código <X>".
// Qualquer sistema: quando o PDF tem marcadores (índice), cada marcador vira um documento.
// Sem nada disso, o arquivo inteiro vira um documento (continua pesquisável página por página).

export interface FileParty {
  name: string;
  role: string;
  pole: Pole;
  lawyers: string[];
  /** CPF ou CNPJ, quando a capa traz. */
  doc?: string;
  /** Tipo de pessoa (no eproc, a capa diz "Pessoa Física", "Pessoa Jurídica" ou "Entidade"). */
  kind?: PersonKind;
}

/** Movimentação do processo (no eproc, cada evento). */
export interface FileEvent {
  n: number;
  date: string;
  text: string;
}

/** Trecho de texto com a posição na página (vem da leitura do PDF), para ler tabelas em colunas. */
export interface LayoutSegment {
  x: number;
  y: number;
  w: number;
  text: string;
}

export interface FileDoc {
  courtId?: string;
  title: string;
  /** Tipo do documento como o sistema do tribunal o chama ("Carta de Preposição", "Atos Constitutivos"). */
  label?: string;
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
  /** Movimentações (os eventos do eproc), que entram nos andamentos. */
  events?: FileEvent[];
  /** Parte do arquivo, quando o sistema divide o processo em vários PDFs ("Capa: Parte 2"). */
  part?: number;
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
// o código do e-SAJ tem algum algarismo (não confundir com o "código verificador" do eproc)
const ESAJ_CODE = /c[óo]digo\s+(?=[0-9A-Za-z]*\d)([0-9A-Za-z]{6,})/;
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
  // "Número: ...", "Nº do processo ..." (no eproc, sem os dois-pontos): vale a primeira linha com um número CNJ
  for (const line of cover) {
    if (!/^\s*(?:n[o.°]?\s*(?:do\s+)?processo|numero(?:\s+do\s+processo)?|processo\s*n?[o.°]*)\b/.test(fold(line))) continue;
    const c = parseCnj(line.match(CNJ_RE)?.[0] || "");
    if (c) {
      info.number = formatCnj(c);
      break;
    }
  }
  const cls = field(cover, /^\s*classe(?:\s+(?:da acao|processual|judicial))?\s*:/);
  if (cls) info.className = isUpper(cls) ? titleCase(cls) : cls;
  const body = field(cover, /^\s*(?:orgao julgador(?:\s+colegiado)?|juizo|vara)\s*:/);
  if (body) info.body = isUpper(body) ? titleCase(body) : body;
  const dist = field(cover, /^\s*(?:ultima distribuicao|data da distribuicao|distribuicao|data de autuacao|data da autuacao|autuacao|autuado em)\s*:/);
  if (dist) info.filedAt = findDates(dist)[0]?.iso;
  // no eproc, o valor e o sigilo vêm no meio da linha ("Chave Processo: ... Valor da Causa: R$ ...")
  const value = field(cover, /\bvalor da causa\s*:/);
  if (value) info.value = parseMoney(value) ?? undefined;
  const subjects = field(cover, /^\s*assuntos?\s*:/);
  if (subjects) info.subjects = isUpper(subjects) ? titleCase(subjects) : subjects;
  else {
    // eproc: seção "Assuntos" em tabela (código, descrição, principal)
    const rows = section(cover, /^assuntos?$/, SECTION_END)
      .map((l) => squash(l.replace(/^\s*\d{3,12}\s+/, "").replace(/\s+(sim|nao|não)\s*$/i, "")))
      .filter((l) => l.length > 3 && !/^(codigo|descricao)/.test(fold(l)));
    if (rows.length) info.subjects = rows.slice(0, 6).map((r) => (isUpper(r) ? titleCase(r) : r)).join("; ");
  }
  const secret = field(cover, /^\s*segredo de justica\s*/);
  if (secret) info.secret = /^sim/i.test(fold(secret));
  const sigilo = field(cover, /\bnivel de sigilo[^:]*:/);
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
        label: entry?.typeLabel,
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
  [/^EMENDA/, "peticao", "Emenda à inicial"],
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
  [/^PED/, "peticao", "Pedido"],
  [/^PET/, "peticao", "Petição"],
  [/^(CALC|PLANILHA)/, "outro", "Cálculo"],
  [/^OFIC/, "outro", "Ofício"],
  [/^AR$/, "outro", "Aviso de recebimento"],
  [/^INF/, "outro", "Informação"],
  [/^(OUT|ANEXO|DOC)/, "outro", "Outro documento"],
];

/**
 * "INIC1" → { type: "inicial", label: "Petição inicial" } (null se não for código do eproc). Aceita os códigos que
 * alguns tribunais escrevem com minúsculas, espaço ou sublinhado ("CertAutMotNRec1", "PED LIMINAR_ANT TUTE1").
 */
export function eprocDoc(code: string): { type: DocType; label: string } | null {
  const m = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .match(/^([A-Z]{2,30})(\d{1,3})$/);
  if (!m) return null;
  for (const [re, type, label] of EPROC_CODES) if (re.test(m[1])) return { type, label };
  return null;
}

// carimbo de cada página: "Processo 5001234-56.2023.4.04.7100/RS, Evento 1, INIC1, Página 1"
const EPROC_PAGE_STAMP = /Processo\s+\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}(?:\/[A-Z]{2})?\s*,\s*Evento\s+(\d{1,4})\s*,\s*([^,\n]{2,40}?)\s*,\s*P[áa]gina\s+\d{1,4}/i;
// outras formas do carimbo ("Evento: 1 Documento: INIC1")
const EPROC_STAMP = /\b[Ee][Vv][Ee][Nn][Tt][Oo]\s*:?\s*(\d{1,4})\s*[,;:–-]?\s*(?:[Dd][Oo][Cc][Uu][Mm][Ee][Nn][Tt][Oo]\s*:?\s*)?([A-Z]{2,14}\d{1,3})\b/;
const EPROC_VERIFIER = /c[óo]digo verificador\s*:?\s*(\d{6,}v\d+)/i;
const EPROC_FOOTER = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\s+(\d{6,})\s*\.\s*V(\d+)\b/;
const EPROC_SIGNED = /(?:documento eletr[ôo]nico assinado por|assinado eletronicamente por|signat[áa]rio\s*\(a\)\s*:)\s*([^,\n]+?)\s*(?:,|\n|$)/i;
const EPROC_SIGNED_DATE = /(?:data e hora\s*:?|assinado[^\n]{0,160}?em)\s*(\d{2}\/\d{2}\/\d{4})/i;
const EPROC_SEPARATOR = /P[ÁA]GINA DE SEPARA[ÇC][ÃA]O/i;
// marcador de documento: "Evento 1 - Doc. 2 - PROCURAÇÃO" (abaixo dele, um marcador por página: "Pág. 1", "Pág. 2"...)
const EPROC_DOC_MARK = /^\s*Evento\s+(\d{1,4})\s*[-–]\s*Doc\.?\s*(\d{1,3})\s*[-–]\s*(.+?)\s*$/i;

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

/** Página de separação que o eproc põe antes de cada evento: número, descrição e data. */
function eprocSeparator(text: string): EprocEvent | null {
  const flat = squash(text);
  const n = Number(flat.match(/Sequ[êe]ncia\s+Evento\s*:\s*(\d{1,4})/i)?.[1] || flat.match(/\bEvento\s+(\d{1,4})\s+Evento\s*:/i)?.[1]);
  const m = flat.match(/\bEvento\s*:\s*(.+?)\s*Data\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const date = m ? findDates(m[2])[0]?.iso : undefined;
  return n && m && date ? { n, date, description: m[1] } : null;
}

// palavras que o eproc escreve sem acento, e as barras que ele tira ("DECISAO/DESPACHO" vira "DECISAODESPACHO")
const EVENT_WORDS: Record<string, string> = {
  acordao: "acórdão", alteracao: "alteração", antecipacao: "antecipação", apelacao: "apelação", audiencia: "audiência",
  certidao: "certidão", ciencia: "ciência", citacao: "citação", conclusao: "conclusão", contestacao: "contestação",
  decisao: "decisão", diligencia: "diligência", distribuido: "distribuído", eletronica: "eletrônica",
  eletronico: "eletrônico", execucao: "execução", expedicao: "expedição", homologacao: "homologação",
  incluidos: "incluídos", incompetencia: "incompetência", inicio: "início", interlocutoria: "interlocutória",
  intimacao: "intimação", juizo: "juízo", justica: "justiça", manifestacao: "manifestação",
  movimentacao: "movimentação", nao: "não", nucleo: "núcleo", obito: "óbito", oficio: "ofício",
  ordinatorio: "ordinatório", peticao: "petição", publicacao: "publicação", replica: "réplica", sentenca: "sentença",
  suspensao: "suspensão", tacita: "tácita", termino: "término", tramitacao: "tramitação", transito: "trânsito",
  refer: "ref.",
  decisaodespacho: "decisão/despacho", expedidacertificada: "expedida/certificada",
  liminarantecipacao: "liminar/antecipação", gratuitapedido: "gratuita/pedido",
};
const EVENT_ACRONYMS = new Set(["djen", "dje", "mp", "inss", "oab", "cpf", "cnpj", "ar", "rpv", "gru", "tj", "stj", "stf", "trf", "sisbajud", "renajud"]);

/** "CONCLUSOS PARA DECISAODESPACHO" → "Conclusos para decisão/despacho" (com acentos, datas e siglas). */
export function eventText(description: string): string {
  const s = squash(description)
    .toLowerCase()
    .replace(/\bjustica 40\b/g, "justiça 4.0")
    .replace(/\bjuizo 100 digital\b/g, "juízo 100% digital")
    .replace(/\b(\d{2})(\d{2})(\d{4})\b/g, (m, d: string, mo: string, y: string) => (validDate(Number(y), Number(mo), Number(d)) ? `${d}/${mo}/${y}` : m))
    .replace(/\bn (?=\d)/g, "nº ")
    .split(" ")
    .map((w) => (EVENT_ACRONYMS.has(w) || (/\d/.test(w) && /[a-z]/.test(w)) ? w.toUpperCase() : EVENT_WORDS[w] ?? w))
    .join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Decisão, despacho ou sentença pela descrição do evento (só quando ela fala de um deles). */
function orderKind(description: string): DocType | undefined {
  const f = fold(description);
  const kinds: DocType[] = [];
  if (/sentenca|julgad[oa]s?\s+(procedente|improcedente)|extint[oa]/.test(f)) kinds.push("sentenca");
  if (/decisao|liminar|tutela|deferid|indeferid|concedid|declarad/.test(f)) kinds.push("decisao");
  if (/despacho|mero expediente/.test(f)) kinds.push("despacho");
  return kinds.length === 1 ? kinds[0] : undefined;
}

const ACRONYMS = new Set(["MP", "OAB", "INSS", "CPF", "CNPJ", "RPV", "SUS", "DJEN", "DJE", "AR", "TJ", "STJ", "STF", "TRF", "CEF", "ECT"]);

/** "DECLARAÇÃO DE HIPOSSUFICIÊNCIA/POBREZA" → "Declaração de hipossuficiência/pobreza" (mantém siglas, como "GM"). */
function labelCase(label: string): string {
  const t = squash(label);
  if (!isUpper(t)) return t;
  const out = t
    .split(" ")
    .map((w) => (ACRONYMS.has(w) || /^[B-DF-HJ-NP-TV-Z]{2,4}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// rótulos que não dizem o que é o documento: o texto diz
const GENERIC_LABEL = /^(outros?( documentos?)?|anexos?|documentos?( diversos)?|diversos)$/;

/** Documento do eproc: o rótulo do marcador (ou o código do carimbo) dá o tipo e o nome; a descrição do evento afina. */
function eprocFileDoc(
  d: { event?: number; code?: string; label?: string },
  text: string,
  events: Map<string, EprocEvent>,
): Omit<FileDoc, "courtId" | "pages"> {
  const known = d.code ? eprocDoc(d.code) : null;
  const ev = d.event !== undefined ? events.get(`${d.event}:${d.code}`) || events.get(`${d.event}:`) : undefined;
  const byText = classifyText(text);
  const generic = d.label ? GENERIC_LABEL.test(fold(d.label).trim()) : !!d.code && /^(OUT|ANEXO|DOC)\d/i.test(d.code);
  let type: DocType;
  let title: string;
  if (generic) {
    type = byText;
    title = byText !== "outro" ? DOC_TYPES[byText] : d.label ? labelCase(d.label) : known?.label || DOC_TYPES.outro;
  } else {
    const base = (d.label && docTypeFromLabel(d.label)) || (known && known.type !== "outro" ? known.type : undefined) || (byText !== "outro" ? byText : known?.type || "outro");
    type = base;
    title = d.label ? labelCase(d.label) : known && known.type === base ? known.label : DOC_TYPES[base];
    if (base === "despacho" || base === "decisao" || base === "sentenca") {
      // "DESPACHO/DECISÃO": a descrição do evento ("DECISAO INTERLOCUTORIA") ou o texto dizem qual dos dois é
      const byEvent = ev ? orderKind(ev.description) : undefined;
      const refined = byEvent || (byText === "despacho" || byText === "decisao" || byText === "sentenca" ? byText : undefined);
      if (refined) type = refined;
      const prefix = { sentenca: "senten", decisao: "decis", despacho: "despach" } as Record<string, string>;
      if (byEvent && fold(ev!.description).startsWith(prefix[byEvent])) title = eventText(ev!.description);
      else if (refined && (refined !== base || /despacho\s*\/\s*decis/.test(fold(title)))) title = DOC_TYPES[refined];
    }
  }
  // o código vai no nome quando é curto ("INIC1"); os longos ficam só na referência (evento e documento)
  const showCode = !!d.code && /^[A-Za-z]{2,10}\d{1,3}$/.test(d.code);
  return { title: showCode ? `${title} (${d.code})` : title, type, date: ev?.date };
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
const PARTY_DOC = new RegExp(`\\s*\\((${DOC_NUMBER})\\)`);
// tipo de pessoa depois do nome: "FULANO (CPF) - Pessoa Física", "MUNICÍPIO X (CNPJ) - Entidade"
const PARTY_KIND = /\s*[-–]\s*(pessoa f[íi]sica|pessoa jur[íi]dica|entidade|[óo]rg[ãa]o p[úu]blico|ente p[úu]blico)\s*$/i;
const PARTY_KIND_START = /^[-–\s]*(pessoa f[íi]sica|pessoa jur[íi]dica|entidade)\s+/i;
const LAWYER_ENTRY = /([^()]{3,120}?)\s*\((?:OAB\s*\/?\s*)?([A-Z]{2})\s*-?\s*(\d{3,7}[A-Z]?)\)/g;
// procurador numa linha só: "FULANA RJ123456" (OAB), "BELTRANO PGM123456" (procuradoria) ou "CICLANO (RS054321)"
const LAWYER_LINE = /^(.{3,120}?)\s+\(?(?:OAB\s*\/?\s*)?([A-Z]{2,5})\s*-?\s*(\d{3,10}[A-Z]?)\)?$/;
// "Procurador(es):" ou "Advogado:" antes do nome; exige os dois-pontos para não cortar o início de "Procuradoria"
const ROLE_PREFIX = /^(?:procurador(?:es|as?|\((?:es|a|as)\))?|advogad[oa]s?(?:\((?:s|as)\))?)\s*:\s*/i;
const PARTIES_END = /^(informacoes adicionais|assuntos?\b|eventos?\b|evento\s+data|lembretes|acoes\b)/;
// entes com prazo em dobro (CPC, arts. 180, 183 e 186)
const PUBLIC_NAME = /^(uniao\b|estado d[aeo]s?\b|municipio d[aeo]s?\b|prefeitura|distrito federal|fazenda (nacional|publica|do estado|estadual|municipal)|instituto nacional do seguro social|inss\b|ministerio publico|defensoria publica|procuradoria)/;

function kindOf(name: string, doc?: string, kindLabel?: string): PersonKind | undefined {
  const label = kindLabel ? fold(kindLabel) : "";
  if (/entidade|orgao publico|ente publico/.test(label) || PUBLIC_NAME.test(fold(name))) return "publico";
  if (/pessoa fisica/.test(label)) return "pf";
  if (/pessoa juridica/.test(label)) return "pj";
  const digits = doc?.replace(/\D/g, "").length;
  return digits === 11 ? "pf" : digits === 14 ? "pj" : undefined;
}

/** "FULANO (123.456.789-09) - Pessoa Física" → parte; null se não parecer uma parte. */
function partyEntry(text: string): { name: string; doc?: string; kind?: PersonKind } | null {
  let t = squash(text).replace(/^[\s:;,–-]+/, "").replace(ROLE_PREFIX, "");
  const kindLabel = t.match(PARTY_KIND)?.[1];
  t = t.replace(PARTY_KIND, "");
  const doc = t.match(PARTY_DOC)?.[1];
  if (!doc && !kindLabel) return null;
  const name = squash(t.replace(PARTY_DOC, "").replace(/\s*[-–]\s*$/, ""));
  return name.length >= 3 ? { name, doc, kind: kindOf(name, doc, kindLabel) } : null;
}

/** "FULANA RJ123456" ou "CICLANO (RS054321)" → "Fulana (RJ123456)"; null se não parecer um procurador. */
function lawyerEntry(text: string): string | null {
  const m = squash(text).replace(/^[\s:;,–-]+/, "").replace(ROLE_PREFIX, "").match(LAWYER_LINE);
  // um CPF ou CNPJ no nome é de parte, não de procurador ("4ª Região" pode)
  return m && !PARTY_DOC.test(m[1]) ? `${titleCase(m[1])} (${m[2]}${m[3]})` : null;
}

/** Junta a parte à lista (a mesma parte pode aparecer duas vezes, com e sem o CNPJ) e devolve a que ficou. */
function addParty(out: FileParty[], p: { name: string; doc?: string; kind?: PersonKind }, role: string): FileParty {
  const name = titleCase(p.name);
  const same = out.find((x) => fold(x.name) === fold(name));
  if (same) {
    same.doc ||= p.doc;
    if (!same.kind || p.kind === "publico") same.kind = p.kind || same.kind;
    return same;
  }
  const party: FileParty = { name, role, pole: poleOfRole(role), lawyers: [], doc: p.doc, kind: p.kind };
  out.push(party);
  return party;
}

/** "Partes e Representantes" pelo texto: as partes de cada polo lado a lado na mesma linha (AUTOR | RÉU). */
function eprocParties(cover: string[]): FileParty[] {
  const lines = section(cover, /^partes e representantes/, PARTIES_END);
  const out: FileParty[] = [];
  let columns: string[] = [];
  let lastOf: (FileParty | undefined)[] = [];
  let last: FileParty | undefined;
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
    const parties = [...line.matchAll(PARTY_ENTRY)];
    if (parties.length) {
      parties.forEach((m, i) => {
        const col = Math.min(i, columns.length - 1);
        const name = squash(m[1].replace(/^[\s:;,–-]+/, "").replace(PARTY_KIND_START, "").replace(ROLE_PREFIX, ""));
        last = lastOf[col] = addParty(out, { name, doc: m[2], kind: kindOf(name, m[2]) }, columns[col]);
      });
      continue;
    }
    const single = partyEntry(line);
    if (single) {
      last = lastOf[0] = addParty(out, single, columns[0]);
      continue;
    }
    const lawyers = [...line.matchAll(LAWYER_ENTRY)];
    if (lawyers.length) {
      lawyers.forEach((m, i) => {
        const owner = lastOf[Math.min(i, columns.length - 1)] || last;
        const name = squash(m[1].replace(/^[\s:;,–-]+/, "").replace(ROLE_PREFIX, ""));
        if (owner && name) owner.lawyers.push(`${titleCase(name)} (${m[2]}${m[3]})`);
      });
      continue;
    }
    const lawyer = lawyerEntry(line);
    if (lawyer && last) last.lawyers.push(lawyer);
  }
  return out;
}

/**
 * "Partes e Representantes" pela posição dos textos na capa: cada coluna da tabela é um polo (REQUERENTE | REQUERIDO),
 * e cada parte ou procurador vai para a coluna mais próxima. É o que funciona quando as partes de cada polo estão em
 * alturas diferentes e o texto, sozinho, as mistura.
 */
function eprocPartiesFromLayout(coverLayout: LayoutSegment[][]): FileParty[] {
  const segs = coverLayout
    .flatMap((page, k) => (page || []).map((s) => ({ ...s, y: s.y - k * 10000 })))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const start = segs.findIndex((s) => /^partes e representantes/.test(fold(s.text)));
  if (start < 0) return [];
  const rows: LayoutSegment[][] = [];
  for (const s of segs.slice(start + 1)) {
    if (PARTIES_END.test(fold(s.text))) break;
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - s.y) <= 2) row.push(s);
    else rows.push([s]);
  }
  const out: FileParty[] = [];
  let columns: { role: string; center: number }[] = [];
  let lastOf: (FileParty | undefined)[] = [];
  let pending: (string | undefined)[] = [];
  const nearest = (x: number) => columns.reduce((best, c, i) => (Math.abs(c.center - x) < Math.abs(columns[best].center - x) ? i : best), 0);
  for (const row of rows) {
    const roles = row.map((s) => roleHeader(s.text));
    if (roles.every((r) => r?.length === 1)) {
      columns = row.map((s, i) => ({ role: roles[i]![0], center: s.x + s.w / 2 }));
      lastOf = [];
      pending = [];
      continue;
    }
    // os papéis num trecho só ("AUTOR RÉU"): cada um fica com uma parte igual da largura
    if (row.length === 1 && (roles[0]?.length || 0) > 1) {
      const [s] = row;
      const parts = roles[0]!;
      columns = parts.map((role, i) => ({ role, center: s.x + (s.w * (i + 0.5)) / parts.length }));
      lastOf = [];
      pending = [];
      continue;
    }
    if (!columns.length) continue;
    for (const s of row) {
      // tabela apertada: duas colunas no mesmo trecho; cada entrada vai para uma coluna, da esquerda para a direita
      const manyParties = [...s.text.matchAll(PARTY_ENTRY)];
      const manyLawyers = manyParties.length > 1 ? [] : [...s.text.matchAll(LAWYER_ENTRY)];
      if (manyParties.length > 1 || manyLawyers.length > 1) {
        const first = nearest(s.x);
        manyParties.forEach((m, i) => {
          const col = Math.min(first + i, columns.length - 1);
          const name = squash(m[1].replace(/^[\s:;,–-]+/, "").replace(PARTY_KIND_START, "").replace(ROLE_PREFIX, ""));
          lastOf[col] = addParty(out, { name, doc: m[2], kind: kindOf(name, m[2]) }, columns[col].role);
        });
        manyLawyers.forEach((m, i) => {
          const owner = lastOf[Math.min(first + i, columns.length - 1)];
          const lawyer = `${titleCase(squash(m[1].replace(/^[\s:;,–-]+/, "").replace(ROLE_PREFIX, "")))} (${m[2]}${m[3]})`;
          if (owner && !owner.lawyers.includes(lawyer)) owner.lawyers.push(lawyer);
        });
        pending = [];
        continue;
      }
      const col = nearest(s.x + s.w / 2);
      const text = pending[col] ? `${pending[col]} ${s.text}` : s.text;
      const party = partyEntry(text);
      if (party) {
        pending[col] = undefined;
        lastOf[col] = addParty(out, party, columns[col].role);
        continue;
      }
      const lawyer = lawyerEntry(s.text);
      if (lawyer) {
        pending[col] = undefined;
        const owner = lastOf[col];
        if (owner && !owner.lawyers.includes(lawyer)) owner.lawyers.push(lawyer);
        continue;
      }
      // rótulo ("Procurador(es):") ou nome comprido que continua na linha de baixo
      pending[col] = /^(procurador|advogad|defensor|representante)/.test(fold(s.text)) ? undefined : text;
    }
  }
  return out;
}

/** Quem assinou e quando: a assinatura fica no fim do documento. */
function eprocSignatures(pages: string[], docs: FileDoc[]) {
  for (const d of docs) {
    if (d.signer) continue;
    for (let p = d.pages[1]; p >= d.pages[0] && p > d.pages[1] - 3; p--) {
      const text = pages[p - 1] || "";
      const signed = text.match(EPROC_SIGNED);
      if (!signed) continue;
      d.signer = titleCase(signed[1].replace(/[\s.;:]+$/, ""));
      const when = text.match(EPROC_SIGNED_DATE);
      if (!d.date && when) d.date = findDates(when[1])[0]?.iso;
      break;
    }
  }
}

function parseEproc(pages: string[], info: CaseFileInfo, outline?: OutlineEntry[], layout?: LayoutSegment[][]) {
  info.system = "eproc";
  // processo grande: o eproc divide o PDF em partes, e a folha de rosto de cada uma diz qual é
  const part = Number(pages[0]?.match(/\bCapa\s*:\s*Parte\s+(\d{1,3})\b/i)?.[1]);
  if (part) info.part = part;
  const keyOf = (text: string): { key: string; event?: number; code?: string; verifier?: string } | null => {
    const full = text.match(EPROC_PAGE_STAMP);
    if (full) return { key: `${Number(full[1])}:${squash(full[2])}`, event: Number(full[1]), code: squash(full[2]) };
    const st = text.match(EPROC_STAMP);
    if (st && eprocDoc(st[2])) return { key: `${Number(st[1])}:${st[2]}`, event: Number(st[1]), code: st[2] };
    const ver = text.match(EPROC_VERIFIER) || text.match(EPROC_FOOTER);
    if (ver) return { key: `cv:${ver[1].replace(/v\d+$/i, "")}`, verifier: ver[1] };
    return null;
  };
  const separators = pages.map((p) => EPROC_SEPARATOR.test(p));
  const keyed = pages.map((p, i) => (separators[i] ? null : keyOf(p)));
  // sem o carimbo do evento nas páginas, os marcadores do PDF separam os documentos melhor que o código verificador
  const marks = docMarks(outline || [], pages.length);
  const byOutline = marks.length > 0 && !keyed.some((k) => k?.event !== undefined);
  let firstDoc = byOutline ? marks[0].page - 1 : keyed.findIndex(Boolean);
  const firstSeparator = separators.indexOf(true);
  if (firstSeparator >= 0 && (firstDoc < 0 || firstSeparator < firstDoc)) firstDoc = firstSeparator;
  const coverEnd = firstDoc < 0 ? Math.min(pages.length, 1) : firstDoc;
  const coverPages = pages.slice(0, Math.max(coverEnd, 1));
  const cover = coverPages.join("\n").split("\n");
  parseCover(cover, info);
  const coverLayout = layout?.slice(0, coverPages.length) || [];
  info.parties = coverLayout.some((p) => p?.length) ? eprocPartiesFromLayout(coverLayout) : [];
  if (!info.parties.length) info.parties = eprocParties(cover);

  // eventos: a tabela da capa (quando há) e as páginas de separação
  const events = eprocEvents(cover);
  pages.forEach((p, i) => {
    const ev = separators[i] ? eprocSeparator(p) : null;
    if (ev && !events.has(`${ev.n}:`)) events.set(`${ev.n}:`, ev);
  });
  const list = [...events.entries()].filter(([k]) => k.endsWith(":")).map(([, e]) => e);
  if (list.length) info.events = list.sort((a, b) => a.n - b.n).map((e) => ({ n: e.n, date: e.date, text: eventText(e.description) }));

  // nomes dos documentos nos marcadores: "Evento 1 - Doc. 2 - PROCURAÇÃO"
  const labels = new Map<string, string>();
  for (const o of outline || []) {
    const m = o.title.match(EPROC_DOC_MARK);
    if (m) labels.set(`${Number(m[1])}:${Number(m[2])}`, m[3]);
  }

  if (byOutline) splitByOutline(pages, marks, info, { events, separators, coverEnd });
  else if (firstDoc >= 0) {
    let current: FileDoc | null = null;
    let currentKey = "";
    keyed.forEach((k, i) => {
      const page = i + 1;
      if (page <= coverEnd) return;
      // a página de separação não faz parte de nenhum documento
      if (separators[i]) {
        current = null;
        currentKey = "";
        return;
      }
      if (!k || k.key === currentKey) {
        if (current) current.pages[1] = page;
        return;
      }
      currentKey = k.key;
      const docNumber = Number(k.code?.match(/(\d{1,3})$/)?.[1]);
      const label = k.event !== undefined && docNumber ? labels.get(`${k.event}:${docNumber}`) : undefined;
      current = {
        courtId: k.code ? `Evento ${k.event}, ${k.code}` : k.verifier,
        ...eprocFileDoc({ event: k.event, code: k.code, label }, pages[i], events),
        pages: [page, page],
      };
      info.docs.push(current);
    });
    if (coverEnd > 0) info.docs.unshift({ title: "Capa do processo", type: "outro", pages: [1, coverEnd] });
  }
  eprocSignatures(pages, info.docs);
}

const EVENT_TITLE = /\bevento\s*:?\s*(\d{1,4})/i;

/** Código de documento do eproc no título do marcador ("INIC1", "Evento 1 - CONTES1"). */
function codeIn(title: string): string | undefined {
  for (const m of title.matchAll(/\b([A-Z]{2,14}\d{1,3})\b/g)) if (eprocDoc(m[1])) return m[1];
  return undefined;
}

/**
 * Marcadores que começam um documento. No eproc, os de cada documento ("Evento 1 - Doc. 2 - PROCURAÇÃO"), os que têm o
 * código (INIC1, PROC2...) ou, sem eles, os de baixo de cada evento. Nos outros sistemas, o primeiro nível com mais de
 * um marcador: os de baixo costumam ser seções do mesmo documento.
 */
function docMarks(outline: OutlineEntry[], pageCount: number): OutlineEntry[] {
  const valid = outline.filter((o) => o.page >= 1 && o.page <= pageCount);
  let marks = valid.filter((o) => EPROC_DOC_MARK.test(o.title));
  if (!marks.length) marks = valid.filter((o) => codeIn(o.title));
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
function splitByOutline(
  pages: string[],
  marks: OutlineEntry[],
  info: CaseFileInfo,
  opts: { events?: Map<string, EprocEvent>; separators?: boolean[]; coverEnd?: number } = {},
) {
  if (!marks.length) return;
  const events = opts.events || new Map<string, EprocEvent>();
  const coverEnd = opts.coverEnd ?? marks[0].page - 1;
  if (coverEnd > 0) info.docs.push({ title: "Capa do processo", type: "outro", pages: [1, coverEnd] });
  marks.forEach((o, i) => {
    let end = i + 1 < marks.length ? marks[i + 1].page - 1 : pages.length;
    // as páginas de separação antes do próximo evento não fazem parte do documento
    while (end > o.page && opts.separators?.[end - 1]) end--;
    const text = pages[o.page - 1] || "";
    const range: [number, number] = [o.page, Math.max(o.page, end)];
    const dm = o.title.match(EPROC_DOC_MARK);
    if (dm) {
      const event = Number(dm[1]);
      info.docs.push({ courtId: `Evento ${event}, Doc. ${Number(dm[2])}`, ...eprocFileDoc({ event, label: dm[3] }, text, events), pages: range });
      return;
    }
    const code = codeIn(o.title);
    const known = code ? eprocDoc(code) : null;
    const eventIn = o.parent && EVENT_TITLE.test(o.parent) ? o.parent : undefined;
    const event = Number((o.title.match(EVENT_TITLE) || eventIn?.match(EVENT_TITLE))?.[1]) || undefined;
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
      pages: range,
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

/**
 * Lê o texto das páginas do processo integral. Os marcadores do PDF ajudam a separar e a dar nome aos documentos, e a
 * posição dos textos da capa (layout) diz o polo de cada parte quando a tabela tem uma coluna por polo.
 */
export function parseCaseFile(pages: string[], opts: { outline?: OutlineEntry[]; layout?: LayoutSegment[][] } = {}): CaseFileInfo {
  const info: CaseFileInfo = { parties: [], docs: [] };
  const sample = pages.slice(0, 12).join("\n");
  const count = (re: RegExp) => pages.filter((p) => re.test(p)).length;
  const pje = count(PJE_STAMP);
  const eproc = count(EPROC_PAGE_STAMP) || count(EPROC_STAMP);
  const eprocHints =
    /partes e representantes|informa[çc][õo]es adicionais|eproc|c[óo]digo verificador|p[áa]gina de separa[çc][ãa]o/i.test(sample) ||
    !!opts.outline?.some((o) => codeIn(o.title) || EPROC_DOC_MARK.test(o.title)) ||
    (opts.outline || []).filter((o) => /^\s*evento\s*:?\s*\d/i.test(o.title)).length >= 2;
  // o sistema com mais páginas carimbadas ganha: o PDF de um pode citar códigos que parecem do outro
  if (pje > 0 && pje >= eproc) parsePje(pages, info);
  else if (eproc > 0) parseEproc(pages, info, opts.outline, opts.layout);
  else if (count(ESAJ_CODE) >= Math.min(2, pages.length)) parseEsaj(pages, info);
  else if (eprocHints) parseEproc(pages, info, opts.outline, opts.layout);
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
