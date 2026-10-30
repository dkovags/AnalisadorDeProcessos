import { poleOfRole } from "./casefile";
import { checkCaseNumber, digitsOf, parseCnj, courtOfCnj } from "./cnj";
import {
  abntBody, abntJurisdiction, CLASS_COURT, CLASSES, courtFromName, COURT_SIGLA_RE, isSuperior, normalizeClass, normalizeCourt,
  rapporteurLong, rapporteurTitle,
} from "./courts";
import { formatDate, formatDateAbnt, formatDateLong, parts } from "./dates";
import { extractRefs, readBody, readDates, readRapporteur } from "./refs";
import type { Binding, CitationStyle, Case, Precedent, PrecedentParty } from "./types";
import { fold, nameKey, sameParty, squash, titleCase } from "./text";

// Jurisprudência: leitura de acórdãos e ementas colados (dados e partes) e referência no formato adequado.

const ROLE_LABELS: [RegExp, string][] = [
  [/^rect[e]?\.?(\(s\))?$|^recorrentes?$/, "Recorrente"],
  [/^recd[oa]\.?(\(a\/s\))?(\(s\))?$|^recorrid[oa]s?$/, "Recorrido"],
  [/^agte\.?(\(s\))?$|^agravantes?$/, "Agravante"],
  [/^agd[oa]\.?(\(a\/s\))?(\(s\))?$|^agravad[oa]s?$/, "Agravado"],
  [/^embte\.?(\(s\))?$|^embargantes?$/, "Embargante"],
  [/^embd[oa]\.?(\(a\/s\))?(\(s\))?$|^embargad[oa]s?$/, "Embargado"],
  [/^impte\.?(\(s\))?$|^impetrantes?$/, "Impetrante"],
  [/^impd[oa]\.?(\(a\/s\))?(\(s\))?$|^impetrad[oa]s?$/, "Impetrado"],
  [/^pacte\.?(\(s\))?$|^pacientes?$/, "Paciente"],
  [/^reqte\.?(\(s\))?$|^requerentes?$/, "Requerente"],
  [/^reqd[oa]\.?(\(a\/s\))?(\(s\))?$|^requerid[oa]s?$/, "Requerido"],
  [/^reclte\.?(\(s\))?$|^reclamantes?$/, "Reclamante"],
  [/^recld[oa]\.?(\(a\/s\))?(\(s\))?$|^reclamad[oa]s?$/, "Reclamado"],
  [/^apelantes?$|^apte\.?$/, "Apelante"],
  [/^apelad[oa]s?$|^apd[oa]\.?$/, "Apelado"],
  [/^suscitantes?$/, "Suscitante"],
  [/^suscitad[oa]s?$/, "Suscitado"],
  [/^interes\.?$|^interessad[oa]s?$|^intd[oa]\.?(\(a\/s\))?$/, "Interessado"],
  [/^am\.? ?curiae\.?$|^amicus curiae$/, "Amicus curiae"],
  [/^autor[a]?(es)?$/, "Autor"],
  [/^reu$|^re$|^reus$/, "Réu"],
  [/^exequentes?$/, "Exequente"],
  [/^executad[oa]s?$/, "Executado"],
  [/^assistentes?$/, "Assistente"],
];
const LAWYER_LABEL = /^(advogad[oa]s?|advs?\.?(\(a\/s\))?|proc\.?(\(a\/s\))?(\(es\))?|procurador[a]?(es)?|defensor[a]?( public[oa])?|advogad[oa]\(s\))$/;

function roleOf(label: string): string | null {
  const f = fold(label).replace(/\s+/g, " ").trim();
  for (const [re, role] of ROLE_LABELS) if (re.test(f)) {
    // mantém o feminino escrito ("RECORRIDA")
    if (/a$|as$/.test(f) && /o$/.test(role)) return role.replace(/o$/, "a");
    return role;
  }
  return null;
}

