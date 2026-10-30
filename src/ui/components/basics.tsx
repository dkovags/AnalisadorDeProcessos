import { Check, Copy, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { relativeDay } from "../../domain/dates";
import type { Urgency } from "../../domain/deadlines";
import { STATUS } from "../../domain/labels";
import type { Segment } from "../../domain/search";
import type { CaseStatus } from "../../domain/types";
import { useUI } from "../context";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="15" fill="var(--logo-bg)" />
      <path d="M20 14h17l9 9v27a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="#fff" />
      <path d="M37 14v9h9" fill="none" stroke="var(--logo-bg)" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="23" y="29" width="17" height="3" rx="1.5" fill="var(--logo-bg)" />
      <rect x="23" y="36" width="12" height="3" rx="1.5" fill="var(--logo-bg)" />
      <circle cx="40" cy="44" r="6" fill="var(--accent)" />
    </svg>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  className,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select");
    first?.focus({ preventScroll: true });
    document.body.classList.add("modal-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""} ${className || ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className || ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function StatusChip({ status }: { status: CaseStatus }) {
  const s = STATUS[status];
  return <span className={`chip tone-${s.tone}`}>{s.label}</span>;
}

const URGENCY_TONE: Record<Urgency, string> = { vencido: "danger", hoje: "danger", amanha: "warn", semana: "warn", futuro: "info", sem: "muted" };

/** "vence hoje", "vencido há 2 dias", "em 5 dias" */
export function DueBadge({ due, today, urgency, label }: { due?: string; today: string; urgency: Urgency; label?: string }) {
  if (!due) return <span className="badge tone-muted">{label || "sem vencimento"}</span>;
  const rel = relativeDay(due, today);
  const text = urgency === "vencido" ? `venceu ${rel}` : urgency === "hoje" ? "vence hoje" : rel;
  return <span className={`badge tone-${URGENCY_TONE[urgency]}`}>{label ? `${label}: ${text}` : text}</span>;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? (
          <mark key={i} className="hit">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab-btn ${value === t.id ? "active" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Copia texto (e, se houver, a versão formatada para colar no Word). */
export async function copyText(text: string, html?: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // navegadores antigos ou sem permissão: área de texto escondida
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, html, label = "Copiar", className }: { text: string; html?: string; label?: string; className?: string }) {
  const ui = useUI();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className || "btn btn-ghost btn-sm"}
      onClick={async () => {
        if (await copyText(text, html)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else ui.toast("Não foi possível copiar.", { kind: "error" });
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
      {done ? "Copiado" : label}
    </button>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            data-autofocus
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-text">{message}</div>
    </Modal>
  );
}

/** Tamanho de arquivo: "1,2 MB" */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
