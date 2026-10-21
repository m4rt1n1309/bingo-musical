// Servidor estático para probar el sitio en la compu: npm run dev  →  http://localhost:8080
// (En internet lo sirve GitHub Pages; esto es solo para desarrollo.)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8080;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

http
  .createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (file.endsWith("/")) file += "index.html";
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT + path.sep)) return res.writeHead(404).end();
    fs.readFile(full, (err, buf) => {
      if (err) return res.writeHead(404).end("no encontrado");
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  })
  .listen(PORT, () => console.log(`Bingo Musical en http://localhost:${PORT}`));
