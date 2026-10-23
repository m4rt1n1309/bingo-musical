import { CATALOG } from "./catalog.js";
import { ROWS, shuffle, songKey, timeline, playedAt, checkClaim, resolveClaims, verdictMessage } from "./logic.js";
import { configured, signIn, serverNow, watchRoom, watchConnection, roomExists, savePlayer, updatePlayer, pushClaim, pushChat, serverTimestamp } from "./net.js";
import { createSyncAudio } from "./audio.js";
import { $, escapeHtml, store, show, salaFromUrl, wantedSong, visibleHistory, buildFeed, renderChat, bindChatForm, confetti } from "./ui.js";

const sala = salaFromUrl();
if (!sala) location.href = "./";
const NAME_KEY = `bingo-musical-name-${sala}`;

let uid = null;
let room = null;         // datos de la sala tal como están en Firebase
let derived = null;      // estado calculado (línea de tiempo, cantos, ganadores)
let marked = new Set();
let markedRound = null;
let cardRendered = null; // para no redibujar el cartón si no cambió
let wantsToJoin = !!store.get(NAME_KEY); // ya puso su nombre en esta sala
let joined = false;                       // su jugador existe en Firebase
const audio = createSyncAudio(serverNow);
let online = navigator.onLine;
watchConnection((ok) => { online = ok; if (derived) renderStatus(); });

const me = () => room && room.players && room.players[uid];
const marksKey = () => `bingo-musical-marks-${sala}-${room.game.roundId}`;

// ---------- Sonido ----------

let wakeLock = null;
const keepAwake = async () => {
  try { if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch { /* no soportado */ }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  wakeLock = null;
  keepAwake();
  // Al volver a la pestaña, el audio puede haber quedado cortado
  if (audio.unlocked) audio.restart();
});

const unlockSound = () => audio.unlock().then(() => { keepAwake(); render(); });

$("btn-sound").onclick = () => unlockSound().catch(() => { $("btn-sound").textContent = "No se pudo activar, tocá de nuevo"; });

// ---------- Unirse ----------

const savedName = store.get(NAME_KEY);
if (savedName) $("name").value = savedName;

const newCard = (game) => shuffle(game.pool).slice(0, ROWS * game.config.cols);

const uniqueName = (name) => {
  const taken = new Set(Object.entries(room.players || {}).filter(([id]) => id !== uid).map(([, p]) => p.name.toLowerCase()));
  let result = name;
  for (let n = 2; taken.has(result.toLowerCase()); n++) result = `${name} ${n}`;
  return result;
};

let joining = null;
const joinGame = () => {
  if (joining) return joining;
  const game = room.game;
  const name = uniqueName(store.get(NAME_KEY));
  joining = savePlayer(sala, uid, { name, joinedAt: serverTimestamp(), roundId: game.roundId, card: newCard(game) })
    .finally(() => { joining = null; });
  return joining;
};

$("join-form").onsubmit = async (e) => {
  e.preventDefault();
  $("join-error").hidden = true;
  const name = $("name").value.trim().slice(0, 20);
  if (!name) return;
  store.set(NAME_KEY, name);
  wantsToJoin = true;
  // Aprovechamos el toque para habilitar el sonido
  unlockSound().catch(() => {});
  try {
    if (room && room.game && room.game.pool) await joinGame();
  } catch (err) {
    $("join-error").textContent = `No se pudo entrar: ${err.message}`;
    $("join-error").hidden = false;
  }
  render();
};

// ---------- Cartón ----------

const renderCard = (p, cols) => {
  const key = `${p.roundId}:${p.card.join(",")}`;
  if (cardRendered === key) return;
  cardRendered = key;
  const card = $("card");
  card.style.setProperty("--cols", cols);
  card.innerHTML = p.card
    .map((idx, i) => {
      const s = CATALOG[idx];
      return `<button class="cell${marked.has(i) ? " marked" : ""}" data-index="${i}"><span class="title">${escapeHtml(s.title)}</span><span class="artist">${escapeHtml(s.artist)}</span></button>`;
    })
    .join("");
};

$("card").onclick = (e) => {
  const cell = e.target.closest(".cell");
  if (!cell || !derived || derived.status !== "playing") return;
  const i = Number(cell.dataset.index);
  if (marked.has(i)) marked.delete(i); else marked.add(i);
  cell.classList.toggle("marked", marked.has(i));
  cell.classList.remove("wrong");
  if (navigator.vibrate) navigator.vibrate(15);
  store.set(marksKey(), [...marked]);
};

$("btn-new-card").onclick = () => {
  if (derived && derived.status === "lobby") updatePlayer(sala, uid, { card: newCard(room.game) });
};

// ---------- Cantar ----------

