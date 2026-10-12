import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * `virtual:media` — lists the photos/videos that actually exist in public/ at build time
 * (another process downloads them), plus the CC attribution data. Components still fall back
 * gracefully at runtime when a key is missing.
 */
function mediaManifest(): Plugin {
  const id = "virtual:media";
  const resolved = "\0" + id;
  const read = () => {
    const list = (dir: string, ext: RegExp) => {
      try {
        return fs.readdirSync(path.join(root, "public", dir)).filter((f) => ext.test(f)).map((f) => f.replace(ext, ""));
      } catch {
        return [] as string[];
      }
    };
    let credits: Record<string, unknown> = {};
    try {
      credits = JSON.parse(fs.readFileSync(path.join(root, "public/img/credits.json"), "utf8"));
    } catch {
      /* none yet */
    }
    return { images: list("img", /\.jpg$/), videos: list("video", /\.webm$/), credits };
  };
  return {
    name: "sufra-media-manifest",
    resolveId(source) {
      return source === id ? resolved : null;
    },
    load(source) {
      if (source !== resolved) return null;
      const m = read();
      return `export const images = ${JSON.stringify(m.images)};\nexport const videos = ${JSON.stringify(m.videos)};\nexport const credits = ${JSON.stringify(m.credits)};`;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), mediaManifest()],
  resolve: { alias: { "@": path.join(root, "src") } },
  build: { outDir: "dist", assetsDir: "assets", chunkSizeWarningLimit: 1500 },
});
