export type ID = string;

/** Polo da parte no processo. */
export type Pole = "ativo" | "passivo" | "terceiro";

/** Regras de prazo que se aplicam ao processo. */
export type Rite = "civel" | "juizado" | "trabalho" | "penal";

export type CaseStatus =
  | "ativo"
  | "aguardando"
  | "concluso"
  | "audiencia"
  | "pericia"
  | "sentenciado"
  | "recurso"
  | "transitado"
  | "execucao"
  | "suspenso"
  | "arquivado_prov"
  | "arquivado"
  | "encerrado";

/** Tipo de pessoa, para conferir a citação e lembrar do prazo em dobro. */
export type PersonKind = "pf" | "pj" | "me" | "publico";

export interface Party {
  id: ID;
  name: string;
  pole: Pole;
  /** Autor, Réu, Reclamante, Apelante... */
  role?: string;
  /** CPF ou CNPJ */
  doc?: string;
  /** Advogados ou procuradores, um por linha. */
  lawyers?: string;
  /** Cliente do escritório. */
  client?: boolean;
  kind?: PersonKind;
  /** Prazo em dobro (Fazenda Pública, Ministério Público, Defensoria: CPC, arts. 180, 183 e 186). */
  doubleTerm?: boolean;
}

export interface HistoryEntry {
  id: ID;
  /** Data do fato (AAAA-MM-DD). */
  date: string;
  /** Quando foi registrado. */
  at: string;
  kind: "status" | "nota";
  text: string;
}

