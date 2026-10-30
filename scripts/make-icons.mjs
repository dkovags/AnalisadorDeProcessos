// Gera os ícones PNG do aplicativo a partir do desenho em SVG (usa o Chromium do Playwright).
// Uso: node scripts/make-icons.mjs  (lê public/icon.svg e grava os PNG em public/)
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2] || "public";
const background = process.argv[3] || "#24406b";
const svg = readFileSync(`${dir}/icon.svg`, "utf8");
// CHROMIUM_PATH: usa um Chromium já instalado (quando a versão do Playwright não tem o navegador baixado)
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();

async function render(size, maskable, out) {
  // ícone "maskable": fundo cheio e o desenho dentro da área segura (80%)
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:${background};display:flex;align-items:center;justify-content:center">
         <div style="width:${size * 0.72}px;height:${size * 0.72}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${inner}</body></html>`);
  writeFileSync(out, await page.screenshot({ omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } }));
}

await render(192, false, `${dir}/icon-192.png`);
await render(512, false, `${dir}/icon-512.png`);
await render(512, true, `${dir}/icon-maskable-512.png`);
await browser.close();
console.log("ícones gerados");
