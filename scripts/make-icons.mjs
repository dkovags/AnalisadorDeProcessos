// Gera os tamanhos web do ícone InteliJus com o Chromium do Playwright.
// Uso: node scripts/make-icons.mjs  (lê public/brand-icon.png e grava os PNG em public/)
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2] || "public";
const background = process.argv[3] || "#0b233d";
const source = `data:image/png;base64,${readFileSync(`${dir}/brand-icon.png`).toString("base64")}`;
// CHROMIUM_PATH: usa um Chromium já instalado (quando a versão do Playwright não tem o navegador baixado)
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();

async function render(size, maskable, out) {
  // O desenho já tem respiro; a redução adicional protege o símbolo no recorte circular maskable.
  const innerSize = maskable ? size * 0.8 : size;
  const inner = `<div style="width:${size}px;height:${size}px;background:${background};display:flex;align-items:center;justify-content:center">
    <img src="${source}" width="${innerSize}" height="${innerSize}" alt="" style="display:block"></div>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${inner}</body></html>`);
  await page.locator("img").evaluate((img) => img.decode());
  writeFileSync(out, await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
}

try {
  await render(32, false, `${dir}/icon-32.png`);
  await render(192, false, `${dir}/icon-192.png`);
  await render(512, false, `${dir}/icon-512.png`);
  await render(512, true, `${dir}/icon-maskable-512.png`);
} finally {
  await browser.close();
}
console.log("ícones gerados");
