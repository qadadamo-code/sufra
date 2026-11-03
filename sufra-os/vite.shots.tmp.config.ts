// TEMP (screenshots only, deleted after): real config + stub for imports other agents haven't written yet
import base from "./vite.config";
import fs from "node:fs";
import path from "node:path";
export default {
  ...base,
  plugins: [
    {
      name: "stub-missing",
      enforce: "pre" as const,
      resolveId(id: string, importer?: string) {
        if (!importer || !id.startsWith(".")) return null;
        const p = path.resolve(path.dirname(importer.split("?")[0]), id);
        if ([".tsx", ".ts", "/index.ts", "/index.tsx", ""].some((e) => fs.existsSync(p + e))) return null;
        return "\0stub:" + id;
      },
      load(id: string) {
        return id.startsWith("\0stub:") ? "export default function Stub(){return null}" : null;
      },
    },
    ...(base.plugins ?? []),
  ],
};
