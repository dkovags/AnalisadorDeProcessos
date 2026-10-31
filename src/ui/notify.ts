import { agenda, caseLabel } from "../domain/select";
import type { Dataset } from "../domain/types";

// Avisos do navegador sobre os prazos do dia (quando o app está aberto) e o número no ícone do app instalado.

export function notifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotify(): Promise<boolean> {
  if (!notifySupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function shown(key: string): boolean {
  try {
    if (localStorage.getItem(key)) return true;
    localStorage.setItem(key, "1");
  } catch {
    // sem armazenamento: avisa de novo
  }
  return false;
}

/** Avisa uma vez por dia de cada prazo vencido, de hoje ou com prazo interno vencendo. */
export function notifyDeadlines(ds: Dataset, today: string) {
  const items = agenda(ds, today).filter(
    (i) => i.urgency === "vencido" || i.urgency === "hoje" || i.urgency === "amanha" || (i.kind === "task" && (i.internalUrgency === "hoje" || i.internalUrgency === "vencido")),
  );
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  const urgent = items.filter((i) => i.urgency === "vencido" || i.urgency === "hoje").length;
  if (urgent) nav.setAppBadge?.(urgent).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
  if (!ds.prefs.notify || !notifySupported() || Notification.permission !== "granted") return;
  for (const i of items.slice(0, 5)) {
    if (shown(`autos:aviso:${today}:${i.key}`)) continue;
    const c = ds.cases[i.caseId];
    const when = i.urgency === "vencido" ? "venceu" : i.urgency === "hoje" ? "vence hoje" : i.urgency === "amanha" ? "vence amanhã" : "prazo interno hoje";
    try {
      new Notification(`${i.title}: ${when}`, { body: `${caseLabel(c)} · ${c.number}`, tag: i.key, icon: "./icon-192.png" });
    } catch {
      // alguns celulares só permitem avisos pelo service worker
    }
  }
}

/** Aviso avulso do navegador (ex.: intimações novas encontradas no DJEN), se a pessoa ligou os avisos. */
export function notifyNews(ds: Dataset, title: string, body: string, tag: string) {
  if (!ds.prefs.notify || !notifySupported() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag, icon: "./icon-192.png" });
  } catch {
    // alguns celulares só permitem avisos pelo service worker
  }
}
