import { digitsOf, CNJ_RE, formatCnj, parseCnj } from "./cnj";
import { RITES } from "./deadlines";
import type { CaseStatus, Channel, Counting, DocType, Hearing, NoticeKind, Pole, Rite, TaskKind } from "./types";
import { findDates, fold, NUMBER_WORDS_RE, numberFromWords, squash, titleCase } from "./text";

// Leitura de expedientes, decisões e despachos: qual ato a parte precisa praticar, em que prazo,
// com quais documentos instruir a petição, a quem a ordem se dirige e se há audiência marcada.
// Tudo por regras sobre o texto (sem inteligência artificial): o resultado é uma sugestão para conferir.

type ByRite<T> = T | Partial<Record<Rite, T>>;

interface Rule {
  id: string;
  act: ByRite<string>;
  kind: TaskKind;
  re: RegExp;
  days?: ByRite<number>;
  basis?: ByRite<string>;
  docs?: ByRite<string[]>;
  /** Exige petição (falso para audiências, ciência e acompanhamento). */
  petition?: boolean;
  priority: number;
  note?: ByRite<string>;
  /** Alternativa usual (ex.: embargos de declaração contra a sentença). */
  alt?: string;
}

const pick = <T>(v: ByRite<T> | undefined, rite: Rite): T | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Partial<Record<Rite, T>>;
    return rite in o ? o[rite] : o.civel;
  }
  return v as T;
};

const DOCS_DEFESA = [
  "Procuração",
  "Documento de identificação ou atos constitutivos (pessoa jurídica)",
  "Documentos que comprovem as alegações da defesa (CPC, art. 434)",
];

