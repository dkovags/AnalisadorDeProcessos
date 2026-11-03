import { sha256 as hash256 } from "@noble/hashes/sha2.js";

/** Blocos pequenos evitam carregar o anexo inteiro só para conferir duplicatas. */
const HASH_CHUNK_BYTES = 1024 * 1024;

/** SHA-256 completo, compatível com os hashes já guardados, usando memória limitada. */
export async function sha256(file: Blob): Promise<string> {
  const hash = hash256.create();
  let yielded = performance.now();
  try {
    for (let start = 0; start < file.size; start += HASH_CHUNK_BYTES) {
      const chunk = await file.slice(start, start + HASH_CHUNK_BYTES).arrayBuffer();
      hash.update(new Uint8Array(chunk));
      // Também devolve tempo à tela quando o arquivo já está em memória/cache.
      if (performance.now() - yielded >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        yielded = performance.now();
      }
    }
    return [...hash.digest()].map((b) => b.toString(16).padStart(2, "0")).join("");
  } finally {
    hash.destroy();
  }
}
