import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { APP_NAME } from "../config";
import type { Dataset, ID } from "../domain/types";
import { normalizeDataset } from "./dataset";

// Cópia de segurança em .zip: dados.json, os arquivos originais (arquivos/) e o texto já extraído (textos/).

export interface BackupSource {
  ds: Dataset;
  blob(id: ID): Promise<Blob | undefined>;
  pages(id: ID): Promise<string[]>;
}

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/html": "html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.oasis.opendocument.text": "odt",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export async function makeBackup(src: BackupSource, appVersion = ""): Promise<Uint8Array> {
  const zip: Zippable = {};
  const files: Record<string, string> = {};
  for (const meta of Object.values(src.ds.files)) {
    const blob = await src.blob(meta.id);
    if (blob) {
      const ext = EXT[meta.mime] || meta.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `arquivos/${meta.id}.${ext}`;
      // PDFs e imagens já são comprimidos
      zip[path] = [new Uint8Array(await blob.arrayBuffer()), { level: /pdf|jpg|png|docx|odt/.test(ext) ? 0 : 6 }];
      files[meta.id] = path;
    }
    zip[`textos/${meta.id}.json`] = strToU8(JSON.stringify(await src.pages(meta.id)));
  }
  // "autos" identifica o formato da cópia (nome interno desde a primeira versão)
  zip["dados.json"] = strToU8(JSON.stringify({ app: "autos", appVersion, savedAt: new Date().toISOString(), files, data: src.ds }));
  return zipSync(zip, { level: 6 });
}

export interface Restored {
  ds: Dataset;
  files: Map<ID, { blob: Blob; pages: string[] }>;
}

export function readBackup(data: Uint8Array): Restored {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new Error(`O arquivo não é uma cópia de segurança do ${APP_NAME} (.zip).`);
  }
  const main = entries["dados.json"];
  if (!main) throw new Error("A cópia não tem o arquivo dados.json.");
  const json = JSON.parse(strFromU8(main));
  if (json.app !== "autos") throw new Error(`Esta cópia não é do ${APP_NAME}.`);
  const ds = normalizeDataset(json.data);
  const files = new Map<ID, { blob: Blob; pages: string[] }>();
  for (const meta of Object.values(ds.files)) {
    const path = json.files?.[meta.id] as string | undefined;
    const bytes = path ? entries[path] : undefined;
    const text = entries[`textos/${meta.id}.json`];
    const pages = text ? (JSON.parse(strFromU8(text)) as string[]) : [];
    if (bytes || pages.length) files.set(meta.id, { blob: new Blob([bytes ? bytes.slice() : new Uint8Array()], { type: meta.mime }), pages });
  }
  return { ds, files };
}