const RULES: Rule[] = [
  {
    id: "contestacao",
    act: { civel: "Contestação", juizado: "Contestação", trabalho: "Contestação (defesa)", penal: "Resposta à acusação" },
    kind: "peticao",
    re: /\b(cite-se|citem-se|fica\w* (devidamente )?citad\w*|carta de citacao|mandado de citacao|para,? (querendo,? )?(contestar|apresentar (contestacao|defesa|resposta))|prazo (legal )?para (contestar|contestacao|defesa|resposta)|oferecer contestacao|apresentar contestacao|resposta a acusacao)\b/,
    days: { civel: 15, penal: 10 },
    basis: {
      civel: "CPC, art. 335",
      juizado: "Lei 9.099/1995, art. 30 (até a audiência de instrução)",
      trabalho: "CLT, art. 847 (até a audiência)",
      penal: "CPP, art. 396",
    },
    docs: { civel: [...DOCS_DEFESA, "Carta de preposição, se pessoa jurídica"], penal: ["Procuração", "Rol de testemunhas (CPP, art. 396-A)", "Documentos da defesa"] },
    priority: 89,
    note: {
      civel: "Se houver audiência de conciliação, o prazo conta dela (CPC, art. 335, I). Para dispensá-la, o réu deve pedir com 10 dias de antecedência (CPC, art. 334, § 5º).",
    },
  },
  {
    id: "audiencia",
    act: "Audiência",
    kind: "audiencia",
    re: /\baudiencia\b[^.]{0,200}?(designad|redesignad|marcad|agendad|realizar-se|sera realizada|para o dia|no dia|\d{1,2}\/\d{1,2}\/\d{2,4})|(design|redesign|marc)\w*\s+(a\s+)?audiencia/,
    petition: false,
    docs: [
      "Avisar o cliente e confirmar a presença",
      "Testemunhas: intimar ou levar (CPC, art. 455)",
      "Carta de preposição, se pessoa jurídica",
      "Documentos pessoais e proposta de acordo",
    ],
    priority: 88,
  },
  {
    id: "sessao",
    act: "Sessão de julgamento",
    kind: "audiencia",
    re: /sessao (virtual |presencial |telepresencial |ordinaria |extraordinaria )?de julgamento|inclui\w* (o feito |o processo |os autos )?(em|na) pauta|pauta de julgamento/,
    petition: false,
    docs: ["Memoriais", "Inscrição para sustentação oral (conforme o regimento interno)"],
    priority: 87,
  },
  {
    id: "emenda",
    act: "Emenda à inicial",
    kind: "peticao",
    re: /emend\w*\s+(a\s+)?(petica\w+\s+)?inicial|emenda (a|da) (petica\w+ )?inicial|sob pena de indeferimento/,
    days: 15,
    basis: "CPC, art. 321",
    docs: ["Documentos indicados pelo juízo"],
    priority: 85,
  },
  {
    id: "pagamento_cumprimento",
    act: "Pagamento voluntário do débito",
    kind: "pagamento",
    re: /(cumprimento de sentenca|art\.? ?523)[^]{0,240}?(pag\w*|deposit\w*|quit\w*)|(pag\w*|deposit\w*|efetu\w* o pagamento)[^.]{0,120}(art\.? ?523|multa de (dez|10) por cento)/,
    days: 15,
    basis: "CPC, art. 523",
    docs: ["Guia de depósito judicial", "Planilha de cálculo"],
    priority: 84,
    note: "Depois do prazo de pagamento, correm mais 15 dias úteis para a impugnação, independentemente de penhora (CPC, art. 525).",
  },
  {
    id: "pagamento_execucao",
    act: "Pagamento na execução",
    kind: "pagamento",
    re: /(pag\w*|quit\w*)[^.]{0,80}(no prazo de |em |dentro de )(3|tres) \(?(tres)?\)? ?dias|art\.? ?829/,
    days: 3,
    basis: "CPC, art. 829",
    docs: ["Guia de depósito judicial"],
    priority: 83,
    note: "Os embargos à execução podem ser opostos em 15 dias úteis da juntada do mandado de citação (CPC, art. 915).",
  },
  {
    id: "laudo",
    act: "Manifestação sobre o laudo pericial",
    kind: "peticao",
    re: /(manifest\w*|impugn\w*|falar|dizer|(?<!em )vista)\b[^.]{0,60}\blaudo|\blaudo( pericial)?\b[^.]{0,100}(manifest|vista as partes|ciencia as partes)/,
    days: 15,
    basis: "CPC, art. 477, § 1º",
    docs: ["Parecer do assistente técnico"],
    priority: 82,
  },
  {
    id: "manifestar_impugnacao",
    act: "Manifestação sobre a impugnação",
    kind: "peticao",
    re: /(manifest\w*|falar|dizer|(?<!em )vista)\b[^.]{0,50}\bimpugnacao\b(?! a contestacao)/,
    days: 15,
    priority: 81,
  },
  {
    id: "contrarrazoes_ed",
    act: "Contrarrazões aos embargos de declaração",
    kind: "recurso",
    re: /contrarraz\w*[^.]{0,80}embargos de declaracao|embargos de declaracao[^.]{0,160}(contrarraz|manifest|efeitos infringentes)/,
    days: 5,
    basis: { civel: "CPC, art. 1.023, § 2º", juizado: "CPC, art. 1.023, § 2º", trabalho: "CLT, art. 897-A, § 2º", penal: "CPP, art. 619" },
    priority: 90,
  },
  {
    id: "contrarrazoes",
    act: "Contrarrazões",
    kind: "recurso",
    re: /contrarraz(oes|oar|oa)|responder ao recurso|resposta ao recurso/,
    days: { civel: 15, juizado: 10, trabalho: 8, penal: 8 },
    basis: { civel: "CPC, art. 1.010, § 1º", juizado: "Lei 9.099/1995, art. 42, § 2º", trabalho: "CLT, art. 900", penal: "CPP, art. 600" },
    priority: 80,
  },
  {
    id: "impugnacao_cumprimento",
    act: "Impugnação ao cumprimento de sentença",
    kind: "peticao",
    re: /(apresent\w*|oferec\w*)[^.]{0,30}impugnacao ao cumprimento|impugnar o cumprimento/,
    days: 15,
    basis: "CPC, art. 525",
    docs: ["Planilha de cálculo (se alegar excesso, CPC, art. 525, § 4º)"],
    priority: 79,
  },
  {
    id: "reconvencao",
    act: "Contestação à reconvenção",
    kind: "peticao",
    re: /reconvencao[^.]{0,80}(contest|respost|manifest)|(contest|respond)\w*[^.]{0,30}reconvencao/,
    days: 15,
    basis: "CPC, art. 343, § 1º",
    priority: 78,
  },
  {
    id: "preparo",
    act: "Recolhimento do preparo",
    kind: "pagamento",
    re: /(recolh\w*|complement\w*|comprov\w*)[^.]{0,40}\bpreparo\b|\bpreparo\b[^.]{0,60}(em dobro|insuficiente|art\.? ?1\.?007)/,
    days: 5,
    basis: "CPC, art. 1.007, §§ 2º e 4º",
    docs: ["Guia de custas do recurso", "Comprovante de pagamento"],
    priority: 77,
  },
  {
    id: "embargos_execucao",
    act: "Embargos à execução",
    kind: "peticao",
    re: /(opor|oferecer|apresentar)\w*[^.]{0,20}embargos (a|do) execu/,
    days: 15,
    basis: "CPC, art. 915",
    priority: 76,
  },
  {
    id: "replica",
    act: "Réplica",
    kind: "peticao",
    re: /\breplica\b|(manifest\w*(-se)?|impugn\w*|falar|dizer)\s+(sobre|acerca d[ao]|a respeito d[ao]|quanto a|em)?\s*(a\s+)?(contestac|defesa apresentada|resposta do reu)|impugnacao a contestacao/,
    days: 15,
    basis: "CPC, arts. 350 e 351",
    docs: ["Documentos novos que respondam à defesa (CPC, art. 435)"],
    priority: 75,
  },
  {
    id: "rol_testemunhas",
    act: "Rol de testemunhas",
    kind: "peticao",
    re: /rol de testemunhas/,
    days: 15,
    basis: "CPC, art. 357, § 4º",
    docs: ["Qualificação das testemunhas (CPC, art. 450)"],
    priority: 74,
  },
  {
    id: "alegacoes_finais",
    act: "Alegações finais (memoriais)",
    kind: "peticao",
    re: /alegacoes finais|\bmemoriais\b/,
    days: { civel: 15, penal: 5 },
    basis: { civel: "CPC, art. 364, § 2º", penal: "CPP, art. 403, § 3º" },
    priority: 73,
  },
  {
    id: "honorarios_periciais",
    act: "Depósito dos honorários periciais",
    kind: "pagamento",
    re: /(deposit\w*|recolh\w*|antecip\w*|pag\w*)[^.]{0,50}honorarios (do |da )?perit|honorarios periciais/,
    docs: ["Guia de depósito judicial", "Comprovante do depósito"],
    priority: 72,
  },
  {
    id: "gratuidade",
    act: "Comprovação da hipossuficiência",
    kind: "peticao",
    re: /(comprov\w*|demonstr\w*)[^.]{0,80}(hipossuficiencia|insuficiencia de recursos|incapacidade financeira|miserabilidade)|(gratuidade|justica gratuita)[^.]{0,100}(comprov\w*|demonstr\w*)/,
    days: 15,
    basis: "CPC, art. 99, § 2º",
    docs: [
      "Declaração de hipossuficiência",
      "Comprovantes de renda (contracheques ou declaração do Imposto de Renda)",
      "Extratos bancários recentes",
      "Comprovantes de despesas",
    ],
    priority: 71,
  },
  {
    id: "quesitos",
    act: "Quesitos e assistente técnico",
    kind: "peticao",
    re: /\bquesitos\b|assistente tecnico/,
    days: 15,
    basis: "CPC, art. 465, § 1º",
    docs: ["Quesitos", "Indicação do assistente técnico"],
    priority: 70,
  },
  {
    id: "representacao",
    act: "Regularização da representação",
    kind: "peticao",
    re: /regulariz\w*\s+(a\s+)?(sua\s+)?representacao|junt\w*[^.]{0,40}(procuracao|instrumento de mandato|substabelecimento)|procuracao (atualizada|valida)/,
    days: 15,
    basis: "CPC, art. 76",
    docs: ["Procuração", "Atos constitutivos e documento de quem assina (pessoa jurídica)"],
    priority: 69,
  },
  {
    id: "provas",
    act: "Especificação de provas",
    kind: "peticao",
    re: /especifi\w*\s+(as\s+)?(provas|que provas)|provas que (ainda )?pretend\w+ produzir|indic\w+ (as )?provas/,
    docs: ["Rol de testemunhas, se pedir prova oral (CPC, art. 450)", "Quesitos, se pedir perícia"],
    priority: 68,
  },
  {
    id: "custas",
    act: "Recolhimento de custas",
    kind: "pagamento",
    re: /(recolh\w*|pag\w*|comprov\w*)[^.]{0,40}\b(custas|taxa judiciaria|despesas processuais|diligencia do oficial)\b|guia de custas|cancelamento da distribuicao/,
    days: 15,
    basis: "CPC, art. 290",
    docs: ["Guia de custas", "Comprovante de pagamento"],
    priority: 66,
  },
  {
    id: "manifestar_documentos",
    act: "Manifestação sobre documentos",
    kind: "peticao",
    re: /(manifest\w*|falar|dizer|(?<!em )vista)\b[^.]{0,50}documentos? (juntados|novos|apresentados|acostados|anexados)/,
    days: 15,
    basis: "CPC, art. 437, § 1º",
    priority: 65,
  },
  {
    id: "endereco",
    act: "Indicação de endereço",
    kind: "peticao",
    re: /(indic\w*|inform\w*|forne\w*|apresent\w*)\s+(o\s+)?(novo\s+|atual\s+|correto\s+)?endereco|(citacao|diligencia|mandado)[^.]{0,30}(frustrad|negativ|infrutifer)|nao (foi )?(localizad|encontrad)/,
    docs: ["Pesquisa de endereço (ou pedido de consulta aos sistemas conveniados)"],
    priority: 64,
  },
  {
    id: "calculos",
    act: "Apresentação de cálculos",
    kind: "peticao",
    re: /(apresent\w*|junt\w*|atualiz\w*)\s+(os\s+|a\s+|o\s+)?(calculos|planilha|memoria de calculo|demonstrativo (atualizado )?d[oe] (debito|credito))/,
    docs: ["Planilha de cálculo atualizada (CPC, art. 524)"],
    priority: 63,
  },
  {
    id: "dados_bancarios",
    act: "Informação de dados bancários",
    kind: "peticao",
    re: /dados bancarios|conta (bancaria )?para (transferencia|deposito)/,
    docs: ["Dados bancários do beneficiário"],
    priority: 62,
  },
  {
    id: "acordo",
    act: "Acompanhar o cumprimento do acordo",
    kind: "diligencia",
    re: /homolog\w*\s+(o\s+|por sentenca\s+o\s+)?acordo/,
    petition: false,
    priority: 61,
  },
  {
    id: "sentenca",
    act: { civel: "Apelação", juizado: "Recurso inominado", trabalho: "Recurso ordinário", penal: "Apelação" },
    kind: "recurso",
    re: /(?<!cumprimento de |conclusos para |concluso para |os autos para )\bsentenca\b|julgo (parcialmente |totalmente )?(procedente|improcedente)|julgo extint|extingo o processo|resolvo o merito/,
    days: { civel: 15, juizado: 10, trabalho: 8, penal: 5 },
    basis: { civel: "CPC, arts. 1.003, § 5º, e 1.009", juizado: "Lei 9.099/1995, art. 42", trabalho: "CLT, art. 895", penal: "CPP, art. 593" },
    docs: {
      civel: ["Comprovante do preparo (CPC, art. 1.007)"],
      juizado: ["Preparo em até 48 horas depois da interposição (Lei 9.099/1995, art. 42, § 1º)"],
      trabalho: ["Depósito recursal e custas (CLT, art. 899)"],
      penal: [],
    },
    priority: 60,
    note: "Avalie se cabe recurso. Contra omissão, contradição, obscuridade ou erro material: embargos de declaração em 5 dias (CPC, art. 1.023).",
    alt: "Embargos de declaração",
  },
  {
    id: "acordao",
    act: { civel: "Recurso especial ou extraordinário", juizado: "Recurso extraordinário", trabalho: "Recurso de revista", penal: "Recurso especial ou extraordinário" },
    kind: "recurso",
    re: /\bacordao\b|\bacordam\b|(negaram|deram|nega-se|da-se) provimento|recurso (nao )?provido/,
    days: { civel: 15, juizado: 15, trabalho: 8, penal: 15 },
    basis: { civel: "CPC, arts. 1.003, § 5º, e 1.029", juizado: "CPC, art. 1.003, § 5º (Súmula 203 do STJ: não cabe recurso especial)", trabalho: "CLT, art. 896", penal: "CPC, art. 1.003, § 5º" },
    docs: ["Comprovante do preparo", "Prequestionamento e, na divergência, a fonte do acórdão paradigma (CPC, art. 1.029, § 1º)", "Repercussão geral (no recurso extraordinário)"],
    priority: 59,
    note: "Avalie se cabe recurso. Embargos de declaração: 5 dias (CPC, art. 1.023).",
    alt: "Embargos de declaração",
  },
  {
    id: "juntada",
    act: "Juntada de documentos",
    kind: "peticao",
    re: /\b(junt\w*|apresent\w*|traz\w*|acost\w*|anex\w*|exib\w*)\b[^.]{0,40}\b(documento|comprovante|certidao|copia|extrato|contrato|declaracao|exame|guia|fotografia|nota fiscal|holerite|contracheque)/,
    docs: [],
    priority: 58,
  },
  {
    id: "decisao",
    act: { civel: "Agravo de instrumento", juizado: "Avaliar medida cabível contra a decisão", trabalho: "Decisão interlocutória (em regra irrecorrível de imediato)", penal: "Recurso em sentido estrito" },
    kind: "recurso",
    re: /\bdecisao\b|\bdefiro\b|\bindefiro\b|tutela (de urgencia|antecipada|provisoria|de evidencia)|\bliminar\b/,
    days: { civel: 15, penal: 5 },
    basis: { civel: "CPC, arts. 1.003, § 5º, e 1.015", trabalho: "CLT, art. 893, § 1º", penal: "CPP, arts. 581 e 586" },
    docs: { civel: ["Comprovante do preparo do agravo", "Cópias obrigatórias, se os autos forem físicos (CPC, art. 1.017, I)"] },
    priority: 40,
    note: {
      civel: "O agravo de instrumento cabe nas hipóteses do art. 1.015 do CPC (taxatividade mitigada: Tema 988 do STJ). Embargos de declaração: 5 dias (CPC, art. 1.023).",
      penal: "O recurso em sentido estrito cabe só nas hipóteses do art. 581 do CPP.",
    },
    alt: "Embargos de declaração",
  },
  {
    id: "manifestacao",
    act: "Manifestação",
    kind: "peticao",
    re: /\bmanifest(e|em|ar|ar-se|e-se|em-se|acao)\b|(?<!em )\bvista\b|\bdiga(m)?\b|\bfal(e|em|ar)\b|para (querendo, )?se pronunciar|\bpronunci(e|em|ar)/,
    priority: 20,
  },
  {
    id: "ciencia",
    act: "Ciência",
    kind: "outro",
    re: /\bciencia\b|para conhecimento|cientific\w*|cientes? as partes/,
    petition: false,
    priority: 10,
  },
];

