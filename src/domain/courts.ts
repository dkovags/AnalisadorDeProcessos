import { fold } from "./text";

// Tribunais, classes processuais e regras de coerência usadas nas citações de jurisprudência.

const STATES: Record<string, { name: string; capital: string }> = {
  AC: { name: "Acre", capital: "Rio Branco" },
  AL: { name: "Alagoas", capital: "Maceió" },
  AP: { name: "Amapá", capital: "Macapá" },
  AM: { name: "Amazonas", capital: "Manaus" },
  BA: { name: "Bahia", capital: "Salvador" },
  CE: { name: "Ceará", capital: "Fortaleza" },
  DF: { name: "Distrito Federal", capital: "Brasília" },
  ES: { name: "Espírito Santo", capital: "Vitória" },
  GO: { name: "Goiás", capital: "Goiânia" },
  MA: { name: "Maranhão", capital: "São Luís" },
  MT: { name: "Mato Grosso", capital: "Cuiabá" },
  MS: { name: "Mato Grosso do Sul", capital: "Campo Grande" },
  MG: { name: "Minas Gerais", capital: "Belo Horizonte" },
  PA: { name: "Pará", capital: "Belém" },
  PB: { name: "Paraíba", capital: "João Pessoa" },
  PR: { name: "Paraná", capital: "Curitiba" },
  PE: { name: "Pernambuco", capital: "Recife" },
  PI: { name: "Piauí", capital: "Teresina" },
  RJ: { name: "Rio de Janeiro", capital: "Rio de Janeiro" },
  RN: { name: "Rio Grande do Norte", capital: "Natal" },
  RS: { name: "Rio Grande do Sul", capital: "Porto Alegre" },
  RO: { name: "Rondônia", capital: "Porto Velho" },
  RR: { name: "Roraima", capital: "Boa Vista" },
  SC: { name: "Santa Catarina", capital: "Florianópolis" },
  SE: { name: "Sergipe", capital: "Aracaju" },
  SP: { name: "São Paulo", capital: "São Paulo" },
  TO: { name: "Tocantins", capital: "Palmas" },
};

export const SUPERIOR = ["STF", "STJ", "TST", "TSE", "STM"];

export function isSuperior(court?: string): boolean {
  return !!court && SUPERIOR.includes(court.toUpperCase());
}

/** "TJ-SP", "tjsp", "TRF 3", "TRT-2ª" → "TJSP", "TRF3", "TRT2" */
export function normalizeCourt(s: string): string {
  const t = s.toUpperCase().replace(/[ªº°]/g, "").replace(/\s+/g, "");
  const m = t.match(/^(TJ|TRF|TRT|TRE|TJM)-?([A-Z]{2}|\d{1,2})(REGIAO)?$/);
  if (m) return m[1] === "TRE" ? `TRE-${m[2]}` : `${m[1]}${m[2]}`;
  return t.replace(/-/g, "");
}