/** "FULANO DE TAL - RJ123456" → "Fulano de Tal - RJ123456" */
function lawyerName(s: string): string {
  const [name, ...rest] = squash(s).split(" - ");
  return [/[a-zà-ú]/.test(name) ? name : titleCase(name), ...rest].join(" - ");
}

/** Partes do cabeçalho do acórdão ("RECORRENTE : BANCO ALFA S/A", "AGDO.(A/S) : MARIA"). */
export function readParties(text: string): PrecedentParty[] {
  const out: PrecedentParty[] = [];
  let lastWasLawyer = false;
  for (const raw of text.split("\n").slice(0, 120)) {
    // várias partes na mesma linha: "Apelante: Banco Alfa; Apelado: Maria"
    for (const piece of raw.split(/;\s*(?=[A-ZÀ-Úa-zà-ú. ()/]{3,30}\s*:)/)) {
      const m = piece.match(/^\s*([A-ZÀ-Úa-zà-ú.()/ ]{3,30}?)\s*:\s*(.+?)\s*$/);
      if (!m) {
        // continuação da lista de advogados (linha sem rótulo)
        if (lastWasLawyer && out.length && /^\s{2,}\S/.test(raw) && raw.trim().length < 100) out[out.length - 1].lawyers = `${out[out.length - 1].lawyers}\n${lawyerName(raw)}`;
        else lastWasLawyer = false;
        continue;
      }
      const label = fold(m[1]).trim();
      if (LAWYER_LABEL.test(label)) {
        if (out.length) out[out.length - 1].lawyers = [out[out.length - 1].lawyers, lawyerName(m[2])].filter(Boolean).join("\n");
        lastWasLawyer = true;
        continue;
      }
      lastWasLawyer = false;
      const role = roleOf(m[1]);
      if (!role) continue;
      const name = squash(m[2]).replace(/\s*-\s*(OAB|[A-Z]{2}\d+).*$/, "");
      if (name.length < 2) continue;
      const pretty = /[a-zà-ú]/.test(name) ? name : titleCase(name);
      if (!out.some((p) => p.role === role && fold(p.name) === fold(pretty))) out.push({ name: pretty, role, pole: poleOfRole(role) });
    }
  }
  return out;
}