const claim = async (type) => {
  const p = me();
  const game = room.game;
  // Lo revisamos acá mismo para responder al toque; el resultado oficial llega por Firebase
  const verdict = derived.lineWinner && type === "line"
    ? { ok: false, reason: "line-taken", wrong: [] }
    : checkClaim(type, p.card, [...marked], playedAt(game, serverNow()), game.config.cols);
  const cardSongs = p.card.map((i) => CATALOG[i]);
  showMessage(verdictMessage(type, verdict, cardSongs, derived.lineWinner && derived.lineWinner.name), verdict.ok ? "ok" : "bad");
  document.querySelectorAll("#card .cell").forEach((c) => c.classList.remove("wrong"));
  (verdict.wrong || []).forEach((i) => $("card").children[i].classList.add("wrong"));
  (verdict.cells || []).forEach((i) => $("card").children[i].classList.add("won"));
  if (navigator.vibrate) navigator.vibrate(verdict.ok ? [100, 50, 100] : 300);
  if (verdict.ok && type === "line") celebrateLine();
  if (verdict.reason === "no-row" || verdict.reason === "incomplete" || verdict.reason === "line-taken") return;
  await pushClaim(sala, { uid, name: p.name, type, marked: [...marked], roundId: game.roundId });
};
$("btn-line").onclick = () => claim("line");
$("btn-bingo").onclick = () => claim("bingo");

// ---------- Chat ----------

bindChatForm($("chat-form"), $("chat-input"), (text) => pushChat(sala, { uid, name: me().name, text }));

let msgTimer = null;
const showMessage = (text, kind) => {
  const el = $("message");
  el.textContent = text;
  el.className = `message ${kind}`;
  el.hidden = false;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.hidden = true; }, 7000);
};

// Confeti una sola vez por ronda: al cantar, o cuando llega el veredicto si acá no se vio válida
let celebratedRound = null;
const celebrateLine = () => {
  if (celebratedRound === room.game.roundId) return;
  celebratedRound = room.game.roundId;
  confetti();
};

let toastTimer = null;
const toast = (text, kind) => {
  const el = $("toast");
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
};

// ---------- Estado ----------

const seenClaims = new Set();
const seenChat = new Set();
let firstSnapshot = true;

const onRoom = async (data) => {
  if (!data) return show("screen-missing");
  room = data;
  const game = room.game || {};
  const p = me();

  if (p && game.roundId && markedRound !== game.roundId) {
    markedRound = game.roundId;
    marked = new Set(store.get(marksKey()) || []);
    cardRendered = null;
  }

  // Nueva ronda: cartón nuevo
  if (p && game.pool && p.roundId !== game.roundId) {
    updatePlayer(sala, uid, { roundId: game.roundId, card: newCard(game) });
  }
  if (p) {
    joined = true;
  } else if (joined) {
    // Estaba anotado y ya no está: lo sacó el anfitrión
    joined = false;
    wantsToJoin = false;
    $("join-error").textContent = "El anfitrión te sacó de la partida. Si fue un error, podés volver a entrar.";
    $("join-error").hidden = false;
  } else if (wantsToJoin && game.pool) {
    // Ya había puesto su nombre y la partida está lista: lo anotamos
    joinGame().catch(() => {});
  }

  // Avisos de lo que cantan los demás
  derive();
  for (const r of derived.results) {
    if (seenClaims.has(r.id)) continue;
    seenClaims.add(r.id);
    if (firstSnapshot) continue;
    const item = buildFeed([r])[0];
    if (item && r.uid !== uid) toast(item.text, item.kind);
    // Si el veredicto oficial difiere de lo que vimos localmente, mostramos el oficial
    if (r.uid === uid && p) {
      const cardSongs = p.card.map((i) => CATALOG[i]);
      showMessage(verdictMessage(r.type, r.verdict, cardSongs, derived.lineWinner && derived.lineWinner.name), r.verdict.ok ? "ok" : "bad");
      if (r.verdict.ok && r.type === "line") celebrateLine();
    }
  }
  // Mensajes nuevos del chat: aviso abajo, sin tapar el de una línea o un bingo
  for (const [id, m] of Object.entries(room.chat || {})) {
    if (seenChat.has(id)) continue;
    seenChat.add(id);
    if (firstSnapshot || m.uid === uid || !p) continue;
    if ($("toast").hidden || $("toast").classList.contains("chat")) toast(`💬 ${m.name}: ${m.text}`, "chat");
  }
  firstSnapshot = false;
  render();
};

const derive = () => {
  const game = room.game || {};
  const players = room.players || {};
  const playing = game.status === "playing" && game.base;
  const { results, lineWinner, bingoWinner } = game.roundId ? resolveClaims(game, room.claims, players) : { results: [], lineWinner: null, bingoWinner: null };
  const ended = game.status === "ended" || !!bingoWinner;
  const now = serverNow();
  const tl = playing ? timeline(game, now) : null;
  derived = {
    status: ended ? "ended" : game.status,
    tl,
    results,
    lineWinner,
    bingoWinner,
    endAt: bingoWinner ? bingoWinner.at : game.endedAt || now,
  };
  return derived;
};

