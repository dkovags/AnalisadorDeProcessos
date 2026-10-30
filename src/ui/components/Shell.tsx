import { CalendarClock, ChevronLeft, Ellipsis, FolderOpen, LayoutDashboard, Library, Search, Settings, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { APP_NAME } from "../../config";
import { agenda } from "../../domain/select";
import { useData, useIsMobile, useToday } from "../context";
import { href, navigate, useRoute, type Route } from "../router";
import { Logo } from "./basics";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  match: Route["name"][];
  badge?: number;
}

function useNav(): NavItem[] {
  const ds = useData();
  const today = useToday();
  const urgent = agenda(ds, today).filter((i) => i.urgency === "vencido" || i.urgency === "hoje" || i.internalUrgency === "vencido" || i.internalUrgency === "hoje").length;
  return [
    { to: "/", label: "Painel", icon: <LayoutDashboard size={19} />, match: ["painel"] },
    { to: "/processos", label: "Processos", icon: <FolderOpen size={19} />, match: ["processos", "processo"] },
    { to: "/prazos", label: "Prazos e audiências", icon: <CalendarClock size={19} />, match: ["prazos"], badge: urgent },
    { to: "/pesquisa", label: "Pesquisa nos autos", icon: <Search size={19} />, match: ["pesquisa"] },
    { to: "/jurisprudencia", label: "Jurisprudência", icon: <Library size={19} />, match: ["jurisprudencia", "decisao"] },
    { to: "/citacoes", label: "Verificar citações", icon: <ShieldCheck size={19} />, match: ["citacoes"] },
  ];
}

function SideNav({ route }: { route: Route }) {
  const items = useNav();
  return (
    <aside className="sidenav">
      <a className="brand" href={href("/")}>
        <Logo size={30} />
        <span>{APP_NAME}</span>
      </a>
      <nav aria-label="Navegação">
        {items.map((i) => (
          <a key={i.to} href={href(i.to)} className={`nav-link ${i.match.includes(route.name) ? "active" : ""}`}>
            {i.icon}
            <span>{i.label}</span>
            {!!i.badge && <span className="nav-badge" title="Prazos vencidos ou que vencem hoje">{i.badge}</span>}
          </a>
        ))}
      </nav>
      <a href={href("/configuracoes")} className={`nav-link nav-bottom ${route.name === "configuracoes" ? "active" : ""}`}>
        <Settings size={19} />
        <span>Configurações</span>
      </a>
    </aside>
  );
}

function TopBar({ route }: { route: Route }) {
  const ds = useData();
  const root = ["painel", "processos", "prazos", "pesquisa", "mais"].includes(route.name);
  let title = APP_NAME;
  if (route.name === "processo") title = ds.cases[route.id]?.title || ds.cases[route.id]?.number || "Processo";
  else if (route.name === "decisao") title = "Jurisprudência";
  else if (route.name === "jurisprudencia") title = "Jurisprudência";
  else if (route.name === "citacoes") title = "Verificar citações";
  else if (route.name === "configuracoes") title = "Configurações";
  return (
    <header className="topbar">
      {root ? (
        <a className="brand" href={href("/")}>
          <Logo size={26} />
          <span>{APP_NAME}</span>
        </a>
      ) : (
        <button className="back-btn" onClick={() => (history.length > 1 ? history.back() : navigate("/"))} aria-label="Voltar">
          <ChevronLeft size={24} />
          <span className="topbar-title">{title}</span>
        </button>
      )}
      <a className="icon-btn light" href={href("/pesquisa")} aria-label="Pesquisar nos autos">
        <Search size={20} />
      </a>
    </header>
  );
}

function TabBar({ route }: { route: Route }) {
  const items = useNav();
  const tabs = [
    { ...items[0], label: "Painel" },
    { ...items[1], label: "Processos" },
    { ...items[2], label: "Prazos" },
    { ...items[4], label: "Jurisprud." },
    { to: "/mais", label: "Mais", icon: <Ellipsis size={19} />, match: ["mais", "pesquisa", "citacoes", "configuracoes"] as Route["name"][] },
  ];
  return (
    <nav className="tabbar" aria-label="Abas">
      {tabs.map((t) => (
        <a key={t.to} href={href(t.to)} className={`tab ${t.match.includes(route.name) ? "active" : ""}`}>
          <span className="tab-icon">
            {t.icon}
            {!!("badge" in t && t.badge) && <span className="tab-badge">{t.badge}</span>}
          </span>
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const mobile = useIsMobile();
  return (
    <div className="app">
      {mobile ? <TopBar route={route} /> : <SideNav route={route} />}
      <main className="main">{children}</main>
      {mobile && <TabBar route={route} />}
    </div>
  );
}

/** Cabeçalho da página: título, subtítulo e botões. */
export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-title">
        {icon}
        <div>
          <h1>{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
