import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// Identificador desta publicação: o app aberto compara com o version.json do site para saber se saiu versão nova.
const BUILD_ID = Date.now().toString(36);

// base relativa: o app funciona em qualquer subpasta (ex.: GitHub Pages em /<repositório>/)
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "versao-publicada",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: { target: "es2020", chunkSizeWarningLimit: 900 },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
