// Pantalla para elegir qué temas de songs.js quedan afuera del juego: npm run temas  →  http://localhost:8090
// Corre solo en esta compu (no se publica en GitHub Pages). Al guardar anota los temas sacados en
// excluidos.json y vuelve a armar js/catalog.js. Después hay que subir los cambios a GitHub.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile, exec } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SONGS_FILE = path.join(ROOT, "songs.js");
const CACHE_FILE = path.join(ROOT, "previews-cache.json");
const EXCLUDED_FILE = path.join(ROOT, "excluidos.json");
const BUILD = path.join(ROOT, "tools", "build-catalog.js");
const PORT = Number(process.env.PORT) || 8090;

const GENRE_NAMES = { rock: "Rock nacional", cumbia: "Cumbia", pop: "Pop latino" };
const songKey = (s) => `${s.artist} — ${s.title}`;
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };

// songs.js se vuelve a leer en cada pedido, así toma los temas que se agreguen sin reiniciar
const loadSongs = async () => (await import(`${pathToFileURL(SONGS_FILE)}?t=${Date.now()}`)).default;

const list = async () => {
  const songs = await loadSongs();
  const cache = readJson(CACHE_FILE, {});
  const excluded = new Set(readJson(EXCLUDED_FILE, []));
  return Object.entries(songs).map(([genre, items]) => ({
    genre,
    name: GENRE_NAMES[genre] || genre,
    songs: items.map((s) => ({ key: songKey(s), artist: s.artist, title: s.title, url: cache[songKey(s)]?.previewUrl || null, off: excluded.has(songKey(s)) })),
  }));
};

const rebuild = () => new Promise((resolve, reject) => {
  execFile(process.execPath, [BUILD], { cwd: ROOT }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim().split("\n").filter(Boolean).pop())));
});

const save = async (keys) => {
  const known = new Set((await list()).flatMap((g) => g.songs.map((s) => s.key)));
  const clean = [...new Set(keys)].filter((k) => typeof k === "string" && known.has(k)).sort((a, b) => a.localeCompare(b, "es"));
  fs.writeFileSync(EXCLUDED_FILE, JSON.stringify(clean, null, 1) + "\n");
  return rebuild();
};

const send = (res, status, type, body) => res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);