const STATUS_RULES: { re: RegExp; status: CaseStatus }[] = [
  { re: /arquiv\w* provisori|arquivamento provisorio|art\.? ?921/, status: "arquivado_prov" },
  { re: /transit\w* em julgado|certific\w*[^.]{0,20}transito/, status: "transitado" },
  { re: /(arquivem-se|arquive-se|ao arquivo|arquivamento definitivo|baixa definitiva|baixem os autos)/, status: "arquivado" },
  { re: /(suspend\w*|suspens\w*)\s+(o\s+)?(processo|feito|curso)|sobrest\w*/, status: "suspenso" },
  { re: /(remet\w*|encaminh\w*|subam)[^.]{0,60}(tribunal|turma recursal|instancia superior|segundo grau)/, status: "recurso" },
  { re: /nomei\w*[^.]{0,20}perit|pericia (designada|deferida)|perito (nomeado|judicial)/, status: "pericia" },
  { re: /cumprimento de sentenca/, status: "execucao" },
];

export interface Suggestion {
  rule: string;
  act: string;
  kind: TaskKind;
  petition: boolean;
  days?: number;
  counting: Counting;
  /** O prazo veio do próprio texto. */
  explicit: boolean;
  basis?: string;
  docs: string[];
  note?: string;
  alt?: string;
  /** Trecho que motivou a sugestão. */
  excerpt: string;
}

