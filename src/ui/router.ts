import { useSyncExternalStore } from "react";

export type CaseTab = "resumo" | "prazos" | "documentos" | "andamentos" | "jurisprudencia";

export type Route =
  | { name: "painel" }
  | { name: "processos"; q?: string; status?: string }
  | { name: "processo"; id: string; tab: CaseTab; q?: string }
  | { name: "prazos" }
  | { name: "pesquisa"; q?: string }
  | { name: "jurisprudencia"; q?: string }
  | { name: "decisao"; id: string }
  | { name: "citacoes" }
  | { name: "configuracoes" }
  | { name: "mais" };

const TABS: CaseTab[] = ["resumo", "prazos", "documentos", "andamentos", "jurisprudencia"];

export function parseRoute(hash: string): Route {
  const [path, query] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query || "");
  const q = params.get("q") || undefined;
  switch (parts[0]) {
    case "processos":
      if (parts[1]) {
        const tab = TABS.includes(parts[2] as CaseTab) ? (parts[2] as CaseTab) : "resumo";
        return { name: "processo", id: parts[1], tab, q };
      }
      return { name: "processos", q, status: params.get("situacao") || undefined };
    case "prazos":
      return { name: "prazos" };
    case "pesquisa":
      return { name: "pesquisa", q };
    case "jurisprudencia":
      return parts[1] ? { name: "decisao", id: parts[1] } : { name: "jurisprudencia", q };
    case "citacoes":
      return { name: "citacoes" };
    case "configuracoes":
      return { name: "configuracoes" };
    case "mais":
      return { name: "mais" };
    default:
      return { name: "painel" };
  }
}

export function casePath(id: string, tab: CaseTab = "resumo", q?: string): string {
  return `/processos/${encodeURIComponent(id)}${tab !== "resumo" ? `/${tab}` : ""}${q ? `?q=${encodeURIComponent(q)}` : ""}`;
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  const target = "#" + path;
  if (window.location.hash === target) return;
  if (opts.replace) window.location.replace(target);
  else window.location.hash = path;
}

export const href = (path: string) => "#" + path;