http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://x");
      if (req.method === "GET" && pathname === "/") return send(res, 200, "text/html; charset=utf-8", PAGE);
      if (req.method === "GET" && pathname === "/api/temas") return send(res, 200, "application/json", JSON.stringify(await list()));
      if (req.method === "POST" && pathname === "/api/temas") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const summary = await save(JSON.parse(body));
        return send(res, 200, "application/json", JSON.stringify({ summary }));
      }
      send(res, 404, "text/plain", "no encontrado");
    } catch (err) {
      send(res, 500, "text/plain; charset=utf-8", err.message);
    }
  })
  // Solo escucha en esta compu: otros dispositivos de la red no pueden entrar
  .listen(PORT, "127.0.0.1", () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Temas del bingo en ${url}  (Ctrl+C para cerrar)`);
    if (process.platform === "win32" && !process.env.NO_OPEN) exec(`start "" ${url}`);
  });

const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Temas del bingo</title>
<style>
  :root { --bg: #1a1033; --panel: #251845; --ink: #f5f0ff; --muted: #b9a9dc; --accent: #ff4fa3; --accent2: #2fd4c4; --line: #4a3878; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  main { max-width: 860px; margin: 0 auto; padding: 20px 16px 110px; }
  h1 { margin: 0 0 4px; }
  .sub, .hint { color: var(--muted); }
  .sub { margin: 0 0 16px; }
  .tools { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  input[type=search] { flex: 1; min-width: 200px; font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  label.only { display: flex; align-items: center; gap: 6px; color: var(--muted); }
  section { background: var(--panel); border-radius: 14px; padding: 6px 16px 12px; margin-bottom: 14px; }
  h2 { font-size: 18px; display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  h2 .hint { font-size: 14px; font-weight: normal; }
  .song { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-top: 1px solid #33245a; }
  .song[hidden] { display: none; }
  .song label { flex: 1; display: flex; align-items: center; gap: 10px; cursor: pointer; min-width: 0; }
  .song input { width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--accent); }
  .song.off .name { opacity: .45; text-decoration: line-through; }
  .song.changed { background: #3b2a66; border-radius: 8px; }
  .name b { font-weight: 600; }
  .play { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--accent2); cursor: pointer; }
  .play:disabled { opacity: .3; cursor: default; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; background: #120a26; border-top: 1px solid var(--line); padding: 12px 16px; }
  .bar div { max-width: 860px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .bar p { flex: 1; margin: 0; min-width: 180px; }
  button.btn { font: inherit; font-weight: 600; color: var(--ink); border: 0; border-radius: 10px; padding: 10px 18px; cursor: pointer; background: #3b2a66; }
  button.btn.primary { background: var(--accent); }
  button.btn:disabled { opacity: .45; cursor: default; }
</style>
</head>
<body>
<main>
  <h1>🎵 Temas del bingo</h1>
  <p class="sub">Destildá los temas que no querés que salgan en el juego y tocá <b>Guardar</b>. Esta pantalla solo funciona en tu compu.</p>
  <div class="tools">
    <input type="search" id="q" placeholder="Buscar tema o artista">
    <label class="only"><input type="checkbox" id="only-off"> Ver solo los sacados</label>
  </div>
  <div id="list"><p class="hint">Cargando…</p></div>
</main>
<div class="bar"><div>
  <p id="status" class="hint"></p>
  <button class="btn" id="undo" disabled>Deshacer cambios</button>
  <button class="btn primary" id="save" disabled>Guardar</button>
</div></div>
<script>
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let genres = [];
  let saved = new Set();   // sacados según excluidos.json
  let off = new Set();     // sacados en pantalla, todavía sin guardar
  const audio = new Audio();
  let playing = null;

  const load = async () => {
    genres = await (await fetch("/api/temas")).json();
    saved = new Set(genres.flatMap((g) => g.songs.filter((s) => s.off).map((s) => s.key)));
    off = new Set(saved);
    render();
  };

  const render = () => {
    $("list").innerHTML = genres.map((g, gi) => \`
      <section>
        <h2>\${esc(g.name)} <span class="hint" id="count-\${gi}"></span></h2>
        \${g.songs.map((s) => \`
          <div class="song" data-key="\${esc(s.key)}" data-search="\${esc((s.artist + " " + s.title).toLowerCase())}">
            <label><input type="checkbox"> <span class="name"><b>\${esc(s.title)}</b> <span class="hint">· \${esc(s.artist)}\${s.url ? "" : " (sin fragmento)"}</span></span></label>
            <button class="play" title="Escuchar" \${s.url ? \`data-url="\${esc(s.url)}"\` : "disabled"}>▶</button>
          </div>\`).join("")}
      </section>\`).join("");
    refresh();
    filter();
  };

  const refresh = () => {
    document.querySelectorAll(".song").forEach((el) => {
      const k = el.dataset.key;
      el.querySelector("input").checked = !off.has(k);
      el.classList.toggle("off", off.has(k));
      el.classList.toggle("changed", off.has(k) !== saved.has(k));
    });
    genres.forEach((g, gi) => {
      const on = g.songs.filter((s) => !off.has(s.key)).length;
      $("count-" + gi).textContent = on + " de " + g.songs.length + " en el juego";
    });
    const changes = [...new Set([...off, ...saved])].filter((k) => off.has(k) !== saved.has(k)).length;
    $("status").textContent = changes ? changes + (changes === 1 ? " cambio sin guardar" : " cambios sin guardar") : (off.size ? off.size + " temas sacados del juego" : "Todos los temas están en el juego");
    $("save").disabled = $("undo").disabled = !changes;
  };

  const filter = () => {
    const q = $("q").value.trim().toLowerCase();
    const onlyOff = $("only-off").checked;
    document.querySelectorAll(".song").forEach((el) => {
      el.hidden = (q && !el.dataset.search.includes(q)) || (onlyOff && !off.has(el.dataset.key));
    });
  };

  $("list").addEventListener("change", (e) => {
    const k = e.target.closest(".song").dataset.key;
    if (e.target.checked) off.delete(k); else off.add(k);
    refresh();
  });

  $("list").addEventListener("click", (e) => {
    const btn = e.target.closest(".play");
    if (!btn || btn.disabled) return;
    if (playing === btn) { audio.pause(); btn.textContent = "▶"; playing = null; return; }
    if (playing) playing.textContent = "▶";
    audio.src = btn.dataset.url;
    audio.play();
    btn.textContent = "■";
    playing = btn;
  });
  audio.onended = () => { if (playing) playing.textContent = "▶"; playing = null; };

  $("q").oninput = filter;
  $("only-off").onchange = filter;
  $("undo").onclick = () => { off = new Set(saved); refresh(); filter(); };

  $("save").onclick = async () => {
    $("save").disabled = $("undo").disabled = true;
    $("status").textContent = "Guardando y armando el catálogo…";
    try {
      const res = await fetch("/api/temas", { method: "POST", body: JSON.stringify([...off]) });
      if (!res.ok) throw new Error(await res.text());
      const { summary } = await res.json();
      saved = new Set(off);
      refresh();
      $("status").textContent = "Guardado. " + summary + " Falta subir los cambios a GitHub.";
    } catch (err) {
      $("status").textContent = "No se pudo guardar: " + err.message;
      refresh();
    }
  };

  window.addEventListener("beforeunload", (e) => { if (!$("save").disabled) e.preventDefault(); });

  load();
</script>
</body>
</html>`;