export interface Analysis {
  caseNumber?: string;
  kind?: NoticeKind;
  channel?: Channel;
  /** Disponibilização ou expedição. */
  sentAt?: string;
  /** A quem se dirige a ordem. */
  target?: Pole | "ambos";
  /** Nomes de destinatários e advogados citados no expediente (DJEN). */
  recipients: string[];
  lawyers: string[];
  suggestions: Suggestion[];
  hearing?: Hearing;
  status?: { status: CaseStatus; excerpt: string };
  docType: DocType;
}

interface ExplicitTerm {
  days: number;
  counting?: Counting;
  index: number;
  hours?: boolean;
}

const TERM_RE = new RegExp(
  `\\b(?:prazo (?:comum |legal |improrrogavel |sucessivo |de ate )?de|no prazo de|em ate|dentro de|em)\\s+(${NUMBER_WORDS_RE})(?:\\s*\\((${NUMBER_WORDS_RE})\\))?\\s*(dias?|horas?)(?:\\s+(uteis|corridos))?`,
  "g",
);

/** Prazos escritos no texto ("no prazo de 15 (quinze) dias úteis"). */
export function explicitTerms(folded: string): ExplicitTerm[] {
  const out: ExplicitTerm[] = [];
  for (const m of folded.matchAll(TERM_RE)) {
    const n = numberFromWords(m[1]) ?? (m[2] ? numberFromWords(m[2]) : null);
    if (!n || n > 365) continue;
    const hours = m[3].startsWith("hora");
    out.push({ days: hours ? Math.max(1, Math.ceil(n / 24)) : n, counting: m[4] as Counting | undefined, index: m.index!, hours });
  }
  return out;
}

