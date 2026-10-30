import { compile, scoreHits, searchDoc, snippet, type DocHit, type Segment } from "../domain/search";
import type { Dataset, Doc } from "../domain/types";
import type { AppStore } from "../store/store";

// Pesquisa nos documentos guardados: lê o texto de cada arquivo do aparelho, aos poucos, sem travar a tela.

export interface DocResult {
  doc: Doc;
  hit: DocHit;
  score: number;
  /** Página do arquivo com mais ocorrências. */
  page: number;
  snippet: Segment[];
}

/** Páginas do documento dentro do arquivo (1 = primeira). */
export function docRange(doc: Doc, total: number): [number, number] {
  return doc.pages ? [doc.pages[0], Math.min(doc.pages[1], total)] : [1, total];
}

/** Documentos pesquisáveis: o "processo integral" só entra quando não foi separado em documentos. */
export function searchableDocs(ds: Dataset, docs: Doc[]): Doc[] {
  const parents = new Set(Object.values(ds.docs).map((d) => d.parentId).filter(Boolean));
  return docs.filter((d) => !parents.has(d.id));
}

export async function searchDocs(store: AppStore, docs: Doc[], query: string, onProgress?: (done: number, total: number) => void, signal?: { cancelled: boolean }): Promise<DocResult[]> {
  const m = compile(query);
  if (m.empty) return [];
  const found: { doc: Doc; hit: DocHit; texts: string[]; first: number }[] = [];
  for (let i = 0; i < docs.length; i++) {
    if (signal?.cancelled) return [];
    const doc = docs[i];
    const all = await store.pages(doc.fileId);
    const [a, b] = docRange(doc, all.length);
    const texts = all.slice(a - 1, b);
    const hit = searchDoc(texts, m, doc.title, a);
    if (hit) found.push({ doc, hit, texts, first: a });
    onProgress?.(i + 1, docs.length);
    // devolve a vez para a tela a cada alguns documentos
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  return scoreHits(found, docs.length).map((r) => {
    const best = r.hit.pages[0];
    const text = best ? r.texts[best.page - r.first] : r.texts[0] || "";
    return { doc: r.doc, hit: r.hit, score: r.score, page: best?.page || r.first, snippet: best ? snippet(text, m, best.first) : [{ text: text.slice(0, 200), hit: false }] };
  });
}