/** Ementa: depois de "EMENTA" até "ACÓRDÃO", "RELATÓRIO" ou "Vistos". */
export function readSummary(text: string): string | undefined {
  const f = fold(text);
  const start = f.search(/(^|\n)\s*e\s?m\s?e\s?n\s?t\s?a\s*[:.\-–]?\s*/);
  if (start < 0) {
    const head = text.trim().slice(0, 80);
    // ementa colada sozinha: começa com palavras em maiúsculas e ponto ("PROCESSUAL CIVIL. AGRAVO...")
    if (/^[A-ZÀ-Ú ,]{6,}\./.test(head)) return squash(text.trim().split(/\n\s*\n\s*(?=\(|[A-Z]{2,}\s*[,-])/)[0]);
    return undefined;
  }
  const m = f.slice(start).match(/^(\n)?\s*e\s?m\s?e\s?n\s?t\s?a\s*[:.\-–]?\s*/);
  const from = start + (m ? m[0].length : 0);
  const rest = f.slice(from);
  const end = rest.search(/\n\s*(a\s?c\s?o\s?r\s?d\s?a\s?o|r\s?e\s?l\s?a\s?t\s?o\s?r\s?i\s?o|vistos,? (relatados|e relatados)|decisao\s*:|acordam\b|certidao de julgamento)/);
  const out = squash(text.slice(from, end < 0 ? from + 8000 : from + end));
  return out.length > 20 ? out : undefined;
}

export interface ParsedPrecedent extends Partial<Omit<Precedent, "parties">> {
  parties: PrecedentParty[];
}

/** Lê os dados de um acórdão, ementa ou resultado de pesquisa colados pela pessoa. */
export function parsePrecedentText(text: string): ParsedPrecedent {
  const out: ParsedPrecedent = { parties: readParties(text) };
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.slice(0, 40).join("\n");

  // tribunal pelo nome por extenso no cabeçalho
  for (const l of lines.slice(0, 15)) {
    const c = courtFromName(l);
    if (c) {
      out.court = c;
      break;
    }
  }

  // linha da classe e do número ("RECURSO ESPECIAL Nº 1.234.567 - SP (2019/0123456-7)")
  for (const l of lines.slice(0, 30)) {
    const m = l.match(/^(.{2,140}?)\s+(?:[nN][º°oO.]*\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d{3,9}|\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})(?:\s*[-–/]\s*([A-Z]{2})\b)?/);
    if (!m) continue;
    const cls = normalizeClass(m[1].replace(/[:]\s*$/, ""));
    if (!cls) continue;
    out.className = cls.className;
    out.number = m[2];
    if (m[3]) out.uf = m[3];
    break;
  }

  // citação no próprio texto (resultado de pesquisa do STJ, STF ou Jusbrasil)
  const ref = extractRefs(text).find((r) => r.kind === "acordao");
  if (ref) {
    out.className ||= ref.className;
    out.number ||= ref.number;
    out.uf ||= ref.uf;
    out.court ||= ref.court;
    out.rapporteur ||= ref.rapporteur;
    out.female ??= ref.female;
    out.body ||= ref.body;
    out.judgedAt ||= ref.judgedAt;
    out.publishedAt ||= ref.publishedAt;
    out.source ||= ref.source;
  }

  const rap = readRapporteur(head);
  if (rap) {
    out.rapporteur = rap.rapporteur;
    out.female = rap.female ?? out.female;
  }
  if (!out.body) {
    const acordam = fold(text).match(/acordam (os|as) (senhores |senhoras )?(ministros|ministras|desembargador\w*|juizes|juizas|membros)( d[ao])? ([^,]{3,60}?)(,| do | da )/);
    out.body = (acordam && readBody(text.slice(acordam.index!, acordam.index! + acordam[0].length + 10))) || readBody(head);
  }
  const dates = readDates(text);
  out.judgedAt ||= dates.judgedAt;
  out.publishedAt ||= dates.publishedAt;
  out.source ||= dates.source;

  if (!out.court) {
    const sig = head.match(COURT_SIGLA_RE);
    if (sig) out.court = normalizeCourt(sig[1]);
  }
  if (!out.court && out.number && parseCnj(out.number)) out.court = courtOfCnj(parseCnj(out.number)!);
  if (!out.court && out.className) {
    const base = normalizeClass(out.className)?.base;
    if (base && CLASS_COURT[base]) out.court = CLASS_COURT[base];
  }

  // no STF, o agravo regimental e os embargos vêm depois do número ("ARE 1.234.567 AgR")
  if (out.court === "STF" && out.className) {
    const stf = out.className.match(/^(AgRg|AgInt|EDcl)\s+n[oa]s?\s+(.+)$/);
    if (stf) out.className = `${stf[2]} ${stf[1] === "EDcl" ? "ED" : "AgR"}`;
  }

  out.summary = readSummary(text);
  const thesis = text.match(/tese (jur[íi]dica|firmada|fixada)?\s*:\s*([^\n]{20,})/i);
  if (thesis) out.thesis = squash(thesis[2]);

  const f = fold(text);
  const tema = f.match(/\btema\s+(?:repetitivo\s+)?(?:n[º°o.]*\s*)?(\d{1,4}(?:\.\d{3})?)/);
  let binding: Binding = "";
  if (/sumula vinculante/.test(f.slice(0, 200))) binding = "sumula_vinculante";
  else if (/^\s*sumula\b/.test(f)) binding = "sumula";
  else if (/repercussao geral/.test(f) && tema) binding = "repercussao";
  else if (/repetitiv|art\.? ?1\.?036|art\.? ?543-c/.test(f) && tema) binding = "repetitivo";
  else if (/\b(adi|adc|ado|adpf)\b/.test(fold(out.className || ""))) binding = "controle";
  else if (/\birdr\b|incidente de resolucao de demandas repetitivas/.test(f.slice(0, 600))) binding = "irdr";
  out.binding = binding;
  if (tema && (binding === "repetitivo" || binding === "repercussao")) out.bindingNumber = tema[1];

  // súmula colada: "Súmula 297 do STJ: O Código de Defesa do Consumidor é aplicável..."
  const sum = text.trim().match(/^s[úu]mula\s+(vinculante\s+)?(?:n[º°.]*\s*)?(\d{1,4})\s*(?:\/|do|da)?\s*(STF|STJ|TST)?\s*[:.\-–]?\s*([^]*)$/i);
  if (sum) {
    out.className = sum[1] ? "Súmula Vinculante" : "Súmula";
    out.number = sum[2];
    out.court = sum[3]?.toUpperCase() || (sum[1] ? "STF" : out.court);
    out.binding = sum[1] ? "sumula_vinculante" : "sumula";
    if (sum[4].trim()) out.summary = squash(sum[4]);
  }
  return out;
}