/** Trecho em volta de uma posição, para mostrar o motivo da sugestão. */
function around(text: string, index: number, len: number): string {
  let a = Math.max(0, index - 60);
  let b = Math.min(text.length, index + len + 140);
  const before = text.lastIndexOf(".", index);
  if (before >= a && before < index) a = before + 1;
  const after = text.indexOf(".", index + len);
  if (after !== -1 && after < b) b = after + 1;
  return squash(text.slice(a, b));
}

const HEARING_KINDS: [RegExp, string][] = [
  [/conciliacao|mediacao|autocomposicao/, "de conciliação"],
  [/instrucao e julgamento|instrucao/, "de instrução e julgamento"],
  [/\buna\b/, "una"],
  [/inicial/, "inicial"],
  [/custodia/, "de custódia"],
  [/justificacao/, "de justificação"],
  [/admonitoria/, "admonitória"],
];

function findHearing(text: string, f: string, sessao: boolean): Hearing | undefined {
  const anchor = sessao ? f.search(/sessao [^.]{0,30}julgamento|pauta/) : f.search(/\baudiencia\b/);
  if (anchor < 0) return undefined;
  const windowText = text.slice(anchor, anchor + 400);
  const dates = findDates(windowText);
  if (!dates.length) return undefined;
  const after = fold(windowText.slice(dates[0].index + dates[0].length, dates[0].index + dates[0].length + 60));
  const tm = after.match(/^[^\d]{0,15}(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?/);
  const head = f.slice(anchor, anchor + 120);
  const kind = sessao ? "Sessão de julgamento" : `Audiência ${HEARING_KINDS.find(([re]) => re.test(head))?.[1] || ""}`.trim();
  const wf = fold(windowText);
  const link = windowText.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,;]+$/, "");
  const place = link || (/(videoconferencia|telepresencial|virtual|por video)/.test(wf) ? "Por videoconferência" : undefined);
  const time = tm && Number(tm[1]) < 24 ? `${tm[1].padStart(2, "0")}:${(tm[2] || "00").padStart(2, "0")}` : undefined;
  return { date: dates[0].iso, time, kind, place };
}

const ACTIVE_WORDS = "autor(?:a|es|as)?|requerentes?|reclamantes?|exequentes?|impetrantes?|apelantes?|agravantes?|embargantes?|recorrentes?|demandantes?|ativa|promoventes?|querelantes?";
const PASSIVE_WORDS = "re|reu|reus|res|requerid[oa]s?|reclamad[oa]s?|executad[oa]s?|impetrad[oa]s?|apelad[oa]s?|agravad[oa]s?|embargad[oa]s?|recorrid[oa]s?|demandad[oa]s?|passiva|promovid[oa]s?|querelad[oa]s?|denunciad[oa]s?|acusad[oa]s?";

function findTarget(f: string): Pole | "ambos" | undefined {
  if (/intimem-se as partes|intimem-se ambas|as partes para|ambas as partes|partes intimadas/.test(f)) return "ambos";
  const verb =
    "(?:intim\\w*|notifi\\w*|cit\\w*|manifest\\w*|vista|diga|fale|emend\\w*|junt\\w*|apresent\\w*|comprov\\w*|recolh\\w*|especifiqu\\w*|esclarec\\w*|regulariz\\w*|indiqu\\w*|inform\\w*|deposit\\w*|pagu\\w*|cumpr\\w*)(?:-se)?\\s+(?:[a-z()]{1,6}\\s+){0,3}?";
  const a = new RegExp(`${verb}(?:${ACTIVE_WORDS})\\b`).exec(f);
  const p = new RegExp(`${verb}(?:${PASSIVE_WORDS})\\b`).exec(f);
  if (a && p) return a.index < p.index ? "ativo" : "passivo";
  return a ? "ativo" : p ? "passivo" : undefined;
}

/** Linhas "Rótulo: valor" do DJEN e de certidões. */
function labelValue(text: string, label: RegExp): string | undefined {
  for (const line of text.split(/\n/)) {
    const m = fold(line).match(label);
    if (m) {
      const v = line.slice(m.index! + m[0].length).replace(/^\s*:?\s*/, "").trim();
      if (v) return v;
    }
  }
  return undefined;
}

/** Documentos pedidos na ordem ("juntar comprovante de residência, cópia do contrato e extrato bancário"). */
const DOC_WORDS = /\b(documento|comprovante|certidao|copia|extrato|contrato|declaracao|exame|guia|fotografia|foto|nota fiscal|holerite|contracheque|procuracao|laudo|planilha|atestado|carteira|rg|cpf|cnh|recibo|fatura|boleto|ctps|instrumento|estatuto|ata)/;