const render = () => {
  if (!room) return;
  derive();
  const game = room.game || {};
  const p = me();
  const { status, tl } = derived;
  const ready = !!game.pool && ["lobby", "playing", "ended"].includes(status);

  audio.update(p ? wantedSong(game, tl, status === "ended") : null);
  $("sound-gate").hidden = !(p && !audio.unlocked && (status === "lobby" || status === "playing"));

  $("chat-box").hidden = !p;
  if (!p) return show(wantsToJoin ? "screen-wait" : "screen-join");
  renderChat($("chat"), room.chat, uid);
  $("me-name").textContent = `Jugando como ${p.name} · Sala ${sala}`;
  // En el juego, el chat va justo debajo del cartón y los botones, sin tener que bajar hasta el fondo
  const chatSpot = ready && status !== "ended" ? $("chat-spot") : $("chat-end");
  if ($("chat-box").parentNode !== chatSpot) chatSpot.append($("chat-box"));
  if (!ready) return show("screen-wait");

  if (status === "ended") {
    const bw = derived.bingoWinner;
    $("end-title").textContent = bw ? (bw.uid === uid ? "🏆 ¡GANASTE!" : `🏆 Ganó ${bw.name}`) : "Partida terminada";
    $("end-text").textContent = derived.lineWinner ? `La línea la cantó ${derived.lineWinner.name}.` : "";
    const mine = new Set(p.card.map((i) => songKey(CATALOG[i])));
    $("end-history").innerHTML = (visibleHistory(game, tl, true, derived.endAt) || [])
      .map((h) => `<li class="${mine.has(h) ? "on-card" : ""}">${escapeHtml(h)}</li>`)
      .join("");
    return show("screen-end");
  }

  show("screen-game");
  renderCard(p, game.config.cols);
  const lobby = status === "lobby";
  $("lobby-tools").hidden = !lobby;
  $("claims").hidden = lobby;
  $("btn-line").disabled = !!derived.lineWinner;
  $("btn-line").textContent = derived.lineWinner ? `Línea: ${derived.lineWinner.name}` : "¡LÍNEA!";
  $("card").classList.toggle("locked", lobby);

  const feed = buildFeed(derived.results).slice(0, 5);
  $("feed-panel").hidden = !feed.length;
  $("feed").innerHTML = feed.map((f) => `<li class="feed-${f.kind}">${escapeHtml(f.text)}</li>`).join("");
  renderStatus();
};

const renderStatus = () => {
  if (!derived || !me()) return;
  const { status, tl } = derived;
  let pct = 0;

  if (status === "lobby") {
    $("status-label").textContent = `Esperando que arranque… (${Object.keys(room.players || {}).length} jugando)`;
    $("status-count").textContent = "";
  } else if (tl) {
    $("status-count").textContent = `Tema ${Math.max(1, tl.playedCount)}/${tl.total}`;
    if (!online) $("status-label").textContent = "📡 Sin conexión con la sala… reconectando";
    else if (tl.paused && room.game.autoPaused) $("status-label").textContent = "⏸ En pausa: un tema no cargaba, sigue sola en un momento";
    else if (tl.paused) $("status-label").textContent = "⏸ En pausa";
    else if (tl.phase === "preparing") $("status-label").textContent = "🎧 Preparados…";
    else if (tl.phase === "playing") $("status-label").textContent = `🎶 Sonando… ${Math.ceil(tl.remainingMs / 1000)}s`;
    else if (tl.last) $("status-label").textContent = "Fue el último tema. ¿Cantás bingo?";
    else if (tl.phaseTotalMs) $("status-label").textContent = `Próximo tema en ${Math.ceil(tl.remainingMs / 1000)}…`;
    else $("status-label").textContent = "Esperando el próximo tema";
    if (tl.phaseTotalMs) pct = tl.phase === "playing" ? 1 - tl.remainingMs / tl.phaseTotalMs : tl.remainingMs / tl.phaseTotalMs;
  }
  $("status-bar").classList.toggle("playing", !!tl && tl.phase === "playing" && !tl.paused);
  $("countdown-bar").style.width = `${pct * 100}%`;
  const history = tl && tl.phase === "waiting" ? visibleHistory(room.game, tl, false) : null;
  $("status-reveal").textContent = history && history.length ? `Era: ${history[history.length - 1]}` : "";
};

// Los temas avanzan solos con el reloj, así que recalculamos seguido aunque no lleguen datos nuevos
setInterval(() => {
  if (!room) return;
  const before = derived && derived.tl && `${derived.tl.phase}:${derived.tl.index}`;
  derive();
  const after = derived.tl && `${derived.tl.phase}:${derived.tl.index}`;
  if (before !== after) render();
  else {
    audio.update(me() ? wantedSong(room.game, derived.tl, derived.status === "ended") : null);
    renderStatus();
  }
}, 200);

// ---------- Arranque ----------

(async () => {
  if (!configured) {
    $("missing-title").textContent = "Falta configurar Firebase";
    $("missing-text").textContent = "Completá js/firebase-config.js con los datos de tu proyecto.";
    return show("screen-missing");
  }
  try {
    uid = await signIn();
    if (!(await roomExists(sala))) return show("screen-missing");
    watchRoom(sala, onRoom);
  } catch (err) {
    $("missing-title").textContent = "No se pudo conectar";
    $("missing-text").textContent = err.message;
    show("screen-missing");
  }
})();
