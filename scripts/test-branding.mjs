// Uso: npm run build && CHROMIUM_PATH=/usr/bin/chromium node scripts/test-branding.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

mkdirSync("test-results/branding", { recursive: true });
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Preview não iniciou: ${output}`)), 15000);
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Preview saiu: ${code}`)); });
    server.stderr.on("data", (data) => { output += data; });
    server.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByText("Boas-vindas ao InteliJus", { exact: true }).waitFor();
    await page.locator(".brand-logo").evaluate((img) => img.decode());
    await page.locator(".app-logo").evaluate((img) => img.decode());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Layout sem rolagem horizontal");
    assert.equal(await page.title(), "InteliJus");
    const manifest = await (await context.request.get(new URL("manifest.webmanifest", url).href)).json();
    assert.equal(manifest.name, "InteliJus");
    for (const icon of manifest.icons) assert.equal((await context.request.get(new URL(icon.src, url).href)).status(), 200);
    await page.screenshot({ path: `test-results/branding/${width}.png`, fullPage: true });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, {}, { timeout: 15000 });
    await page.reload({ waitUntil: "networkidle" });
    await context.setOffline(true);
    await page.reload();
    await page.getByText("Boas-vindas ao InteliJus", { exact: true }).waitFor({ timeout: 10000 });
    await page.locator(".brand-logo").evaluate((img) => img.decode());
    await page.locator(".app-logo").evaluate((img) => img.decode());
    console.log(`OK ${width}px: logo, ícone, manifesto e aplicativo sem internet`);
    await context.close();
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const closed = once(server, "exit");
    server.kill();
    await closed;
  }
}