export function requestedDocs(text: string): string[] {
  const f = fold(text);
  const out: string[] = [];
  const re = /\b(junt\w*|apresent\w*|traz\w*|acost\w*|anex\w*|exib\w*)\b(\s+aos autos)?\s*(,\s*)?/g;
  for (const m of f.matchAll(re)) {
    const start = m.index! + m[0].length;
    let end = f.indexOf(".", start);
    const semi = f.indexOf(";", start);
    if (end === -1 || (semi !== -1 && semi < end)) end = semi === -1 ? f.length : semi;
    let segStart = start;
    let seg = f.slice(start, Math.min(end, start + 300));
    // para no fim do pedido e no próximo verbo ("apresentar réplica, devendo juntar X": só X são documentos)
    const cut = seg.search(/,?\s*(sob pena|no prazo|em \d|em (cinco|dez|quinze)|dentro de|para fins|a fim de|para que|conforme|nos termos|, ?no prazo)|,?\s*\b(devendo|bem como)\b|\b(junt|apresent|traz|acost|anex|exib)\w*/);
    if (cut >= 0) seg = seg.slice(0, cut);
    // "junte o autor cópia do RG": tira quem deve juntar
    const subject = seg.match(/^(?:(?:o|a|os|as)\s+(?:parte\s+)?(?:autor\w*|re|reu|reus|requerente\w*|requerid\w*|exequente\w*|executad\w*|reclamante\w*|reclamad\w*|impetrante\w*|apelante\w*|apelad\w*|agravante\w*|agravad\w*)\s*,?\s*)/);
    if (subject) {
      segStart += subject[0].length;
      seg = seg.slice(subject[0].length);
    }
    if (!DOC_WORDS.test(seg)) continue;
    const original = text.slice(segStart, segStart + seg.length);
    let head = "";
    for (let item of original.split(/,|;|\s+e\s+(?=(?:o |a |os |as |do |da |de |dos |das |um |uma |c[óo]pia|comprovante|certid|extrato|declara|contrato|documento|planilha|laudo|atestado|recibo|nota))/i)) {
      item = squash(item).replace(/^(e|o|a|os|as|ainda|tamb[ée]m)\s+/i, "").replace(/[:.]+$/, "");
      // "cópia do RG, do CPF": o segundo item herda a palavra principal do primeiro
      if (/^(de|do|da|dos|das)\s/i.test(item) && head) item = `${head} ${item}`;
      else head = item.split(" ")[0];
      if (item.length < 4 || item.length > 140 || !DOC_WORDS.test(fold(item))) continue;
      const label = item.charAt(0).toUpperCase() + item.slice(1);
      if (!out.some((x) => fold(x) === fold(label))) out.push(label);
    }
  }
  return out.slice(0, 8);
}

/** Classifica um documento pelo título ou pelo começo do texto. */
export function classifyText(text: string): DocType {
  const head = fold(text.slice(0, 1600));
  const title = fold(text.slice(0, 500));
  if (
    /(excelentissim\w*|exm[oa]\.?)\s+(senhor|senhora|sr\.?|sra\.?|doutor|doutora|dr\.?|dra\.?|juiz|juiza|desembargador\w*|ministr[oa]|presidente)|^\W*(ao juizo|ao excelentissimo|egregio|colendo|ao (douto|meritissimo))/.test(head) ||
    /\bvem,? (respeitosamente,? )?(a|perante) (honrosa |digna )?(presenca de )?vossa excelencia/.test(head)
  ) {
    if (/\bcontrarrazoes\b/.test(head)) return "contrarrazoes";
    if (/\bcontestacao\b/.test(head)) return "contestacao";
    if (/\breplica\b|impugnacao a contestacao/.test(head)) return "replica";
    if (/recurso de apelacao|\bapelacao\b|agravo de instrumento|recurso inominado|embargos de declaracao|recurso especial|recurso extraordinario|recurso ordinario|agravo interno|recurso de revista/.test(head)) return "recurso";
    if (/\b(propor|ajuizar|promover)\b[^.]{0,200}\b(acao|demanda)\b|\bem face de\b/.test(head)) return "inicial";
    return "peticao";
  }
  if (/\bato ordinatorio\b/.test(title)) return "ato";
  if (/(ata|termo) de (sessao de )?audiencia|\bassentada\b/.test(title)) return "ata";
  if (/mandado de (citacao|intimacao|penhora|averiguacao|busca|constatacao)|\bmandado\b/.test(title)) return "mandado";
  if (/\bacordao\b|\bementa\b|\bacordam\b/.test(title)) return "acordao";
  if (/\bsentenca\b/.test(title)) return "sentenca";
  if (/\bdecisao\b/.test(title)) return "decisao";
  if (/\bdespacho\b/.test(title)) return "despacho";
  if (/\bcertid(ao|ao de)\b/.test(title)) return "certidao";
  if (/\blaudo\b/.test(title)) return "laudo";
  if (/\bparecer\b/.test(title)) return "parecer";
  if (/\bprocuracao\b|\bsubstabelecimento\b|instrumento particular de mandato/.test(title)) return "procuracao";
  if (/carta de citacao|\bcitacao\b|\bcite-se\b/.test(title)) return "citacao";
  if (/\bintimacao\b|\bintime-se\b|diario de justica eletronico nacional|tipo de comunicacao/.test(title)) return "intimacao";
  if (/\bcontrato\b/.test(title)) return "contrato";
  if (/comprovante|guia de recolhimento|\bboleto\b|\brecibo\b|\bdare\b|\bgru\b/.test(title)) return "comprovante";
  if (/carteira de identidade|registro geral|carteira nacional de habilitacao|certidao de (nascimento|casamento)|\bcpf\b/.test(title)) return "pessoal";
  const body = fold(text.slice(0, 20000));
  if (/julgo (parcialmente |totalmente )?(procedente|improcedente)|resolvo o merito|extingo o processo/.test(body)) return "sentenca";
  if (/acordam (os|as) (ministros|desembargador|juizes|membros)/.test(body)) return "acordao";
  if (/\b(defiro|indefiro)\b/.test(body)) return "decisao";
  if (/\b(intime-se|cite-se|intimem-se|cumpra-se|publique-se)\b/.test(body) && text.length < 6000) return "despacho";
  return "outro";
}