/** Sigla a partir do nome por extenso ("Superior Tribunal de Justiça" → "STJ"). */
export function courtFromName(s: string): string | undefined {
  const f = fold(s);
  if (/supremo tribunal federal/.test(f)) return "STF";
  if (/superior tribunal de justica/.test(f)) return "STJ";
  if (/tribunal superior do trabalho/.test(f)) return "TST";
  if (/tribunal superior eleitoral/.test(f)) return "TSE";
  if (/superior tribunal militar/.test(f)) return "STM";
  if (/turma nacional de uniformizacao/.test(f)) return "TNU";
  let m = f.match(/tribunal regional federal da (\d)/);
  if (m) return `TRF${m[1]}`;
  m = f.match(/tribunal regional do trabalho da (\d{1,2})/);
  if (m) return `TRT${m[1]}`;
  if (/tribunal de justica do distrito federal/.test(f)) return "TJDFT";
  m = f.match(/tribunal de justica (?:do estado )?(?:d[eoa] )?([a-z ]+?)(?:\s*[,.(\n]|$)/);
  if (m) {
    const uf = Object.entries(STATES).find(([, v]) => fold(v.name) === m![1].trim())?.[0];
    if (uf) return uf === "DF" ? "TJDFT" : `TJ${uf}`;
  }
  return undefined;
}

export const COURT_SIGLA_RE = /\b(STF|STJ|TST|TSE|STM|TNU|TJDFT|TJ-?[A-Z]{2}|TRF-?\s?\d|TRT-?\s?\d{1,2}|TRE-?[A-Z]{2})\b/;

/** Nome por extenso ("TJSP" → "Tribunal de Justiça do Estado de São Paulo"). */
export function courtName(court: string): string {
  const c = court.toUpperCase();
  const fixed: Record<string, string> = {
    STF: "Supremo Tribunal Federal",
    STJ: "Superior Tribunal de Justiça",
    TST: "Tribunal Superior do Trabalho",
    TSE: "Tribunal Superior Eleitoral",
    STM: "Superior Tribunal Militar",
    TNU: "Turma Nacional de Uniformização",
    TJDFT: "Tribunal de Justiça do Distrito Federal e dos Territórios",
  };
  if (fixed[c]) return fixed[c];
  let m = c.match(/^TRF(\d)$/);
  if (m) return `Tribunal Regional Federal da ${m[1]}ª Região`;
  m = c.match(/^TRT(\d{1,2})$/);
  if (m) return `Tribunal Regional do Trabalho da ${m[1]}ª Região`;
  m = c.match(/^TJ([A-Z]{2})$/);
  if (m && STATES[m[1]]) return `Tribunal de Justiça do Estado ${preposition(m[1])} ${STATES[m[1]].name}`;
  m = c.match(/^TRE-([A-Z]{2})$/);
  if (m && STATES[m[1]]) return `Tribunal Regional Eleitoral ${preposition(m[1])} ${STATES[m[1]].name}`;
  return court;
}

function preposition(uf: string): string {
  if (["BA", "PB"].includes(uf)) return "da";
  if (["AC", "AP", "AM", "CE", "ES", "MA", "PA", "PR", "PI", "RJ", "RN", "RS", "TO", "MT", "MS"].includes(uf)) return "do";
  return "de";
}

/** UF do tribunal estadual ou regional eleitoral. */
export function ufOf(court: string): string | undefined {
  const m = court.toUpperCase().match(/^(?:TJ|TRE-)([A-Z]{2})$/);
  if (m && STATES[m[1]]) return m[1];
  return court.toUpperCase() === "TJDFT" ? "DF" : undefined;
}

/** Jurisdição e local de publicação, para a referência da ABNT. */
export function abntJurisdiction(court: string): { jurisdiction: string; body: string; place: string } {
  const uf = court.toUpperCase().startsWith("TJ") ? ufOf(court) : undefined;
  if (uf) {
    const st = STATES[uf];
    return {
      jurisdiction: uf === "DF" ? "DISTRITO FEDERAL" : `${st.name.toUpperCase()} (Estado)`,
      body: court.toUpperCase() === "TJDFT" ? "Tribunal de Justiça do Distrito Federal e dos Territórios" : "Tribunal de Justiça",
      place: `${st.capital}, ${uf}`,
    };
  }
  return { jurisdiction: "BRASIL", body: courtName(court), place: "Brasília, DF" };
}

/** Domínio do site do tribunal, para pesquisar a decisão. */
export function courtDomain(court?: string): string | undefined {
  if (!court) return undefined;
  const c = court.toUpperCase();
  if (["STF", "STJ", "TST", "TSE", "STM"].includes(c)) return `${c.toLowerCase()}.jus.br`;
  if (c === "TNU") return "cjf.jus.br";
  if (c === "TJDFT") return "tjdft.jus.br";
  let m = c.match(/^(TJ[A-Z]{2}|TRF\d|TRT\d{1,2})$/);
  if (m) return `${m[1].toLowerCase()}.jus.br`;
  m = c.match(/^TRE-([A-Z]{2})$/);
  if (m) return `tre-${m[1].toLowerCase()}.jus.br`;
  return undefined;
}

/** Data de instalação, para apontar julgamentos impossíveis. */
export const COURT_SINCE: Record<string, string> = {
  STJ: "1989-04-07",
  TRF1: "1989-03-30",
  TRF2: "1989-03-30",
  TRF3: "1989-03-30",
  TRF4: "1989-03-30",
  TRF5: "1989-03-30",
  TRF6: "2022-08-19",
};

/** Classes dos tribunais superiores: abreviatura e nome por extenso. */
export const CLASSES: Record<string, string> = {
  REsp: "Recurso Especial",
  AREsp: "Agravo em Recurso Especial",
  EREsp: "Embargos de Divergência em Recurso Especial",
  EAREsp: "Embargos de Divergência em Agravo em Recurso Especial",
  AgInt: "Agravo Interno",
  AgRg: "Agravo Regimental",
  AgR: "Agravo Regimental",
  EDcl: "Embargos de Declaração",
  ED: "Embargos de Declaração",
  EDv: "Embargos de Divergência",
  RMS: "Recurso em Mandado de Segurança",
  RHC: "Recurso em Habeas Corpus",
  HC: "Habeas Corpus",
  MS: "Mandado de Segurança",
  CC: "Conflito de Competência",
  Rcl: "Reclamação",
  AR: "Ação Rescisória",
  RE: "Recurso Extraordinário",
  ARE: "Recurso Extraordinário com Agravo",
  AI: "Agravo de Instrumento",
  ADI: "Ação Direta de Inconstitucionalidade",
  ADC: "Ação Declaratória de Constitucionalidade",
  ADO: "Ação Direta de Inconstitucionalidade por Omissão",
  ADPF: "Arguição de Descumprimento de Preceito Fundamental",
  MI: "Mandado de Injunção",
  ACO: "Ação Cível Originária",
  AO: "Ação Originária",
  AP: "Ação Penal",
  APn: "Ação Penal",
  Inq: "Inquérito",
  Pet: "Petição",
  SS: "Suspensão de Segurança",
  SL: "Suspensão de Liminar",
  SLS: "Suspensão de Liminar e de Sentença",
  STA: "Suspensão de Tutela Antecipada",
  SEC: "Sentença Estrangeira Contestada",
  HDE: "Homologação de Decisão Estrangeira",
  PUIL: "Pedido de Uniformização de Interpretação de Lei",
  RR: "Recurso de Revista",
  AIRR: "Agravo de Instrumento em Recurso de Revista",
  RRAg: "Recurso de Revista com Agravo",
  IRDR: "Incidente de Resolução de Demandas Repetitivas",
  IAC: "Incidente de Assunção de Competência",
  QO: "Questão de Ordem",
};

/** Classes que só existem num tribunal. */
export const CLASS_COURT: Record<string, string> = {
  REsp: "STJ", AREsp: "STJ", EREsp: "STJ", EAREsp: "STJ", RMS: "STJ", PUIL: "STJ", APn: "STJ", SLS: "STJ", SEC: "STJ", HDE: "STJ", AgInt: "STJ",
  RE: "STF", ARE: "STF", ADI: "STF", ADC: "STF", ADO: "STF", ADPF: "STF", ACO: "STF", STA: "STF",
  RR: "TST", AIRR: "TST", RRAg: "TST",
};

// Nomes por extenso das classes (cabeçalhos dos acórdãos) → abreviatura. Do mais longo ao mais curto.
const LONG_NAMES: [RegExp, string][] = [
  [/^embargos de divergencia em agravo em recurso especial/, "EAREsp"],
  [/^embargos de divergencia em recurso especial/, "EREsp"],
  [/^agravo em recurso especial/, "AREsp"],
  [/^recurso especial/, "REsp"],
  [/^recurso extraordinario com agravo|^agravo em recurso extraordinario/, "ARE"],
  [/^recurso extraordinario/, "RE"],
  [/^recurso (ordinario )?em mandado de seguranca/, "RMS"],
  [/^recurso (ordinario )?em habeas corpus/, "RHC"],
  [/^habeas corpus/, "HC"],
  [/^mandado de seguranca/, "MS"],
  [/^conflito de competencia/, "CC"],
  [/^reclamacao/, "Rcl"],
  [/^acao rescisoria/, "AR"],
  [/^acao direta de inconstitucionalidade por omissao/, "ADO"],
  [/^acao direta de inconstitucionalidade/, "ADI"],
  [/^acao declaratoria de constitucionalidade/, "ADC"],
  [/^arguicao de descumprimento de preceito fundamental/, "ADPF"],
  [/^mandado de injuncao/, "MI"],
  [/^agravo de instrumento em recurso de revista/, "AIRR"],
  [/^recurso de revista/, "RR"],
  [/^agravo interno|^ag\.? ?int\.?/, "AgInt"],
  [/^agravo regimental|^ag\.? ?reg\.?/, "AgRg"],
  [/^embargos de declaracao|^emb\.? ?decl\.?/, "EDcl"],
  [/^pedido de uniformizacao de interpretacao de lei/, "PUIL"],
  [/^acao penal/, "APn"],
];

/** Classes de segundo grau e juizados (nome por extenso). */
const LOCAL_CLASSES: [RegExp, string][] = [
  [/^apelacao civel|^ap\.? ?civ(el)?\.?\b|^apciv\b|^ac\b/, "Apelação Cível"],
  [/^apelacao criminal|^ap\.? ?crim\.?\b|^apcrim\b|^acr\b/, "Apelação Criminal"],
  [/^apelacao\b|^apl\b/, "Apelação"],
  [/^agravo de instrumento|^ai\b|^agi\b/, "Agravo de Instrumento"],
  [/^agravo interno|^agint\b/, "Agravo Interno"],
  [/^embargos de declaracao|^edcl\b|^ed\b/, "Embargos de Declaração"],
  [/^recurso inominado|^ri\b|^rec\.? inom\.?/, "Recurso Inominado"],
  [/^remessa necessaria|^reexame necessario/, "Remessa Necessária"],
  [/^mandado de seguranca|^ms\b/, "Mandado de Segurança"],
  [/^habeas corpus|^hc\b/, "Habeas Corpus"],
  [/^recurso em sentido estrito|^rese\b/, "Recurso em Sentido Estrito"],
  [/^recurso ordinario( trabalhista)?|^rot?\b/, "Recurso Ordinário"],
  [/^agravo de peticao|^ap\b/, "Agravo de Petição"],
  [/^conflito de competencia/, "Conflito de Competência"],
  [/^incidente de resolucao de demandas repetitivas|^irdr\b/, "IRDR"],
];

/**
 * Converte o nome de uma classe ("AGRAVO INTERNO NO AGRAVO EM RECURSO ESPECIAL", "AgInt no AREsp") na forma
 * abreviada usual ("AgInt no AREsp"). Devolve também a classe principal (a última).
 */
export function normalizeClass(raw: string): { className: string; base: string } | null {
  let rest = fold(raw).replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  const joins: string[] = [];
  for (let guard = 0; rest && guard < 6; guard++) {
    let found = "";
    let len = 0;
    for (const [re, abbr] of LONG_NAMES) {
      const m = rest.match(re);
      if (m) {
        found = abbr;
        len = m[0].length;
        break;
      }
    }
    if (!found) {
      const ab = Object.keys(CLASSES).find((k) => new RegExp(`^${k.toLowerCase()}\\b`).test(rest));
      if (ab) {
        found = ab;
        len = ab.length;
      }
    }
    if (!found) break;
    parts.push(found);
    rest = rest.slice(len).trim();
    const j = rest.match(/^(nos|nas|no|na|em)\b\s*/);
    if (!j) break;
    joins.push(j[1]);
    rest = rest.slice(j[0].length);
  }
  if (parts.length && !rest.replace(/[^a-z]/g, "")) {
    let className = parts[0];
    for (let i = 1; i < parts.length; i++) className += ` ${joins[i - 1] || "no"} ${parts[i]}`;
    return { className, base: parts[parts.length - 1] };
  }
  const f = fold(raw).trim();
  for (const [re, name] of LOCAL_CLASSES) if (re.test(f) && f.replace(re, "").replace(/[^a-z]/g, "").length === 0) return { className: name, base: name };
  return null;
}

/** "Terceira Turma", "T3 - TERCEIRA TURMA", "3ª Turma" → "Terceira Turma"; "22ª CÂMARA DE DIREITO PRIVADO" → "22ª Câmara de Direito Privado". */
const ORDINALS = ["primeira", "segunda", "terceira", "quarta", "quinta", "sexta", "setima", "oitava", "nona", "decima"];
const ORDINAL_LABEL = ["Primeira", "Segunda", "Terceira", "Quarta", "Quinta", "Sexta", "Sétima", "Oitava", "Nona", "Décima"];

export const BODY_RE =
  /\b(?:T\d\s*-\s*)?(?:(primeira|segunda|terceira|quarta|quinta|sexta|s[ée]tima|oitava|nona|d[ée]cima)|(\d{1,2})\s*[ªaº]?)\s+(turma|se[çc][ãa]o|c[âa]mara|grupo)(?:\s+(recursal|c[íi]vel|criminal|especial|extraordin[áa]ria|isolada|de direito (?:privado|p[úu]blico|criminal)|de direito)(?:\s+(?:c[íi]vel|criminal|privado|p[úu]blico))?)?|\bcorte especial\b|\b[óo]rg[ãa]o especial\b|\btribunal pleno\b|\bplen[áa]rio\b|\bpleno\b|\bsbdi-?\s?[12]\b|\bsdi-?\s?[12]\b|\bsdc\b|turma nacional de uniformiza[çc][ãa]o|\bsubse[çc][ãa]o i+ especializada em diss[íi]dios individuais/i;

export function normalizeBody(raw: string): string {
  const f = fold(raw).trim();
  const m = f.match(/(?:(primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima)|(\d{1,2})\s*[ao]?)\s+(turma|secao|camara|grupo)(.*)$/);
  if (m) {
    const n = m[1] ? ORDINALS.indexOf(m[1]) + 1 : Number(m[2]);
    const noun = { turma: "Turma", secao: "Seção", camara: "Câmara", grupo: "Grupo" }[m[3]]!;
    const tail = raw.trim().slice(raw.trim().length - m[4].length).trim().toLowerCase();
    const words = tail ? " " + tail.replace(/\bdireito\b/, "Direito").replace(/\b(privado|público|publico|criminal|cível|civel)\b/, (w) => w[0].toUpperCase() + w.slice(1)) : "";
    if (m[3] === "camara" || m[3] === "grupo" || /recursal/.test(tail) || n > 10) return `${n}ª ${noun}${words}`;
    return `${ORDINAL_LABEL[n - 1]} ${noun}${words}`;
  }
  if (/corte especial/.test(f)) return "Corte Especial";
  if (/orgao especial/.test(f)) return "Órgão Especial";
  if (/tribunal pleno|plenario|^pleno$/.test(f)) return "Tribunal Pleno";
  const sb = f.match(/s(?:b)?di-?\s?([12])/);
  if (sb) return `SBDI-${sb[1]}`;
  if (/sdc/.test(f)) return "SDC";
  if (/turma nacional/.test(f)) return "Turma Nacional de Uniformização";
  return raw.trim();
}

/** "Terceira Turma" → "3. Turma" (ABNT). */
export function abntBody(body: string): string {
  const f = fold(body);
  const i = ORDINALS.findIndex((o) => f.startsWith(o + " "));
  if (i >= 0) return `${i + 1}. ${body.slice(body.indexOf(" ") + 1)}`;
  return body.replace(/^(\d{1,2})ª/, "$1.");
}

/** Número da turma ou seção (para conferir se existe no tribunal). */
export function bodyNumber(body: string): { kind: "turma" | "secao" | "camara" | "outro"; n?: number } {
  const f = fold(body);
  const m = f.match(/(?:(primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima)|(\d{1,2}))\D{0,3}\s*(turma|secao|camara)/);
  if (!m) return { kind: "outro" };
  const n = m[1] ? ORDINALS.indexOf(m[1]) + 1 : Number(m[2]);
  return { kind: m[3] === "turma" ? (/recursal/.test(f) ? "outro" : "turma") : m[3] === "secao" ? "secao" : "camara", n };
}

/** Título de quem relata: Min., Des., Des. Federal, Juiz(a). */
export function rapporteurTitle(court: string | undefined, female?: boolean): string {
  const c = (court || "").toUpperCase();
  if (isSuperior(c)) return female ? "Min." : "Min.";
  if (/^TRF/.test(c)) return female ? "Des. Federal" : "Des. Federal";
  if (/^(TJ|TRT|TRE)/.test(c)) return "Des.";
  if (c === "TNU") return female ? "Juíza Federal" : "Juiz Federal";
  return "";
}

/** Título por extenso, no formato do STJ: "relatora Ministra", "relator Desembargador". */
export function rapporteurLong(court: string | undefined, female?: boolean): string {
  const c = (court || "").toUpperCase();
  const who = female ? "relatora" : "relator";
  if (isSuperior(c)) return `${who} ${female ? "Ministra" : "Ministro"}`;
  if (/^TRF/.test(c)) return `${who} ${female ? "Desembargadora Federal" : "Desembargador Federal"}`;
  if (/^(TJ|TRT|TRE)/.test(c)) return `${who} ${female ? "Desembargadora" : "Desembargador"}`;
  if (c === "TNU") return `${who} ${female ? "Juíza Federal" : "Juiz Federal"}`;
  return who;
}
