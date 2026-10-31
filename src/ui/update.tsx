import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_NAME } from "../config";

// Versões novas do aplicativo. Cada publicação troca os arquivos do site (os nomes mudam), e uma aba aberta antes
// dela pode pedir um pedaço que não existe mais, como o leitor de PDF. O app percebe isso e se recarrega, e avisa
// quando há uma versão nova enquanto ele está aberto.

const GUARD = "autos:recarga";
const NOTICE = "autos:atualizado";

/** O erro é de um pedaço do aplicativo que sumiu do site (versão nova publicada)? */
export function isStaleChunk(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return /dynamically imported module|importing a module script failed|error loading dynamically imported|unable to preload css/i.test(msg);
}

let reloading = false;

/** Já pediu para recarregar (os erros que vierem até a página sair não precisam de aviso). */
export function isReloading(): boolean {
  return reloading;
}

/** Recarrega para pegar a versão nova; no máximo uma vez por minuto, para não entrar em laço se o site estiver fora do ar. */
export function reloadForUpdate(): boolean {
  if (reloading) return true;
  try {
    if (Date.now() - Number(sessionStorage.getItem(GUARD) || 0) < 60_000) return false;
    sessionStorage.setItem(GUARD, String(Date.now()));
    sessionStorage.setItem(NOTICE, "1");
  } catch {
    // sem armazenamento da sessão: recarrega mesmo assim
  }
  reloading = true;
  location.reload();
  return true;
}

/** Recarregou por causa da versão nova? (responde uma vez só, para o aviso aparecer uma vez) */
export function takeUpdateNotice(): boolean {
  try {
    const was = sessionStorage.getItem(NOTICE) === "1";
    sessionStorage.removeItem(NOTICE);
    return was;
  } catch {
    return false;
  }
}

/** Há uma versão publicada mais nova que a aberta? Confere ao abrir, ao voltar para a aba e de meia em meia hora. */
export function useNewVersion(): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (alive && build && build !== __BUILD_ID__) setFresh(true);
      } catch {
        // sem internet: confere de novo depois
      }
    };
    void check();
    const timer = setInterval(check, 30 * 60_000);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return fresh;
}

/** Faixa no alto da página quando sai uma versão nova. */
export function UpdateBar() {
  const fresh = useNewVersion();
  if (!fresh) return null;
  return (
    <div className="update-bar" role="status">
      <RefreshCw size={16} />
      <span>Há uma versão nova do {APP_NAME}.</span>
      <button className="btn btn-primary btn-sm" onClick={() => location.reload()}>
        Atualizar agora
      </button>
    </div>
  );
}
