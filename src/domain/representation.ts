import { fold } from "./text";
import type { DocType } from "./types";

// Documentos de representação que as partes juntam aos autos (substabelecimento, carta de preposição, contrato social,
// estatuto, atas de eleição, cartão do CNPJ) e as procurações. Na importação do processo integral, eles podem ficar
// de fora da base e ser cortados do PDF guardado.

/** "representacao": substabelecimento, preposição, atos constitutivos; "procuracao": procurações (opcional). */
export type RepresentationKind = "representacao" | "procuracao";

/** Só documentos destes tipos são cortados: nunca petições, decisões, certidões do cartório, mandados... */
const CUTTABLE: DocType[] = ["procuracao", "contrato", "pessoal", "comprovante", "outro"];

const REPRESENTATION = new RegExp(
  [
    "substabelec",
    "preposicao",
    "\\bpreposto",
    "contrato social",
    "(alteracao|consolidacao)\\w* (do |de |da )?(contrato|contratual)",
    "estatuto social",
    "^estatuto\\b",
    "atos? constitutiv",
    "ata (da |de |do )?(assembl|eleic|reuniao|posse)",
    "cartao (do )?cnpj",
    "comprovante de inscricao e de situacao cadastral",
    "ficha cadastral",
    "requerimento de empresario",
    "instrumento de constituicao",
    "documentos? de representacao",
    "representacao (processual|legal)",
  ].join("|"),
);

/** Certidões e atas só são de representação nestes casos (as do cartório e as de audiência ficam sempre). */
const ONLY_IF: Partial<Record<DocType, RegExp>> = {
  certidao: /certidao simplificada|junta comercial/,
  ata: /ata (da |de |do )?(assembl|eleic|reuniao|posse)/,
};

// códigos do eproc, no nome ou na referência do documento ("Evento 12, SUBST1", "CARTAPREP1", "CONTRSOCIAL1")
const REPRESENTATION_CODE = /^(SUBS|CARTA?PREP|PREPOS|CONT(R(ATO)?)?SOC|ESTAT|ATOS?CONST|ATA(ASS|ELE|REU)|(CARTAO)?CNPJ)/;

function codesOf(...texts: (string | undefined)[]): string[] {
  return texts.flatMap((t) => [...(t || "").matchAll(/\b([A-Za-z]{2,30})\d{1,3}\b/g)].map((m) => m[1].toUpperCase()));
}

/** O documento é de representação ou uma procuração? (pelo nome, pelo tipo dado pelo sistema e pelo código do eproc) */
export function representationOf(d: { title: string; type: DocType; courtId?: string; label?: string }): RepresentationKind | undefined {
  const f = fold(`${d.title} ${d.label || ""}`).replace(/\s+/g, " ").trim();
  const only = ONLY_IF[d.type];
  if (only) return only.test(f) ? "representacao" : undefined;
  if (!CUTTABLE.includes(d.type)) return undefined;
  const codes = codesOf(d.title, d.courtId);
  if (REPRESENTATION.test(f) || ONLY_IF.certidao!.test(f) || codes.some((c) => REPRESENTATION_CODE.test(c))) return "representacao";
  if (d.type === "procuracao" || /procuracao|instrumento de mandato/.test(f) || codes.includes("PROC")) return "procuracao";
  return undefined;
}

/* ---------- corte de páginas ---------- */

/** Páginas a cortar: as dos documentos que saem, menos as que um documento que fica também usa. */
export function pagesToCut(total: number, out: [number, number][], keep: [number, number][]): Set<number> {
  const cut = new Set<number>();
  for (const [a, b] of out) for (let p = Math.max(1, a); p <= Math.min(total, b); p++) cut.add(p);
  for (const [a, b] of keep) for (let p = a; p <= b; p++) cut.delete(p);
  return cut;
}

/** Nova numeração depois do corte: map[página antiga] = página nova, ou 0 se foi cortada (map[0] não é usado). */
export function pageMap(total: number, cut: Set<number>): number[] {
  const map = new Array<number>(total + 1).fill(0);
  let n = 0;
  for (let p = 1; p <= total; p++) if (!cut.has(p)) map[p] = ++n;
  return map;
}

/** Primeira e última página que ficaram de um intervalo (vazio se todas foram cortadas). */
export function remapRange(r: [number, number], map: number[]): [number, number] | undefined {
  let a = 0;
  let b = 0;
  for (let p = r[0]; p <= r[1] && p < map.length; p++)
    if (map[p]) {
      if (!a) a = map[p];
      b = map[p];
    }
  return a ? [a, b] : undefined;
}
