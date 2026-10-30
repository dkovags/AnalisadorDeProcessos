import { BellRing, CalendarClock, FileUp, FolderOpen, FolderPlus, Gavel, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { formatDateLong } from "../../domain/dates";
import { STATUS, STATUS_ORDER } from "../../domain/labels";
import { loadExample } from "../../store/example";
import { AgendaList, useAgenda } from "../components/Agenda";
import { Empty, Logo } from "../components/basics";
import { PageHeader } from "../components/Shell";
import { useData, useStore, useToday, useUI } from "../context";
import { casePath, href, navigate } from "../router";
import { APP_NAME } from "../../config";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function Welcome() {
  const ui = useUI();
  const store = useStore();
  const today = useToday();
  const [busy, setBusy] = useState(false);
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <Logo size={56} />
        <div>
          <h2>Boas-vindas ao {APP_NAME}</h2>
          <p>
            Controle dos seus processos: situação, expedientes e prazos de cada parte, petições a protocolar com os documentos para
            instruí-las, a base de conhecimento com os autos e a jurisprudência, com verificação das citações.
          </p>
          <p className="muted">Tudo fica guardado só neste aparelho. Faça cópias de segurança em Configurações.</p>
        </div>
      </div>
      <div className="welcome-actions">
        <button className="welcome-card" onClick={() => ui.open({ type: "import", mode: "processo" })}>
          <FileUp size={26} />
          <strong>Importar o PDF do processo</strong>
          <span>Baixe o processo inteiro no PJe, no eproc ou no e-SAJ: o {APP_NAME} lê a capa, as partes e separa os documentos.</span>
        </button>
        <button className="welcome-card" onClick={() => ui.open({ type: "case" })}>
          <FolderPlus size={26} />
          <strong>Cadastrar um processo</strong>
          <span>Digite o número, as partes e a situação.</span>
        </button>
        <button
          className="welcome-card"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const id = await loadExample(store, today);
              ui.toast("Exemplo carregado. Os processos de exemplo são fictícios e podem ser apagados.");
              navigate(casePath(id));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Sparkles size={26} />
          <strong>{busy ? "Carregando…" : "Ver um exemplo"}</strong>
          <span>Dois processos fictícios, com prazos, documentos e súmulas, para conhecer as telas.</span>
        </button>
      </div>
    </div>
  );
}

export function Dashboard() {
  const ds = useData();
  const ui = useUI();
  const today = useToday();
  const items = useAgenda();
  const cases = Object.values(ds.cases);
  const name = ds.prefs.name?.split(" ")[0];

  const overdue = items.filter((i) => i.urgency === "vencido");
  const todayItems = items.filter((i) => i.urgency === "hoje");
  const week = items.filter((i) => i.urgency === "amanha" || i.urgency === "semana");
  const hearings = items.filter((i) => i.kind === "hearing" && i.due && i.due >= today);
  const petitions = items.filter((i) => i.petition && i.kind !== "hearing" && i.urgency !== "futuro" && i.urgency !== "sem");
  const missing = petitions.filter((i) => i.missingDocs > 0);
  const active = cases.filter((c) => STATUS[c.status].active).length;
  // vencidos e os próximos, mesmo que além de 7 dias
  const near = items.filter((i) => i.kind !== "hearing" && i.due).slice(0, 8);
  const counts = STATUS_ORDER.map((s) => ({ s, n: cases.filter((c) => c.status === s).length })).filter((x) => x.n);
  const max = Math.max(1, ...counts.map((x) => x.n));

  return (
    <div className="page">
      <PageHeader
        title={`${greeting()}${name ? `, ${name}` : ""}`}
        subtitle={formatDateLong(today)}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => ui.open({ type: "import" })}>
              <FileUp size={17} /> Enviar arquivo
            </button>
            <button className="btn btn-primary" onClick={() => ui.open({ type: "case" })}>
              <FolderPlus size={17} /> Novo processo
            </button>
          </>
        }
      />
      {!cases.length ? (
        <Welcome />
      ) : (
        <>
          <div className="stats">
            <a className={`stat ${overdue.length + todayItems.length ? "tone-danger" : ""}`} href={href("/prazos")}>
              <span className="stat-n">{overdue.length + todayItems.length}</span>
              <span className="stat-l">vencidos ou para hoje</span>
            </a>
            <a className={`stat ${week.length ? "tone-warn" : ""}`} href={href("/prazos")}>
              <span className="stat-n">{week.length}</span>
              <span className="stat-l">nos próximos 7 dias</span>
            </a>
            <a className="stat" href={href("/prazos")}>
              <span className="stat-n">{hearings.length}</span>
              <span className="stat-l">{hearings.length === 1 ? "audiência marcada" : "audiências marcadas"}</span>
            </a>
            <a className="stat" href={href("/processos")}>
              <span className="stat-n">{active}</span>
              <span className="stat-l">{active === 1 ? "processo ativo" : "processos ativos"}</span>
            </a>
          </div>

          {petitions.length > 0 && (
            <div className={`banner ${missing.length || overdue.length ? "warn" : "info"}`}>
              <BellRing size={20} />
              <div>
                <strong>
                  {petitions.length === 1 ? "1 petição precisa" : `${petitions.length} petições precisam`} ser protocolada{petitions.length === 1 ? "" : "s"} nos
                  próximos 7 dias.
                </strong>{" "}
                {missing.length > 0 && (
                  <>
                    {missing.length === 1 ? "Uma ainda não tem" : `${missing.length} ainda não têm`} todos os documentos para instruir:{" "}
                    {missing
                      .slice(0, 3)
                      .map((i) => i.title)
                      .join(", ")}
                    {missing.length > 3 ? "…" : "."}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="dash-grid">
            <section className="card">
              <div className="card-head">
                <h2>
                  <CalendarClock size={18} /> Próximos prazos
                </h2>
                <a className="link" href={href("/prazos")}>
                  Ver todos
                </a>
              </div>
              <AgendaList
                items={near}
                empty={
                  <Empty icon={<CalendarClock size={28} />} title="Nenhum prazo em aberto">
                    Cadastre os expedientes de cada processo para o {APP_NAME} calcular os prazos.
                  </Empty>
                }
              />
            </section>
            <div className="dash-side">
              <section className="card">
                <div className="card-head">
                  <h2>
                    <Gavel size={18} /> Audiências e sessões
                  </h2>
                </div>
                {hearings.length ? (
                  <AgendaList items={hearings.slice(0, 5)} />
                ) : (
                  <p className="muted pad">Nenhuma audiência marcada.</p>
                )}
              </section>
              <section className="card">
                <div className="card-head">
                  <h2>
                    <FolderOpen size={18} /> Processos por situação
                  </h2>
                </div>
                <div className="bars">
                  {counts.map(({ s, n }) => (
                    <a key={s} className="bar-row" href={href(`/processos?situacao=${s}`)}>
                      <span className="bar-label">{STATUS[s].label}</span>
                      <span className="bar-track">
                        <span className={`bar-fill tone-${STATUS[s].tone}`} style={{ width: `${(n / max) * 100}%` }} />
                      </span>
                      <span className="bar-n">{n}</span>
                    </a>
                  ))}
                </div>
              </section>
              {overdue.length > 0 && (
                <div className="banner danger small">
                  <TriangleAlert size={18} />
                  <span>
                    {overdue.length === 1 ? "Há 1 prazo vencido" : `Há ${overdue.length} prazos vencidos`}. Se a petição já foi protocolada, marque como
                    protocolada para tirar da lista.
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
