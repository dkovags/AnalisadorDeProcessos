// Regressão de leitura de anexos grandes. Uso: CHROMIUM_PATH=/usr/bin/chromium node scripts/test-large-pdf.mjs
// Gera um PDF sintético de 315 MiB com imagens e texto; não usa documentos reais.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const pageCount = 315;
mkdirSync("test-results", { recursive: true });
const output = mkdtempSync(resolve("test-results/large-pdf-"));
const filename = `${output}/processo-315mb.pdf`;
const image = Buffer.alloc(1024 * 1024);
const offsets = [0];
let position = 0;
const fd = openSync(filename, "wx");
function write(value) {
  const data = typeof value === "string" ? Buffer.from(value, "latin1") : value;
  let done = 0;
  while (done < data.length) done += writeSync(fd, data, done, data.length - done);
  position += data.length;
}
function object(id, body) {
  offsets[id] = position;
  write(`${id} 0 obj\n${body}\nendobj\n`);
}
try {
  write("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + i * 3} 0 R`).join(" ")}] >>`);
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < pageCount; i++) {
    const pageId = 4 + i * 3;
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Image ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    const content = `q 450 0 0 450 70 180 cm /Image Do Q\nBT /F1 16 Tf 70 730 Td (Processo judicial - pagina ${i + 1}) Tj ET\n`;
    object(pageId + 1, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
    // Cada página possui sua própria imagem, sem compressão, para produzir o tamanho alvo sem cópias gigantes.
    for (let n = 0; n < image.length; n++) image[n] = (n + i * 13) % 256;
    offsets[pageId + 2] = position;
    write(`${pageId + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1024 /Height 1024 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${image.length} >>\nstream\n`);
    write(image);
    write("\nendstream\nendobj\n");
  }
  const xref = position;
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) write(`${String(offset).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
} finally {
  closeSync(fd);
}
const hash = createHash("sha256");
for await (const chunk of createReadStream(filename)) hash.update(chunk);
const expectedHash = hash.digest("hex");

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
let browser;
let startupOutput = "";
try {
  const url = await new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Vite não iniciou: ${startupOutput}`)), 20000);
    server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Vite saiu (${code}): ${startupOutput}`)); });
    server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    server.stderr.on("data", (data) => { startupOutput += data; });
    server.stdout.on("data", (data) => {
      startupOutput += data;
      const found = startupOutput.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (found) { clearTimeout(timeout); resolveUrl(found[0]); }
    });
  });
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.goto(url);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "large-pdf-test";
    document.body.append(input);
  });
  await page.locator("#large-pdf-test").setInputFiles(filename);
  const result = await page.evaluate(async ({ pageCount }) => {
    const file = document.querySelector("#large-pdf-test").files[0];
    const original = Blob.prototype.arrayBuffer;
    let count = 0;
    let bytes = 0;
    let largest = 0;
    Blob.prototype.arrayBuffer = function () {
      count++;
      bytes += this.size;
      largest = Math.max(largest, this.size);
      if (this.size > 8 * 1024 * 1024) throw new Error(`Leitura integral ou bloco excessivo: ${this.size} bytes`);
      return original.call(this);
    };
    try {
      const { readFileText, sha256 } = await import("/src/store/ingest.ts");
      const start = performance.now();
      let progress = 0;
      const extracted = await readFileText(file, (done) => { progress = done; });
      const readingMs = performance.now() - start;
      if (extracted.pages.length !== pageCount || progress !== pageCount) throw new Error("Nem todas as páginas foram lidas");
      extracted.pages.forEach((text, i) => {
        if (!text.includes(`Processo judicial - pagina ${i + 1}`)) throw new Error(`Texto ausente na página ${i + 1}`);
      });
      const readBytes = bytes;
      const hashStart = performance.now();
      const digest = await sha256(file);
      return { fileBytes: file.size, pages: extracted.pages.length, readingMs, hashingMs: performance.now() - hashStart, readBytes, hashBytes: bytes - readBytes, largestRead: largest, blockReads: count, digest };
    } finally {
      Blob.prototype.arrayBuffer = original;
    }
  }, { pageCount });
  assert.equal(result.digest, expectedHash, "SHA-256 deve ser idêntico ao hash de todo o arquivo");
  assert.equal(result.hashBytes, position, "Hash deve percorrer exatamente todos os bytes");
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, output }, null, 2));
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(timer);
  }
}
