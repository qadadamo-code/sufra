/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Served under the existing Vercel site at /app/ (see README → Deploy).
  base: "/app/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@finance": path.join(root, "../sufra-finance/src"),
      "@": path.join(root, "src"),
    },
  },
  server: { fs: { allow: [root, path.join(root, "../sufra-finance")] } },
  build: { outDir: "dist", target: "es2022", chunkSizeWarningLimit: 900 },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
  },
});