/** Tipo do documento a partir do nome dado pelo sistema do tribunal ("Petição Inicial", "Ato Ordinatório"). */
export function docTypeFromLabel(label: string): DocType | undefined {
  const f = fold(label);
  const table: [RegExp, DocType][] = [
    [/peticao inicial|\binicial\b/, "inicial"],
    [/contrarrazoes/, "contrarrazoes"],
    [/contestacao|defesa/, "contestacao"],
    [/replica|impugnacao a contestacao/, "replica"],
    [/apelacao|agravo|embargos|recurso/, "recurso"],
    [/ato ordinatorio/, "ato"],
    [/sentenca/, "sentenca"],
    [/acordao|ementa|voto|relatorio/, "acordao"],
    [/decisao/, "decisao"],
    [/despacho/, "despacho"],
    [/intimacao|expediente|notificacao/, "intimacao"],
    [/citacao/, "citacao"],
    [/mandado/, "mandado"],
    [/certidao/, "certidao"],
    [/ata|termo de audiencia|audiencia/, "ata"],
    [/laudo/, "laudo"],
    [/parecer/, "parecer"],
    [/procuracao|substabelecimento/, "procuracao"],
    [/identificacao|identidade|\brg\b|\bcpf\b|\bcnh\b|pessoais/, "pessoal"],
    [/comprovante|guia|custas|boleto|recibo|deposito/, "comprovante"],
    [/contrato/, "contrato"],
    [/peticao|manifestacao|requerimento|juntada/, "peticao"],
  ];
  for (const [re, t] of table) if (re.test(f)) return t;
  return undefined;
}

