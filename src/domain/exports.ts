import { APP_NAME } from "../config";
import { addDays, formatDate } from "./dates";
import { STATUS } from "./labels";
import { agenda, caseLabel, clientOf, nextDueByCase } from "./select";
import type { Dataset } from "./types";
import { formatMoney } from "./text";

// Exportações: agenda (.ics, para Google Agenda, Outlook ou o calendário do celular) e lista de processos (.csv).

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Quebra linhas com mais de 75 bytes (RFC 5545). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compact = (iso: string) => iso.replace(/-/g, "");

export function agendaToIcs(ds: Dataset, today: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${APP_NAME}//Prazos//PT-BR`, "CALSCALE:GREGORIAN", `X-WR-CALNAME:${APP_NAME} – prazos e audiências`];
  for (const item of agenda(ds, today)) {
    if (!item.due) continue;
    const c = ds.cases[item.caseId];
    const label = `${caseLabel(c)} (${c.number})`;
    const summary = item.kind === "hearing" ? `${item.title} – ${caseLabel(c)}` : `Prazo: ${item.title} – ${caseLabel(c)}`;
    const desc = [
      label,
      item.kind !== "hearing" && item.internal && item.internal !== item.due ? `Prazo interno: ${formatDate(item.internal)}` : "",
      item.provisional ? "Prazo calculado com a ciência ficta: confira a data da ciência." : "",
      item.totalDocs ? `Documentos para instruir: ${item.totalDocs - item.missingDocs} de ${item.totalDocs} prontos` : "",
    ].filter(Boolean);
    lines.push("BEGIN:VEVENT", `UID:${item.key.replace(":", "-")}@autos`, `DTSTAMP:${stamp}`);
    if (item.time) {
      const [h, m] = item.time.split(":");
      lines.push(`DTSTART:${compact(item.due)}T${h}${m}00`, `DURATION:PT1H`);
    } else lines.push(`DTSTART;VALUE=DATE:${compact(item.due)}`, `DTEND;VALUE=DATE:${compact(addDays(item.due, 1))}`);
    lines.push(`SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(desc.join("\n"))}`);
    if (item.place) lines.push(`LOCATION:${icsEscape(item.place)}`);
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(summary)}`, `TRIGGER:${item.time ? "-PT2H" : "-P1D"}`, "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

function cell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Planilha dos processos (separador ";" e vírgula decimal, que o Excel em português abre direto). */
export function casesToCsv(ds: Dataset, today: string): string {
  const next = nextDueByCase(ds, today);
  const header = ["Número", "Processo", "Cliente", "Tribunal", "Órgão julgador", "Classe", "Situação", "Próximo prazo", "Providência", "Distribuição", "Valor da causa"];
  const rows = Object.values(ds.cases)
    .sort((a, b) => caseLabel(a).localeCompare(caseLabel(b), "pt-BR"))
    .map((c) => {
      const n = next.get(c.id);
      return [
        c.number,
        caseLabel(c),
        clientOf(c)?.name || "",
        c.court || "",
        c.body || "",
        c.className || "",
        STATUS[c.status].label,
        n?.due ? formatDate(n.due) : "",
        n?.title || "",
        c.filedAt ? formatDate(c.filedAt) : "",
        c.value !== undefined ? formatMoney(c.value).replace("R$ ", "") : "",
      ];
    });
  return "\ufeff" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
