// Utilidades de pantalla compartidas.
import { CATALOG } from "./catalog.js";
import { songKey, timeline } from "./logic.js";

export const $ = (id) => document.getElementById(id);

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ } },
};

export const show = (id) => document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("active", el.id === id));

export const salaFromUrl = () => (new URLSearchParams(location.search).get("sala") || "").toUpperCase().trim();

export const joinUrlFor = (sala) => new URL(`jugar.html?sala=${sala}`, location.href).href;

// Lluvia de papelitos de colores sobre toda la pantalla
const CONFETTI_COLORS = ["#ff4fa3", "#2fd4c4", "#ffc53d", "#3ddc84", "#8f6bff", "#fffaf0"];
export const confetti = () => {
  const box = document.createElement("div");
  box.className = "confetti";
  for (let i = 0; i < 120; i++) {
    const p = document.createElement("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    p.style.setProperty("--drift", `${Math.random() * 160 - 80}px`);
    p.style.setProperty("--spin", `${Math.random() * 1080 - 540}deg`);
    p.style.animationDuration = `${2.2 + Math.random() * 1.8}s`;
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 5000);
};

/** Tema que tiene que estar sonando ahora (para el reproductor), o null. */
export const wantedSong = (game, tl, ended) => {
  if (!tl || ended || tl.paused || (tl.phase !== "playing" && tl.phase !== "preparing")) return null;
  return { url: CATALOG[game.order[tl.index]].url, startAt: tl.songStart };
};

/** Temas que se pueden mostrar con nombre: todos al final, o los ya terminados en modo fácil. */
export const visibleHistory = (game, tl, ended, endAt) => {
  if (!game.order) return null;
  if (ended) return game.order.slice(0, timeline(game, endAt).playedCount).map((i) => songKey(CATALOG[i]));
  if (!game.config.reveal || !tl) return null;
  const count = tl.phase === "waiting" ? tl.playedCount : tl.playedCount - (tl.phase === "playing" ? 1 : 0);
  return game.order.slice(0, Math.max(0, count)).map((i) => songKey(CATALOG[i]));
};

/** Novedades: qué se cantó, lo más nuevo primero. */
export const buildFeed = (results) => {
  const items = [];
  for (const r of results) {
    const what = r.type === "line" ? "LÍNEA" : "¡BINGO!";
    if (r.verdict.ok) items.push({ kind: r.type === "line" ? "line" : "bingo", text: `${r.type === "line" ? "🎉" : "🏆"} ${r.name} cantó ${what}`, at: r.at, id: r.id });
    else if (r.verdict.reason === "not-played") items.push({ kind: "bad", text: `😬 ${r.name} cantó ${r.type === "line" ? "línea" : "bingo"}… y no era`, at: r.at, id: r.id });
  }
  return items.sort((a, b) => b.at - a.at);
};

// ---------- Chat ----------

export const CHAT_MAX = 200;

/** Últimos mensajes del chat, el más nuevo abajo. Si estabas leyendo lo último, baja solo. */
export const renderChat = (list, chat, myUid) => {
  const msgs = Object.values(chat || {}).filter((m) => typeof m.at === "number").sort((a, b) => a.at - b.at).slice(-60);
  const key = `${msgs.length}:${msgs.length ? msgs[msgs.length - 1].at : 0}`;
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = msgs.length
    ? msgs.map((m) => `<li class="${m.uid === myUid ? "mine" : ""}"><b>${escapeHtml(m.name)}</b> ${escapeHtml(m.text)}</li>`).join("")
    : `<li class="hint">Nadie escribió todavía. ¡Saludá!</li>`;
  if (atBottom) list.scrollTop = list.scrollHeight;
};

export const bindChatForm = (form, input, send) => {
  input.maxLength = CHAT_MAX;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim().slice(0, CHAT_MAX);
    if (!text) return;
    input.value = "";
    // Si no se pudo mandar, le devolvemos lo que escribió
    try { await send(text); } catch { if (!input.value) input.value = text; }
  };
};
