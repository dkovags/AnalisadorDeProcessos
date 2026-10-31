import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "@fontsource/lato/900.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { reloadForUpdate } from "./ui/update";

// versão nova publicada com a aba aberta: um pedaço do app (como o leitor de PDF) sumiu do site; recarrega para pegar a nova
window.addEventListener("vite:preloadError", (e) => {
  if (reloadForUpdate()) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Funciona sem internet e pode ser instalado como aplicativo (só na versão publicada)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
