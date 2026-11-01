// Copia para public/ocr/v7/ os arquivos da leitura de imagens (OCR, com o tesseract.js): o worker, o núcleo em
// WebAssembly e o modelo do português. Eles ficam no próprio site (sem depender de CDN) e só são baixados quando a
// pessoa pede a leitura das imagens de um PDF. Roda depois do npm install e antes do build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const DEST = "public/ocr/v7/";
const FILES = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz", "por.traineddata.gz"],
];

mkdirSync(DEST, { recursive: true });
for (const [from, to] of FILES) {
  if (!existsSync(from)) {
    console.warn(`OCR: não achei ${from} (rode npm install)`);
    continue;
  }
  copyFileSync(from, DEST + to);
}
