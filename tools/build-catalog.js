// Arma js/catalog.js a partir de songs.js, buscando el fragmento de cada tema en iTunes.
// Uso: npm run catalogo   (después de agregar o cambiar temas en songs.js)
// Los temas ya encontrados quedan guardados en previews-cache.json y no se vuelven a buscar.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SONGS from "../songs.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = path.join(ROOT, "previews-cache.json");
const OUT_FILE = path.join(ROOT, "js", "catalog.js");

const norm = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const songKey = (s) => `${s.artist} — ${s.title}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pickBest = (song, results) => {
  const wantArtist = norm(song.artist);
  const wantTitle = norm(song.title);
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    if (!r.previewUrl) continue;
    const artist = norm(r.artistName || "");
    const title = norm(r.trackName || "");
    let score = 0;
    if (artist === wantArtist) score += 4;
    else if (artist.includes(wantArtist) || wantArtist.includes(artist)) score += 3;
    if (title === wantTitle) score += 4;
    else if (title.startsWith(wantTitle)) score += 3;
    else if (title.includes(wantTitle)) score += 2;
    // Preferimos versiones de estudio sobre en vivo / remixes
    if (/\b(en vivo|live|remix|karaoke|instrumental)\b/.test(title)) score -= 1;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 5 ? best : null;
};

const findPreview = async (song) => {
  const term = encodeURIComponent(`${song.artist} ${song.title}`);
  for (const country of ["AR", "US"]) {
    const url = `https://itunes.apple.com/search?term=${term}&country=${country}&media=music&entity=song&limit=15`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const best = pickBest(song, (await res.json()).results || []);
        if (best) return { previewUrl: best.previewUrl };
        break;
      } catch {
        await sleep(2000 * (attempt + 1));
      }
    }
    await sleep(1000);
  }
  return null;
};

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { /* sin caché todavía */ }

const catalog = [];
const missing = [];
for (const [genre, list] of Object.entries(SONGS)) {
  for (const song of list) {
    const key = songKey(song);
    if (!cache[key]) {
      process.stdout.write(`Buscando ${key}… `);
      const info = await findPreview(song);
      console.log(info ? "ok" : "NO ENCONTRADO");
      if (info) cache[key] = info;
      await sleep(1000);
    }
    if (cache[key]) catalog.push({ genre, artist: song.artist, title: song.title, url: cache[key].previewUrl });
    else missing.push(key);
  }
}

fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
fs.writeFileSync(
  OUT_FILE,
  "// Generado por tools/build-catalog.js a partir de songs.js. No editar a mano: corré `npm run catalogo`.\n" +
    `export const CATALOG = ${JSON.stringify(catalog, null, 1)};\n`,
);

console.log(`\n${catalog.length} temas en el catálogo.`);
if (missing.length) console.log(`Sin fragmento (no van a aparecer en el juego):\n  ${missing.join("\n  ")}`);
