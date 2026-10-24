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

const CHAT_PAGE = 50;

// Lo que el chat necesita recordar entre una actualización y otra
const chatState = new WeakMap();
const stateOf = (list) => {
  if (!chatState.has(list)) chatState.set(list, { limit: CHAT_PAGE, unseen: 0, lastAt: null, chat: null, myUid: null });
  return chatState.get(list);
};

const isAtBottom = (list) => list.scrollHeight - list.scrollTop - list.clientHeight < 40;

const showUnseen = (list, n) => {
  stateOf(list).unseen = n;
  const pill = list.parentNode.querySelector(".chat-new");
  if (!pill) return;
  pill.hidden = n === 0;
  pill.textContent = `↓ ${n} ${n === 1 ? "mensaje nuevo" : "mensajes nuevos"}`;
};

/**
 * Mensajes del chat, el más nuevo abajo. Si estabas leyendo lo último, baja solo;
 * si estabas leyendo algo viejo, te deja ahí y avisa cuántos llegaron.
 */
export const renderChat = (list, chat, myUid) => {
  const st = stateOf(list);
  st.chat = chat;
  st.myUid = myUid;
  const all = Object.values(chat || {}).filter((m) => typeof m.at === "number").sort((a, b) => a.at - b.at);
  const msgs = all.slice(-st.limit);
  const hasMore = all.length > msgs.length;
  const key = `${all.length}:${all.length ? all[all.length - 1].at : 0}:${st.limit}`;
  if (list.dataset.key === key) return;
  list.dataset.key = key;

  const fresh = st.lastAt === null ? [] : all.filter((m) => m.at > st.lastAt);
  st.lastAt = all.length ? all[all.length - 1].at : 0;
  // Si el que escribió fui yo, lo llevo al final aunque estuviera leyendo arriba
  const stick = isAtBottom(list) || fresh.some((m) => m.uid === myUid);

  list.innerHTML = msgs.length
    ? (hasMore ? `<li class="chat-more"><button type="button" class="btn ghost" data-more>Ver anteriores</button></li>` : "") +
      msgs.map((m) => `<li class="${m.uid === myUid ? "mine" : ""}"><b>${escapeHtml(m.name)}</b> ${escapeHtml(m.text)}</li>`).join("")
    : `<li class="hint">Nadie escribió todavía. ¡Saludá!</li>`;

  if (stick) {
    list.scrollTop = list.scrollHeight;
    showUnseen(list, 0);
  } else if (fresh.length) {
    showUnseen(list, st.unseen + fresh.length);
  }
};

/** Agrandar/achicar la caja, el aviso de mensajes nuevos y "Ver anteriores". */
export const bindChatView = (box) => {
  const list = box.querySelector(".chat-list");
  const toggle = box.querySelector(".chat-toggle");
  const pill = box.querySelector(".chat-new");

  toggle.onclick = () => {
    const stick = isAtBottom(list);
    const expanded = box.classList.toggle("expanded");
    toggle.setAttribute("aria-expanded", expanded);
    toggle.querySelector(".chat-toggle-hint").textContent = expanded ? "Achicar ⤡" : "Agrandar ⤢";
    if (stick) list.scrollTop = list.scrollHeight;
  };

  pill.onclick = () => {
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    showUnseen(list, 0);
  };

  list.addEventListener("scroll", () => {
    if (stateOf(list).unseen && isAtBottom(list)) showUnseen(list, 0);
  }, { passive: true });

  // Al cargar los anteriores, que no salte lo que estabas leyendo
  list.addEventListener("click", (e) => {
    if (!e.target.closest("[data-more]")) return;
    const st = stateOf(list);
    const fromBottom = list.scrollHeight - list.scrollTop;
    st.limit += CHAT_PAGE;
    renderChat(list, st.chat, st.myUid);
    list.scrollTop = list.scrollHeight - fromBottom;
  });
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
