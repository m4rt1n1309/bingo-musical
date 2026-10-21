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

/** Novedades: quién entró y qué se cantó, lo más nuevo primero. */
export const buildFeed = (players, results) => {
  const items = Object.values(players || {})
    .filter((p) => typeof p.joinedAt === "number")
    .map((p) => ({ kind: "join", text: `${p.name} se sumó al juego`, at: p.joinedAt }));
  for (const r of results) {
    const what = r.type === "line" ? "LÍNEA" : "¡BINGO!";
    if (r.verdict.ok) items.push({ kind: r.type === "line" ? "line" : "bingo", text: `${r.type === "line" ? "🎉" : "🏆"} ${r.name} cantó ${what}`, at: r.at, id: r.id });
    else if (r.verdict.reason === "not-played") items.push({ kind: "bad", text: `😬 ${r.name} cantó ${r.type === "line" ? "línea" : "bingo"}… y no era`, at: r.at, id: r.id });
  }
  return items.sort((a, b) => b.at - a.at);
};
