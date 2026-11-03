import { describe, expect, it } from "vitest";
import { sha256 } from "../src/store/filehash";

async function webCryptoHash(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("SHA-256 de anexos", () => {
  it.each([0, 1, 63, 64, 65, 1024 * 1024 - 1, 1024 * 1024, 1024 * 1024 + 1, 3 * 1024 * 1024 + 17])(
    "mantém o hash completo de %i bytes, inclusive entre blocos",
    async (size) => {
      const data = Uint8Array.from({ length: size }, (_, i) => (i * 131 + (i >>> 8)) & 255);
      const expected = await webCryptoHash(data);
      expect(await sha256(new Blob([data]))).toBe(expected);
    },
  );

  it("lê somente fatias limitadas do arquivo, sem alocar o anexo inteiro", async () => {
    const data = new Uint8Array(3 * 1024 * 1024 + 17).fill(0xa5);
    const sizes: number[] = [];
    class SlicedFile extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        throw new Error("O arquivo inteiro não deve ser lido");
      }
      override slice(start?: number, end?: number, type?: string): Blob {
        const piece = super.slice(start, end, type);
        sizes.push(piece.size);
        return piece;
      }
    }
    expect(await sha256(new SlicedFile([data]))).toBe(await webCryptoHash(data));
    expect(sizes.reduce((sum, n) => sum + n, 0)).toBe(data.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1024 * 1024);
  });
});
