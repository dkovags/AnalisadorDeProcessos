import { Library, Plus, Search, Users } from "lucide-react";
import { useState } from "react";
import { sharedParties } from "../../../domain/precedents";
import { fold } from "../../../domain/text";
import type { Case } from "../../../domain/types";
import * as A from "../../../store/actions";
import { Empty } from "../../components/basics";
import { PrecedentCard } from "../../components/PrecedentCard";
import { useData, useRun, useUI } from "../../context";
import { href } from "../../router";

export function CasePrecedents({ c }: { c: Case }) {
  const ds = useData();
  const ui = useUI();
  const runAction = useRun();
  const [q, setQ] = useState("");
  const all = Object.values(ds.precedents);
  const linked = all.filter((p) => p.caseIds.includes(c.id));
  const toggle = (id: string, on: boolean) => runAction(A.linkPrecedent, id, c.id, on);
  const common = all.filter((p) => !p.caseIds.includes(c.id) && sharedParties(p, [c]).length);
  const f = fold(q).trim();
  const found = f
    ? all.filter((p) => !p.caseIds.includes(c.id) && fold([p.court, p.className, p.number, p.summary, p.thesis, ...(p.topics || []), ...p.parties.map((x) => x.name)].join(" ")).includes(f)).slice(0, 8)
    : [];
  return (
    <div className="tab-body">
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => ui.open({ type: "precedent", caseId: c.id })}>
          <Plus size={17} /> Nova jurisprudência
        </button>
        <div className="search-box">
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vincular da base: número, tema, parte, palavra da ementa" aria-label="Procurar na base de jurisprudência" />
        </div>
      </div>
      {found.length > 0 && (
        <section className="section">
          <h3 className="section-title">Na base</h3>
          {found.map((p) => (
            <PrecedentCard key={p.id} p={p} action={{ linked: false, onToggle: () => toggle(p.id, true) }} />
          ))}
        </section>
      )}
      {f && !found.length && <p className="muted pad">Nada na base com esses termos.</p>}
      <section className="section">
        <h3 className="section-title">Usada neste processo</h3>
        {linked.length ? (
          linked.map((p) => <PrecedentCard key={p.id} p={p} action={{ linked: true, onToggle: () => toggle(p.id, false) }} />)
        ) : (
          <Empty icon={<Library size={28} />} title="Nenhuma decisão vinculada">
            Vincule as decisões e súmulas usadas nas petições deste processo, para copiar a citação pronta e conferir as citações.{" "}
            <a className="link" href={href("/jurisprudencia")}>
              Abrir a base de jurisprudência
            </a>
          </Empty>
        )}
      </section>
      {common.length > 0 && (
        <section className="section">
          <h3 className="section-title">
            <Users size={16} /> Decisões com as mesmas partes
          </h3>
          <p className="muted small">Envolvem alguma parte deste processo. Úteis para conhecer o histórico da parte contrária.</p>
          {common.map((p) => (
            <PrecedentCard key={p.id} p={p} action={{ linked: false, onToggle: () => toggle(p.id, true) }} />
          ))}
        </section>
      )}
    </div>
  );
}
