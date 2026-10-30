import type { Binding, CaseStatus, DocType, Pole, Standing, TaskKind, TaskStatus } from "./types";

// Nomes exibidos nas telas.

export const STATUS: Record<CaseStatus, { label: string; tone: "ok" | "info" | "warn" | "muted" | "done"; active: boolean }> = {
  ativo: { label: "Em andamento", tone: "ok", active: true },
  aguardando: { label: "Aguardando manifestação", tone: "warn", active: true },
  concluso: { label: "Concluso para decisão", tone: "info", active: true },
  audiencia: { label: "Aguardando audiência", tone: "info", active: true },
  pericia: { label: "Em perícia", tone: "info", active: true },
  sentenciado: { label: "Sentenciado", tone: "info", active: true },
  recurso: { label: "Em grau de recurso", tone: "info", active: true },
  transitado: { label: "Transitado em julgado", tone: "done", active: true },
  execucao: { label: "Cumprimento de sentença", tone: "ok", active: true },
  suspenso: { label: "Suspenso ou sobrestado", tone: "muted", active: true },
  arquivado_prov: { label: "Arquivado provisoriamente", tone: "muted", active: false },
  arquivado: { label: "Arquivado (baixa definitiva)", tone: "muted", active: false },
  encerrado: { label: "Encerrado", tone: "done", active: false },
};

export const STATUS_ORDER = Object.keys(STATUS) as CaseStatus[];

export const DOC_TYPES: Record<DocType, string> = {
  processo: "Processo integral",
  inicial: "Petição inicial",
  contestacao: "Contestação",
  replica: "Réplica",
  peticao: "Petição",
  recurso: "Recurso",
  contrarrazoes: "Contrarrazões",
  decisao: "Decisão",
  despacho: "Despacho",
  sentenca: "Sentença",
  acordao: "Acórdão",
  ato: "Ato ordinatório",
  intimacao: "Intimação",
  citacao: "Citação",
  mandado: "Mandado",
  certidao: "Certidão",
  ata: "Ata ou termo de audiência",
  laudo: "Laudo",
  parecer: "Parecer",
  procuracao: "Procuração",
  pessoal: "Documento pessoal",
  comprovante: "Comprovante ou guia",
  contrato: "Contrato",
  jurisprudencia: "Jurisprudência",
  outro: "Outro documento",
};

/** Tipos de documento que trazem ordens do juízo (e podem exigir providências). */
export const ORDER_TYPES: DocType[] = ["decisao", "despacho", "sentenca", "acordao", "ato", "intimacao", "citacao", "mandado", "ata"];

export const POLES: Record<Pole, string> = { ativo: "Polo ativo", passivo: "Polo passivo", terceiro: "Terceiros e outros" };

export const TASK_KINDS: Record<TaskKind, string> = {
  peticao: "Petição",
  recurso: "Recurso",
  audiencia: "Audiência ou sessão",
  pagamento: "Pagamento ou depósito",
  diligencia: "Diligência",
  outro: "Outra providência",
};

export const TASK_STATUS: Record<TaskStatus, string> = {
  pendente: "A fazer",
  elaboracao: "Em elaboração",
  protocolada: "Protocolada",
  cancelada: "Cancelada",
};

export const BINDINGS: Record<Binding, string> = {
  "": "Não é precedente qualificado",
  repetitivo: "Recurso repetitivo (tema)",
  repercussao: "Repercussão geral (tema)",
  sumula: "Súmula",
  sumula_vinculante: "Súmula vinculante",
  irdr: "IRDR",
  iac: "Assunção de competência (IAC)",
  controle: "Controle concentrado de constitucionalidade",
};

export const STANDINGS: Record<Standing, string> = {
  vigente: "Vigente",
  superado: "Superado ou revisto",
  cancelado: "Cancelado",
};
