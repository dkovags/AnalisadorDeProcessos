/** Baixa um arquivo gerado no navegador. */
export function downloadFile(name: string, content: string | Blob | Uint8Array, mime: string) {
  const blob = content instanceof Blob ? content : new Blob([typeof content === "string" ? content : content.slice()], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Abre um arquivo guardado numa nova aba (PDF na página indicada). */
export function openBlob(blob: Blob, page?: number) {
  const url = URL.createObjectURL(blob);
  const w = window.open(page ? `${url}#page=${page}` : url, "_blank");
  if (w) w.opener = null;
  else {
    // bloqueio de janela: baixa o arquivo
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Nome de arquivo seguro: "Maria x Banco" → "maria-x-banco". */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "arquivo"
  );
}
