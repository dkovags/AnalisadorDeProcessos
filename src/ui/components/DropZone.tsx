import { Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

export const ACCEPT = ".pdf,.docx,.odt,.txt,.html,.htm,.md,.rtf,.eml,image/*";

/** Área para arrastar arquivos (ou tocar para escolher). */
export function DropZone({ onFiles, children, compact }: { onFiles: (files: File[]) => void; children?: ReactNode; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? "over" : ""} ${compact ? "compact" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
    >
      <Upload size={compact ? 20 : 28} />
      <div>{children || "Arraste arquivos para cá ou toque para escolher"}</div>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