export interface Case {
  id: ID;
  /** Número do processo (formatado quando segue o padrão CNJ). */
  number: string;
  /** Apelido, como "Maria x Banco Alfa". */
  title?: string;
  /** Sigla do tribunal (TJSP, TRF3, TRT2...). */
  court?: string;
  /** Sistema processual (PJe, eproc, e-SAJ...). */
  system?: string;
  /** Órgão julgador (vara, câmara, turma). */
  body?: string;
  className?: string;
  subjects?: string;
  rite: Rite;
  status: CaseStatus;
  /** Resultado, quando encerrado. */
  outcome?: string;
  /** Valor da causa em centavos. */
  value?: number;
  /** Data da distribuição. */
  filedAt?: string;
  freeJustice?: boolean;
  secret?: boolean;
  parties: Party[];
  notes?: string;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type NoticeKind = "intimacao" | "citacao" | "notificacao" | "vista" | "outro";

/** Meio pelo qual o expediente chegou à parte; define o início da contagem. */
export type Channel = "djen" | "diario" | "sistema" | "domicilio" | "correio" | "oficial" | "email" | "audiencia" | "pessoal" | "edital";

export type Counting = "uteis" | "corridos";

/** aberto: aguardando ciência ou em prazo; cumprido: ato praticado; encerrado: sem manifestação ou só ciência. */
export type NoticeStatus = "aberto" | "cumprido" | "encerrado";

export interface Hearing {
  date: string;
  /** "14:30" */
  time?: string;
  kind?: string;
  place?: string;
}

export interface Notice {
  id: ID;
  caseId: ID;
  kind: NoticeKind;
  channel: Channel;
  /** Partes destinatárias (ids das partes do processo). */
  recipients: ID[];
  /** Expedição, envio ou disponibilização. */
  sentAt: string;
  /** Ciência (consulta), juntada do aviso de recebimento ou do mandado, confirmação do e-mail ou fim da dilação do edital. */
  readAt?: string;
  /** Prazo em dias; vazio quando não há prazo. */
  days?: number;
  counting: Counting;
  double?: boolean;
  /** Contar o prazo a partir da audiência (ex.: contestação depois da audiência de conciliação, CPC, art. 335, I). */
  fromHearing?: boolean;
  /** Vencimento informado à mão (substitui o calculado). */
  dueOverride?: string;
  /** Ato a praticar ("Réplica", "Contrarrazões"...). */
  act?: string;
  basis?: string;
  /** Exige petição (gera uma providência). */
  petition?: boolean;
  /** Teor do expediente. */
  content?: string;
  docId?: ID;
  status: NoticeStatus;
  closedAt?: string;
  hearing?: Hearing;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskKind = "peticao" | "recurso" | "audiencia" | "pagamento" | "diligencia" | "outro";
export type TaskStatus = "pendente" | "elaboracao" | "protocolada" | "cancelada";

export interface ChecklistItem {
  id: ID;
  label: string;
  done: boolean;
  /** Documento da base que atende o item. */
  docId?: ID;
}

/** Providência: petição ou ato a praticar, com os documentos para instruí-la. */
export interface Task {
  id: ID;
  caseId: ID;
  noticeId?: ID;
  title: string;
  kind: TaskKind;
  /** Prazo fatal informado (sem expediente, ou para substituir o do expediente). */
  due?: string;
  /** Prazo interno informado (senão, calculado com a antecedência das configurações). */
  internalDue?: string;
  status: TaskStatus;
  checklist: ChecklistItem[];
  basis?: string;
  notes?: string;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type DocType =
  | "processo"
  | "inicial"
  | "contestacao"
  | "replica"
  | "peticao"
  | "recurso"
  | "contrarrazoes"
  | "decisao"
  | "despacho"
  | "sentenca"
  | "acordao"
  | "ato"
  | "intimacao"
  | "citacao"
  | "mandado"
  | "certidao"
  | "ata"
  | "laudo"
  | "parecer"
  | "procuracao"
  | "pessoal"
  | "comprovante"
  | "contrato"
  | "jurisprudencia"
  | "outro";

/** Documento da base de conhecimento. O texto fica no arquivo (fileId), nas páginas indicadas. */
export interface Doc {
  id: ID;
  caseId?: ID;
  precedentId?: ID;
  fileId: ID;
  /** Primeira e última página do arquivo (1 = primeira); vazio = arquivo inteiro. */
  pages?: [number, number];
  /** Documento "processo integral" de onde este foi separado. */
  parentId?: ID;
  title: string;
  type: DocType;
  date?: string;
  /** Identificador no sistema do tribunal (Id. do PJe, código do e-SAJ, evento e documento do eproc). */
  courtId?: string;
  signer?: string;
  origin: "arquivo" | "texto" | "processo";
  createdAt: string;
}

/** Arquivo guardado no aparelho (o conteúdo e o texto ficam em depósitos separados). */
export interface FileMeta {
  id: ID;
  name: string;
  mime: string;
  size: number;
  pageCount: number;
  /** Páginas sem texto (digitalizadas como imagem). */
  emptyPages?: number[];
  /** SHA-256, para avisar quando o mesmo arquivo é enviado de novo. */
  sha?: string;
  createdAt: string;
}

/** Precedente qualificado (CPC, art. 927). */
export type Binding = "" | "repetitivo" | "repercussao" | "sumula" | "sumula_vinculante" | "irdr" | "iac" | "controle";
export type Standing = "vigente" | "superado" | "cancelado";

export interface PrecedentParty {
  name: string;
  /** Recorrente, Agravado, Impetrante... */
  role: string;
  pole: Pole;
  lawyers?: string;
}

export interface Precedent {
  id: ID;
  court: string;
  /** Classe, por extenso ou abreviada ("REsp", "AgInt no AREsp", "Apelação Cível", "Súmula", "Tema"). */
  className: string;
  number: string;
  uf?: string;
  rapporteur?: string;
  /** Relatora, Ministra, Desembargadora... */
  female?: boolean;
  /** Relator(a) para o acórdão, quando o relator ficou vencido. */
  rapporteurForJudgment?: string;
  body?: string;
  judgedAt?: string;
  publishedAt?: string;
  /** Fonte da publicação (DJe, DJEN, RSTJ...). */
  source?: string;
  /** Ementa (ou o texto da súmula). */
  summary?: string;
  thesis?: string;
  binding: Binding;
  bindingNumber?: string;
  standing: Standing;
  parties: PrecedentParty[];
  topics?: string[];
  url?: string;
  /** Inteiro teor na base de conhecimento. */
  docId?: ID;
  /** Processos em que o precedente é usado. */
  caseIds: ID[];
  /** Data em que foi conferido na fonte oficial. */
  checkedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Feriado local, forense ou suspensão de prazos informada pela pessoa. */
export interface Holiday {
  id: ID;
  date: string;
  /** Último dia, para períodos (ex.: suspensão de prazos de uma semana). */
  end?: string;
  /** Repete todo ano (usa só dia e mês). */
  yearly?: boolean;
  label: string;
  /** feriado: sem expediente; suspensao: prazos suspensos; parcial: expediente reduzido (CPC, art. 224, § 1º). */
  kind: "feriado" | "suspensao" | "parcial";
  /** Tribunais a que se aplica (vazio = todos). */
  courts?: string[];
}

export type CitationStyle = "forense" | "stj" | "abnt";

export interface Prefs {
  /** Nome de quem usa (advogado ou advogada). */
  name?: string;
  /** Inscrição na OAB, como "RN 1234". */
  oab?: string;
  theme?: "light" | "dark" | "auto";
  holidays: Holiday[];
  /** Feriados forenses usuais incluídos no cálculo. */
  forensic: { carnaval: boolean; cinzas: boolean; paixao: boolean; quintaSanta: boolean; corpus: boolean; federal: boolean };
  /** Antecedência do prazo interno, em dias úteis. */
  marginDays: number;
  notify?: boolean;
  citationStyle: CitationStyle;
  /** Copiar a ementa como citação direta junto com a referência. */
  quoteSummary: boolean;
}

export interface Dataset {
  version: 1;
  cases: Record<ID, Case>;
  notices: Record<ID, Notice>;
  tasks: Record<ID, Task>;
  docs: Record<ID, Doc>;
  files: Record<ID, FileMeta>;
  precedents: Record<ID, Precedent>;
  prefs: Prefs;
}

export type Collection = "cases" | "notices" | "tasks" | "docs" | "files" | "precedents";
