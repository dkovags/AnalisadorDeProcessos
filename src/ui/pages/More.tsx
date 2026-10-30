import { Calculator, ChevronRight, Library, Search, Settings, ShieldCheck } from "lucide-react";
import { APP_NAME } from "../../config";
import { PageHeader } from "../components/Shell";
import { useUI } from "../context";
import { href } from "../router";

/** Menu do celular com o que não cabe nas abas. */
export function MorePage() {
  const ui = useUI();
  const items = [
    { to: "/pesquisa", icon: <Search size={20} />, label: "Pesquisa nos autos", text: "Em todos os documentos e na jurisprudência" },
    { to: "/jurisprudencia", icon: <Library size={20} />, label: "Jurisprudência", text: "Decisões, súmulas e temas, com as partes" },
    { to: "/citacoes", icon: <ShieldCheck size={20} />, label: "Verificar citações", text: "Confere as citações de uma petição" },
    { to: "/configuracoes", icon: <Settings size={20} />, label: "Configurações", text: "Feriados, prazo interno, cópia de segurança" },
  ];
  return (
    <div className="page">
      <PageHeader title={APP_NAME} />
      <div className="menu-list">
        {items.map((i) => (
          <a key={i.to} className="menu-item" href={href(i.to)}>
            {i.icon}
            <div>
              <strong>{i.label}</strong>
              <span className="muted small">{i.text}</span>
            </div>
            <ChevronRight size={18} />
          </a>
        ))}
        <button className="menu-item" onClick={() => ui.open({ type: "calculator" })}>
          <Calculator size={20} />
          <div>
            <strong>Calculadora de prazos</strong>
            <span className="muted small">Vencimento com feriados e recesso, sem cadastrar</span>
          </div>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