/** Chave para achar a mesma decisão escrita de jeitos diferentes. */
export function precedentKey(p: Pick<Precedent, "court" | "number" | "className">): string {
  const sum = /sumula/.test(fold(p.className || ""));
  const tema = /^tema$/.test(fold(p.className || "").trim());
  return `${(p.court || "").toUpperCase()}|${sum ? (/vinculante/.test(fold(p.className)) ? "SV" : "S") : tema ? "T" : "A"}|${digitsOf(p.number || "")}`;
}

function numberWithUf(p: Pick<Precedent, "number" | "uf">): string {
  return `${p.number}${p.uf ? `/${p.uf}` : ""}`;
}

function shortDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${d}/${m}/${y}`;
}

const isSumula = (p: Precedent) => /sumula/.test(fold(p.className));
const isTema = (p: Precedent) => fold(p.className).trim() === "tema";

/** Referência da decisão no estilo escolhido. */
export function formatCitation(p: Precedent, style: CitationStyle = "forense"): string {
  const court = p.court.toUpperCase();
  if (isSumula(p)) {
    const sv = /vinculante/.test(fold(p.className));
    if (style === "abnt") {
      const j = abntJurisdiction(court);
      return `${j.jurisdiction}. ${j.body}. Súmula${sv ? " Vinculante" : ""} n. ${p.number}${p.summary ? `. ${p.summary.replace(/\.$/, "")}` : ""}.${p.publishedAt ? ` ${sourceName(p.source)}: ${j.place}, ${formatDateAbnt(p.publishedAt)}.` : ""}`;
    }
    if (style === "stj") return `Súmula${sv ? " Vinculante" : ""} n. ${p.number}/${court}`;
    return `Súmula${sv ? " Vinculante" : ""} ${p.number} do ${court}`;
  }
  if (isTema(p)) {
    const kind = p.binding === "repercussao" ? "repercussão geral" : p.binding === "repetitivo" ? "recursos repetitivos" : "";
    return `${court}, Tema ${p.number}${kind ? ` (${kind})` : ""}`;
  }
  const title = rapporteurTitle(court, p.female);
  if (style === "stj") {
    const items = [`${p.className} n. ${numberWithUf(p)}`];
    if (p.rapporteur) items.push(`${rapporteurLong(court, p.female)} ${p.rapporteur}`);
    if (p.rapporteurForJudgment) items.push(`relator para acórdão ${p.rapporteurForJudgment}`);
    if (p.body) items.push(p.body);
    if (p.judgedAt) items.push(`julgado em ${shortDate(p.judgedAt)}`);
    if (p.publishedAt) items.push(`${p.source || "DJe"} de ${shortDate(p.publishedAt)}`);
    return `${isSuperior(court) ? "" : `${court}, `}${items.join(", ")}.`;
  }
  if (style === "abnt") {
    const j = abntJurisdiction(court);
    const full = classFullName(p.className);
    const parties = groupParties(p.parties);
    let s = `${j.jurisdiction}. ${j.body}${p.body ? ` (${abntBody(p.body)})` : ""}. ${full} ${numberWithUf(p)}.`;
    if (parties) s += ` ${parties}`;
    if (p.rapporteur) s += ` ${p.female ? "Relatora" : "Relator"}: ${title ? title + " " : ""}${p.rapporteur}${p.judgedAt ? `, ${formatDateLong(p.judgedAt)}` : ""}.`;
    else if (p.judgedAt) s += ` Julgado em ${formatDateLong(p.judgedAt)}.`;
    if (p.publishedAt) s += ` ${sourceName(p.source)}: ${j.place}, ${formatDateAbnt(p.publishedAt)}.`;
    if (p.url) s += ` Disponível em: ${p.url}.`;
    return s;
  }
  const items = [`${court}`, `${p.className} ${numberWithUf(p)}`];
  if (p.rapporteur) items.push(`Rel. ${title ? title + " " : ""}${p.rapporteur}`);
  if (p.rapporteurForJudgment) items.push(`Rel. p/ acórdão ${title ? title + " " : ""}${p.rapporteurForJudgment}`);
  if (p.body) items.push(p.body);
  if (p.judgedAt) items.push(`j. ${formatDate(p.judgedAt)}`);
  if (p.publishedAt) items.push(`${p.source || "DJe"} ${formatDate(p.publishedAt)}`);
  return items.join(", ") + ".";
}

function sourceName(source?: string): string {
  return { DJ: "Diário da Justiça", DJEN: "Diário de Justiça Eletrônico Nacional", DOU: "Diário Oficial da União" }[source || ""] || "Diário da Justiça Eletrônico";
}

function classFullName(cls: string): string {
  // "AgInt no AREsp" → "Agravo Interno no Agravo em Recurso Especial"
  return cls
    .split(" ")
    .map((w) => CLASSES[w] || w)
    .join(" ");
}

/** "Recorrente: Banco Alfa S.A. Recorrido: Maria." (ABNT) */
function groupParties(list: PrecedentParty[]): string {
  const by = new Map<string, string[]>();
  for (const p of list) if (p.pole !== "terceiro") by.set(p.role, [...(by.get(p.role) || []), p.name]);
  return [...by.entries()].map(([role, names]) => `${role}: ${names.join("; ")}`.replace(/\.?$/, ".")).join(" ");
}

/** Para colar na petição: referência e, na linha de baixo, a ementa como citação direta. */
export function citationBlock(p: Precedent, style: CitationStyle, withSummary: boolean): { text: string; html: string } {
  const ref = formatCitation(p, style);
  const summary = withSummary ? p.summary?.trim() : undefined;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!summary) return { text: ref, html: `<p>${esc(ref)}</p>` };
  return {
    text: `${ref}\n\n"${summary}"`,
    html: `<p>${esc(ref)}</p><blockquote style="margin:0 0 0 4cm;font-size:10pt;line-height:1.15;text-align:justify">${esc(summary)}</blockquote>`,
  };
}

/** Processos com alguma parte em comum com a decisão. */
export function sharedParties(p: Precedent, cases: Case[]): { caseId: string; party: string; precedentParty: string }[] {
  const out: { caseId: string; party: string; precedentParty: string }[] = [];
  for (const c of cases)
    for (const party of c.parties)
      for (const pp of p.parties)
        if (sameParty(party.name, pp.name) && !out.some((o) => o.caseId === c.id && nameKey(o.party) === nameKey(party.name)))
          out.push({ caseId: c.id, party: party.name, precedentParty: `${pp.name} (${pp.role})` });
  return out;
}

/** Confere o número quando segue o padrão CNJ (decisões de segundo grau). */
export function precedentNumberCheck(p: Pick<Precedent, "number" | "court">): string | null {
  const c = checkCaseNumber(p.number);
  if (!c) return null;
  if (!c.valid) return c.message || "Número inválido.";
  if (p.court && c.court && normalizeCourt(p.court) !== c.court) return `O número é do ${c.court}, não do ${p.court}.`;
  return null;
}
