import { defineConfig, loadEnv, type Plugin } from "vite";
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

/**
 * `npm run dev` serves /api/ask from api/ask.ts when ANTHROPIC_API_KEY is set (same code as on Vercel),
 * so the Claude concierge can be tried locally. Without a key the site uses its local recommender.
 */
function devApi(): Plugin {
  return {
    name: "sufra-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/ask", async (req, res) => {
        try {
          const mod = await server.ssrLoadModule("/api/ask.ts");
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const request = new Request("http://localhost/api/ask", { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
          const out: Response = await mod.default(request);
          res.statusCode = out.status;
          out.headers.forEach((v, k) => res.setHeader(k, v));
          if (!out.body) return res.end();
          const reader = out.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

// .env.local → process.env for the dev API (server-only key; never exposed via import.meta.env)
const fileEnv = loadEnv(process.env.NODE_ENV === "production" ? "production" : "development", root, "");
if (!process.env.ANTHROPIC_API_KEY && fileEnv.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = fileEnv.ANTHROPIC_API_KEY;

// The concierge endpoint exists on Vercel builds (VERCEL=1), or in dev when a key is present, or when forced.
const hasApi = !!process.env.VERCEL || process.env.SUFRA_API === "1" || (process.argv.some((a) => a === "dev" || a.endsWith("vite")) && !!process.env.ANTHROPIC_API_KEY);

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), mediaManifest(), devApi()],
  define: { "import.meta.env.VITE_HAS_API": JSON.stringify(hasApi ? "1" : "") },
  resolve: { alias: { "@": path.join(root, "src") } },
  build: { outDir: "dist", assetsDir: "assets", chunkSizeWarningLimit: 1500 },
});
