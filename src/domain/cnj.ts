// Numeração única dos processos (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO

export interface Cnj {
  seq: string;
  dv: string;
  year: string;
  j: string;
  tr: string;
  origin: string;
}

/** Encontra números no formato CNJ, com ou sem pontuação (20 dígitos). */
export const CNJ_RE = /(?<![\d.-])(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})(?![\d-])/g;

export function parseCnj(s: string): Cnj | null {
  const m = s.trim().match(/^(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})$/);
  if (!m) return null;
  return { seq: m[1], dv: m[2], year: m[3], j: m[4], tr: m[5], origin: m[6] };
}

export function formatCnj(c: Cnj): string {
  return `${c.seq}-${c.dv}.${c.year}.${c.j}.${c.tr}.${c.origin}`;
}

/** Dígito verificador (ISO 7064, módulo 97 base 10, como no anexo VIII da Resolução 65/2008). */
export function cnjCheckDigits(c: Omit<Cnj, "dv">): string {
  const n = BigInt(c.seq + c.year + c.j + c.tr + c.origin + "00");
  return String(98n - (n % 97n)).padStart(2, "0");
}

export function isValidCnj(s: string): boolean {
  const c = parseCnj(s);
  return !!c && cnjCheckDigits(c) === c.dv;
}

/** Formata se for um número CNJ (válido ou não); senão devolve o texto como veio. */
export function normalizeCaseNumber(s: string): string {
  const c = parseCnj(s.replace(/\s/g, ""));
  return c ? formatCnj(c) : s.trim();
}

/** Só os dígitos, para comparar números escritos de jeitos diferentes. */
export function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

// Tribunais estaduais e regionais eleitorais seguem a ordem alfabética dos estados (código TR).
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO"];

/** Sigla do tribunal a partir dos campos J e TR: 8.26 → TJSP, 4.03 → TRF3, 5.02 → TRT2. */
export function courtOfCnj(c: Pick<Cnj, "j" | "tr">): string | undefined {
  const tr = Number(c.tr);
  switch (c.j) {
    case "1":
      return "STF";
    case "2":
      return "CNJ";
    case "3":
      return "STJ";
    case "4":
      return tr >= 1 && tr <= 6 ? `TRF${tr}` : tr === 90 ? "CJF" : undefined;
    case "5":
      return tr === 0 ? "TST" : tr >= 1 && tr <= 24 ? `TRT${tr}` : tr === 90 ? "CSJT" : undefined;
    case "6":
      return tr === 0 ? "TSE" : UFS[tr - 1] ? `TRE-${UFS[tr - 1]}` : undefined;
    case "7":
      return tr === 0 ? "STM" : "JMU";
    case "8":
      return UFS[tr - 1] ? (UFS[tr - 1] === "DF" ? "TJDFT" : `TJ${UFS[tr - 1]}`) : undefined;
    case "9":
      return { 13: "TJMMG", 21: "TJMRS", 26: "TJMSP" }[tr];
  }
  return undefined;
}

/** UF de um tribunal estadual ou regional ("TJSP" → "SP", "TRE-RN" → "RN"). */
export function ufOfCourt(court: string): string | undefined {
  const m = court.toUpperCase().match(/^(?:TJ|TRE-|TJM)([A-Z]{2})$/);
  if (m && UFS.includes(m[1])) return m[1];
  return court.toUpperCase() === "TJDFT" ? "DF" : undefined;
}

export interface CnjCheck {
  valid: boolean;
  formatted: string;
  court?: string;
  message?: string;
}

/** Confere um número de processo: formato, dígito verificador e tribunal. */
export function checkCaseNumber(s: string): CnjCheck | null {
  const c = parseCnj(s.replace(/\s/g, ""));
  if (!c) return null;
  const formatted = formatCnj(c);
  const court = courtOfCnj(c);
  const expected = cnjCheckDigits(c);
  if (expected !== c.dv)
    return { valid: false, formatted, court, message: `Dígito verificador não confere (deveria ser ${expected}): confira o número.` };
  const year = Number(c.year);
  if (year < 1900 || year > new Date().getFullYear() + 1)
    return { valid: false, formatted, court, message: `Ano ${c.year} fora do esperado.` };
  return { valid: true, formatted, court };
}
