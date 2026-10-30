import { FileSpreadsheet, FileUp, FolderOpen, FolderPlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { digitsOf } from "../../domain/cnj";
import { casesToCsv } from "../../domain/exports";
import { STATUS, STATUS_ORDER } from "../../domain/labels";
import { caseLabel, clientOf, nextDueByCase } from "../../domain/select";
import { fold } from "../../domain/text";
import type { Case } from "../../domain/types";
import { DueBadge, Empty, StatusChip } from "../components/basics";
import { PageHeader } from "../components/Shell";
import { useData, useToday, useUI } from "../context";
import { downloadFile } from "../download";
import { casePath, href, navigate } from "../router";

type Sort = "prazo" | "nome" | "numero" | "recentes";

function matches(c: Case, q: string): boolean {
  const f = fold(q).trim();
  if (!f) return true;
  const d = digitsOf(q);
  if (d.length >= 4 && digitsOf(c.number).includes(d)) return true;
  const hay = fold([c.number, c.title, c.court, c.body, c.className, c.subjects, c.notes, ...c.parties.map((p) => `${p.name} ${p.lawyers || ""}`)].join(" "));
  return f.split(/\s+/).every((w) => hay.includes(w));
}

export function CasesPage({ q: initialQ, status: initialStatus }: { q?: string; status?: string }) {
  const ds = useData();
  const ui = useUI();
  const today = useToday();
  const [q, setQ] = useState(initialQ || "");
  const [status, setStatus] = useState(initialStatus || "ativos");
  const [sort, setSort] = useState<Sort>("prazo");
  const next = useMemo(() => nextDueByCase(ds, today), [ds, today]);

  const all = Object.values(ds.cases);
  const list = all
    .filter((c) => (status === "todos" ? true : status === "ativos" ? STATUS[c.status].active : status === "inativos" ? !STATUS[c.status].active : c.status === status))
    .filter((c) => matches(c, q))
    .sort((a, b) => {
      if (sort === "nome") return caseLabel(a).localeCompare(caseLabel(b), "pt-BR");
      if (sort === "numero") return a.number.localeCompare(b.number);
      if (sort === "recentes") return b.updatedAt.localeCompare(a.updatedAt);
      const da = next.get(a.id)?.due || "9999";
      const db = next.get(b.id)?.due || "9999";
      return da.localeCompare(db) || caseLabel(a).localeCompare(caseLabel(b), "pt-BR");
    });

  return (
    <div className="page">
      <PageHeader
        title="Processos"
        subtitle={`${all.length} ${all.length === 1 ? "processo cadastrado" : "processos cadastrados"}`}
        actions={
          <>
            {all.length > 0 && (
              <button className="btn btn-ghost" onClick={() => downloadFile(`processos-${today}.csv`, casesToCsv(ds, today), "text/csv;charset=utf-8")} title="Planilha para o Excel">
                <FileSpreadsheet size={17} /> <span className="hide-sm">Planilha</span>
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => ui.open({ type: "import", mode: "processo" })}>
              <FileUp size={17} /> <span className="hide-sm">Importar PDF do processo</span>
            </button>
            <button className="btn btn-primary" onClick={() => ui.open({ type: "case" })}>
              <FolderPlus size={17} /> Novo processo
            </button>
          </>
        }
      />
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, parte, cliente, vara, assunto…" aria-label="Filtrar processos" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="ativos">Ativos</option>
          <option value="inativos">Arquivados e encerrados</option>
          <option value="todos">Todos</option>
          <optgroup label="Situação">
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </optgroup>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordem">
          <option value="prazo">Próximo prazo</option>
          <option value="nome">Nome</option>
          <option value="numero">Número</option>
          <option value="recentes">Alterados recentemente</option>
        </select>
      </div>
      {!list.length ? (
        <Empty
          icon={<FolderOpen size={30} />}
          title={all.length ? "Nenhum processo encontrado" : "Nenhum processo cadastrado"}
          action={
            !all.length && (
              <button className="btn btn-primary" onClick={() => ui.open({ type: "import", mode: "processo" })}>
                Importar o PDF do processo
              </button>
            )
          }
        >
          {all.length ? "Mude o filtro ou a situação." : "Importe o PDF do processo baixado do sistema do tribunal ou cadastre os dados à mão."}
        </Empty>
      ) : (
        <div className="case-list">
          {list.map((c) => {
            const n = next.get(c.id);
            const client = clientOf(c);
            return (
              <a key={c.id} className="case-row" href={href(casePath(c.id))} onClick={(e) => (e.preventDefault(), navigate(casePath(c.id)))}>
                <div className="case-row-main">
                  <div className="case-row-title">{caseLabel(c)}</div>
                  <div className="case-row-number">
                    {c.number}
                    {c.court && <span className="muted"> · {c.court}</span>}
                  </div>
                  <div className="case-row-meta">
                    {c.body && <span>{c.body}</span>}
                    {client && <span>Cliente: {client.name}</span>}
                  </div>
                </div>
                <div className="case-row-side">
                  <StatusChip status={c.status} />
                  {n && (
                    <span className="case-row-next" title={n.title}>
                      <DueBadge due={n.due} today={today} urgency={n.urgency} label={n.title.length > 24 ? n.title.slice(0, 22) + "…" : n.title} />
                    </span>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
