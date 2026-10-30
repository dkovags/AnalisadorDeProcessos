import { BadgeCheck, Link2, Unlink } from "lucide-react";
import { useState } from "react";
import { formatDate } from "../../domain/dates";
import { BINDINGS, STANDINGS } from "../../domain/labels";
import { citationBlock, formatCitation } from "../../domain/precedents";
import { excerpt } from "../../domain/text";
import type { CitationStyle, Precedent } from "../../domain/types";
import { useData } from "../context";
import { href } from "../router";
import { CopyButton } from "./basics";

export const STYLE_LABEL: Record<CitationStyle, string> = { forense: "Forense", stj: "Padrão do STJ", abnt: "ABNT" };

/** Botões para copiar a referência (e a ementa como citação direta). */
export function CiteButtons({ p }: { p: Precedent }) {
  const ds = useData();
  const style = ds.prefs.citationStyle;
  const ref = citationBlock(p, style, false);
  const withSummary = citationBlock(p, style, true);
  return (
    <div className="cite-buttons">
      <CopyButton text={ref.text} html={ref.html} label="Copiar referência" />
      {p.summary && <CopyButton text={withSummary.text} html={withSummary.html} label="Copiar com a ementa" />}
    </div>
  );
}

export function PrecedentCard({ p, action }: { p: Precedent; action?: { linked: boolean; onToggle: () => void } }) {
  const ds = useData();
  const [full, setFull] = useState(false);
  return (
    <article className="item-card precedent">
      <header className="item-head">
        <a className="item-title link" href={href(`/jurisprudencia/${p.id}`)}>
          <strong>
            {p.court} · {p.className} {p.number}
            {p.uf ? `/${p.uf}` : ""}
          </strong>
        </a>
        <div className="chips">
          {p.binding && <span className="chip tone-info">{BINDINGS[p.binding]}{p.bindingNumber ? ` ${p.bindingNumber}` : ""}</span>}
          {p.standing !== "vigente" && <span className="chip tone-danger">{STANDINGS[p.standing]}</span>}
          {p.checkedAt ? (
            <span className="chip tone-ok" title={`Conferido na fonte oficial em ${formatDate(p.checkedAt)}`}>
              <BadgeCheck size={12} /> conferida
            </span>
          ) : (
            <span className="chip tone-warn">não conferida</span>
          )}
        </div>
      </header>
      <div className="item-sub">{formatCitation(p, ds.prefs.citationStyle)}</div>
      {p.parties.length > 0 && (
        <div className="item-sub muted">
          {p.parties
            .filter((x) => x.pole !== "terceiro")
            .map((x) => `${x.role}: ${x.name}`)
            .join(" · ")}
        </div>
      )}
      {p.thesis && (
        <p className="thesis">
          <strong>Tese:</strong> {p.thesis}
        </p>
      )}
      {p.summary && (
        <div className="item-content">
          <p className="summary">{full ? p.summary : excerpt(p.summary, 320)}</p>
          {p.summary.length > 320 && (
            <button className="link-btn small" onClick={() => setFull(!full)}>
              {full ? "Mostrar menos" : "Ementa completa"}
            </button>
          )}
        </div>
      )}
      <footer className="item-actions">
        <CiteButtons p={p} />
        {action && (
          <button className="btn btn-ghost btn-sm" onClick={action.onToggle}>
            {action.linked ? <Unlink size={14} /> : <Link2 size={14} />} {action.linked ? "Desvincular" : "Vincular ao processo"}
          </button>
        )}
      </footer>
    </article>
  );
}