/** Analisa o texto de um expediente, decisão ou despacho. */
export function analyze(text: string, opts: { rite?: Rite } = {}): Analysis {
  const rite = opts.rite || "civel";
  const f = fold(text);
  const docType = classifyText(text);

  const cnjMatch = [...text.matchAll(CNJ_RE)].map((m) => parseCnj(m[0])).find(Boolean);
  const caseNumber = cnjMatch ? formatCnj(cnjMatch) : undefined;

  let kind: NoticeKind | undefined;
  const tipo = labelValue(text, /tipo (de |da )?(comunicacao|documento|expediente)\s*:?/);
  const head = fold(tipo || f.slice(0, 300));
  const body = f.slice(0, 3000);
  if (/\bcita(cao|do|da)\b|\bcite-se\b|carta de citacao/.test(head)) kind = "citacao";
  else if (/\bintima/.test(head)) kind = "intimacao";
  else if (/\bnotifica/.test(head)) kind = "notificacao";
  else if (/\bintima/.test(body)) kind = "intimacao";
  else if (/\bcite-se\b|carta de citacao|mandado de citacao|fica\w* citad/.test(body)) kind = "citacao";
  else if (/\bnotifica/.test(body)) kind = "notificacao";
  else if (/(?<!em )\bvista\b/.test(body)) kind = "vista";

  let channel: Channel | undefined;
  if (/diario de justica eletronico nacional|\bdjen\b|comunica\.pje/.test(f)) channel = "djen";
  else if (/domicilio judicial eletronico/.test(f)) channel = "domicilio";
  else if (/diario (da justica|oficial|de justica)|\bdje\b|disponibilizad\w* no diario/.test(f)) channel = "diario";
  else if (/aviso de recebimento|via postal|pelo correio|carta registrada/.test(f)) channel = "correio";
  else if (/oficial de justica|mandado de (citacao|intimacao)/.test(f)) channel = "oficial";
  else if (/\bpor edital\b|edital de (citacao|intimacao)/.test(f)) channel = "edital";
  else if (/(sistema|pje|eproc|portal)[^.]{0,40}(expediente|intimacao eletronica)|intimacao eletronica|por meio eletronico/.test(f)) channel = "sistema";

  let sentAt: string | undefined;
  const sentLabel = labelValue(text, /data (de |da )?(disponibilizacao|expedicao|envio|publicacao)/);
  if (sentLabel) sentAt = findDates(sentLabel)[0]?.iso;
  if (!sentAt) {
    const m = f.match(/disponibiliza\w*[^.\d]{0,60}(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (m) sentAt = findDates(m[1])[0]?.iso;
  }

  const recipients: string[] = [];
  const partes = labelValue(text, /^\s*(parte\(s\)|partes|destinatario\(s\)|destinatarios?|intimad[oa]\(s\)|intimad[oa]s?)\s*:/);
  if (partes) for (const p of partes.split(/;|\s+-\s+|,(?![^(]*\))/)) if (squash(p).length > 2) recipients.push(titleCase(p.replace(/\([^)]*\)/g, "")));
  const lawyers: string[] = [];
  const advs = labelValue(text, /^\s*(advogad[oa]\(s\)|advogad[oa]s?)\s*:/);
  if (advs) for (const a of advs.split(/;|,(?=\s*[A-ZÀ-Ú]{3})/)) if (squash(a).length > 3) lawyers.push(squash(a));

  const terms = explicitTerms(f);
  const raw: (Suggestion & { priority: number; index: number })[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    const m = r.re.exec(f);
    if (!m) continue;
    let days = pick(r.days, rite);
    let explicit = false;
    let counting: Counting = RITES[rite].counting;
    // o prazo escrito mais perto do trecho vale para esta sugestão
    const near = terms
      .map((t) => ({ t, dist: Math.abs(t.index - m.index!) }))
      .filter((x) => x.dist < 260)
      .sort((a, b) => a.dist - b.dist)[0]?.t;
    if (near && r.kind !== "audiencia") {
      days = near.days;
      explicit = true;
      if (near.counting) counting = near.counting;
    } else if (days === undefined && r.kind !== "audiencia" && (r.petition ?? true)) {
      days = 5;
    }
    let basis = pick(r.basis, rite);
    if (!explicit && days === 5 && !basis && r.kind !== "audiencia") basis = "CPC, art. 218, § 3º (prazo não fixado pelo juiz)";
    let docs = [...(pick(r.docs, rite) || [])];
    if (r.id === "juntada" || r.id === "emenda") {
      const asked = requestedDocs(text);
      if (asked.length) docs = r.id === "emenda" ? asked : asked;
    }
    raw.push({
      rule: r.id,
      act: pick(r.act, rite) || "",
      kind: r.kind,
      petition: r.petition ?? true,
      days: r.kind === "audiencia" ? undefined : days,
      counting,
      explicit,
      basis,
      docs,
      note: pick(r.note, rite),
      alt: r.alt,
      excerpt: around(text, m.index!, m[0].length),
      priority: r.priority,
      index: m.index!,
    });
  }
  // sem prazo escrito, um prazo único no texto vale para a sugestão principal
  raw.sort((a, b) => b.priority - a.priority || a.index - b.index);
  if (terms.length === 1 && raw[0] && !raw[0].explicit && raw[0].kind !== "audiencia" && raw[0].petition) {
    raw[0].days = terms[0].days;
    raw[0].explicit = true;
    if (terms[0].counting) raw[0].counting = terms[0].counting;
  }
  // regras genéricas só entram quando não há nada mais específico
  const specific = raw.filter((s) => s.priority > 40);
  let chosen = specific.length ? [...specific, ...raw.filter((s) => s.rule === "decisao" && docType === "decisao")] : raw;
  if (chosen.some((s) => s.petition || s.kind === "audiencia")) chosen = chosen.filter((s) => s.rule !== "ciencia");
  // a sentença ou o acórdão intimados por expediente também trazem "intimação" e "vista": evita duplicar com "Manifestação"
  if (chosen.some((s) => s.kind === "recurso")) chosen = chosen.filter((s) => s.rule !== "manifestacao");
  const suggestions: Suggestion[] = chosen.map(({ priority: _p, index: _i, ...s }) => s);
  // documentos pedidos junto com outro ato ("apresentar réplica, devendo juntar X e Y") instruem esse ato
  const asked = requestedDocs(text);
  const primary = suggestions.find((s) => s.petition && s.rule !== "juntada");
  if (asked.length && primary) {
    primary.docs = [...asked, ...primary.docs.filter((d) => !asked.some((a) => fold(a) === fold(d)))];
    const i = suggestions.findIndex((s) => s.rule === "juntada");
    if (i >= 0) suggestions.splice(i, 1);
  }

  const hearing = suggestions.some((s) => s.rule === "audiencia" || s.rule === "sessao")
    ? findHearing(text, f, !suggestions.some((s) => s.rule === "audiencia"))
    : undefined;
  if (hearing) for (const s of suggestions) if (s.rule === "audiencia") s.act = hearing.kind || s.act;

  let status: Analysis["status"];
  for (const r of STATUS_RULES) {
    const m = r.re.exec(f);
    if (m) {
      status = { status: r.status, excerpt: around(text, m.index, m[0].length) };
      break;
    }
  }
  if (!status) {
    const concl = /(faco|fiz|vieram|vao|subam) (os autos |estes autos )?conclusos|conclusos para (decisao|sentenca|despacho|julgamento)/.exec(f);
    if (docType === "sentenca") status = { status: "sentenciado", excerpt: "Sentença" };
    else if (hearing && !suggestions.some((s) => s.rule === "sessao")) status = { status: "audiencia", excerpt: hearing.kind || "Audiência" };
    else if (suggestions.some((s) => s.petition && s.kind !== "recurso")) status = { status: "aguardando", excerpt: suggestions[0].excerpt };
    else if (concl) status = { status: "concluso", excerpt: around(text, concl.index, concl[0].length) };
  }

  return { caseNumber, kind, channel, sentAt, target: findTarget(f), recipients, lawyers, suggestions, hearing, status, docType };
}

/** O número do processo aparece no texto? (compara só os dígitos) */
export function mentionsCase(text: string, number: string): boolean {
  const d = digitsOf(number);
  if (d.length < 15) return false;
  return digitsOf(text).includes(d);
}
