import { CATALOG } from "./catalog.js";
import { ROWS, LEAD_MS, shuffle, timeline, frozenAt, resolveClaims } from "./logic.js";
import {
  configured, signIn, serverNow, newId, watchRoom, watchConnection, setGame, updateGame, removePlayer, setVerdict, clearClaims, pushChat, serverTimestamp,
} from "./net.js";
import { createSyncAudio } from "./audio.js";
import { $, escapeHtml, store, show, salaFromUrl, joinUrlFor, wantedSong, visibleHistory, buildFeed, renderChat, bindChatForm } from "./ui.js";

const GENRE_NAMES = { rock: "Rock nacional", cumbia: "Cumbia" };
const sala = salaFromUrl();
const joinUrl = joinUrlFor(sala);

let uid = null;
let room = null;
let derived = null;
let manualSetup = false;  // el anfitrión pidió volver a la configuración
const audio = createSyncAudio(serverNow);

const deny = (title, text) => {
  $("denied-title").textContent = title;
  $("denied-text").textContent = text;
  show("screen-denied");
};

const showError = (text) => {
  $("host-error").textContent = text;
  $("host-error").hidden = false;
  setTimeout(() => { $("host-error").hidden = true; }, 5000);
};
const guard = (fn) => async (...args) => {
  try { await fn(...args); } catch (err) { showError(`No se pudo: ${err.message}`); }
};

// ---------- Invitación ----------

$("sub").textContent = `Anfitrión · Sala ${sala}`;
$("room-code").textContent = sala;
$("join-url").textContent = joinUrl;
$("btn-my-card").href = joinUrl;
$("denied-play").href = joinUrl;
$("btn-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(`🎵 ¡Vení a jugar al Bingo Musical! Entrá acá: ${joinUrl}`)}`;
if (window.QRCode) new window.QRCode($("qr"), { text: joinUrl, width: 180, height: 180 });
$("btn-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(joinUrl);
    $("btn-copy").textContent = "¡Copiado!";
  } catch {
    $("btn-copy").textContent = "Copialo de abajo";
  }
  setTimeout(() => { $("btn-copy").textContent = "Copiar link"; }, 2000);
};

// ---------- Configuración ----------

const counts = {};
for (const s of CATALOG) counts[s.genre] = (counts[s.genre] || 0) + 1;
$("genres").innerHTML = Object.keys(counts)
  .map((g) => `<label class="check"><input type="checkbox" value="${g}" checked> ${GENRE_NAMES[g] || g} <span class="hint">(${counts[g]} temas)</span></label>`)
  .join("");

const newRound = async (config) => {
  let pool = CATALOG.map((s, i) => (config.genres.includes(s.genre) ? i : -1)).filter((i) => i >= 0);
  // Partida rápida o mediana: cada ronda sortea qué temas entran, y los cartones salen solo de esos
  if (config.songs) pool = shuffle(pool).slice(0, config.songs).sort((a, b) => a - b);
  if (pool.length < ROWS * config.cols) {
    $("prepare-status").hidden = false;
    $("prepare-text").textContent = `Hay ${pool.length} temas, no alcanzan para cartones de ${ROWS * config.cols}. Elegí más géneros o un cartón más chico.`;
    return;
  }
  await clearClaims(sala);
  await setGame(sala, { status: "lobby", roundId: newId(), config, pool, order: shuffle(pool), createdAt: serverNow() });
};

$("btn-prepare").onclick = guard(async () => {
  const genres = [...document.querySelectorAll("#genres input:checked")].map((i) => i.value);
  if (!genres.length) {
    $("prepare-status").hidden = false;
    $("prepare-text").textContent = "Elegí al menos un género.";
    return;
  }
  manualSetup = false;
  await newRound({
    genres,
    songs: Number($("opt-songs").value),
    duration: Number($("opt-duration").value),
    pause: Number($("opt-pause").value),
    cols: Number($("opt-size").value),
    reveal: $("opt-reveal").checked && !$("opt-reveal").disabled,
  });
});

// Con 3 segundos entre temas no da tiempo a leer cuál era: sin modo fácil
const MIN_REVEAL_PAUSE = 5;
const syncReveal = () => {
  const secs = Number($("opt-pause").value);
  const off = secs > 0 && secs < MIN_REVEAL_PAUSE;
  $("opt-reveal").disabled = off;
  if (off) $("opt-reveal").checked = false;
  $("reveal-note").hidden = !off;
};
$("opt-pause").onchange = syncReveal;
syncReveal();

// ---------- Controles ----------

// auto: la puso el juego solo porque el tema no cargaba, y se saca sola cuando se arregla.
// pausedAt es la hora en que la pausa llega a Firebase, no la de este celular: si se manda sin
// conexión y llega tarde, la partida se frena donde va en ese momento en vez de volver para atrás.
// heardUntil: hasta dónde se escuchó un tema trabado, para retomarlo desde ahí (ver frozenAt).
const pause = (heardUntil = null, auto = false) => {
  const tl = derived.tl;
  if (!tl || tl.paused) return;
  return updateGame(sala, { pausedAt: serverTimestamp(), heardUntil, autoPaused: auto || null });
};

const resume = () => {
  const game = room.game;
  if (game.pausedAt == null) return;
  // Corremos el punto de partida lo que duró la pausa, así el tema sigue desde donde quedó
  return updateGame(sala, { pausedAt: null, heardUntil: null, autoPaused: null, base: { ...game.base, start: game.base.start + (serverNow() - frozenAt(game)) } });
};

const next = () => {
  const tl = derived.tl;
  if (!tl || tl.phase === "preparing") return;
  if (tl.playedCount >= tl.total) return endGame();
  return updateGame(sala, { pausedAt: null, heardUntil: null, autoPaused: null, base: { index: tl.playedCount, start: serverNow() + LEAD_MS } });
};

const endGame = () => updateGame(sala, { status: "ended", endedAt: serverNow() });

$("btn-start").onclick = guard(() => updateGame(sala, { status: "playing", pausedAt: null, heardUntil: null, autoPaused: null, base: { index: 0, start: serverNow() + LEAD_MS } }));
// Sin conexión no se mandan: quedarían guardadas y llegarían tarde, desfasando a todos
const needsConnection = (fn) => () => (online ? fn() : showError("Sin conexión: esperá a que vuelva para pausar o pasar de tema."));
$("btn-pause").onclick = guard(needsConnection(() => (derived.tl && derived.tl.paused ? resume() : pause())));
$("btn-next").onclick = guard(needsConnection(next));
$("btn-new-round").onclick = guard(() => newRound(room.game.config));
// Está al lado de Pausa: pide un segundo toque para no terminar la partida sin querer
let endTimer = null;
$("btn-end").onclick = guard(() => {
  if (!endTimer) {
    $("btn-end").textContent = "¿Seguro? Tocá de nuevo";
    endTimer = setTimeout(() => { endTimer = null; $("btn-end").textContent = "⏹ Terminar partida"; }, 3000);
    return;
  }
  clearTimeout(endTimer);
  endTimer = null;
  $("btn-end").textContent = "⏹ Terminar partida";
  return endGame();
});
$("btn-setup").onclick = () => { manualSetup = true; render(); };

bindChatForm($("chat-form"), $("chat-input"), (text) => pushChat(sala, { uid, name: "🎤 Anfitrión", text }));

$("players").onclick = (e) => {
  const btn = e.target.closest("[data-kick]");
  if (btn) guard(() => removePlayer(sala, btn.dataset.kick))();
};

$("opt-listen").checked = !!store.get("bingo-musical-host-listen");
$("opt-listen").onchange = async () => {
  store.set("bingo-musical-host-listen", $("opt-listen").checked);
  if ($("opt-listen").checked) await audio.unlock().catch(() => {});
  render();
};
// Después de recargar, el audio necesita un toque para volver a sonar
document.addEventListener("click", () => {
  if ($("opt-listen").checked) audio.unlock().then(render).catch(() => {});
}, { once: true });

// ---------- Árbitro: el anfitrión deja asentado el resultado de cada canto ----------

const judged = new Set();
const judge = () => {
  const game = room.game;
  for (const r of derived.results) {
    const raw = room.claims && room.claims[r.id];
    if (!raw || raw.verdict || judged.has(r.id)) continue;
    judged.add(r.id);
    setVerdict(sala, r.id, r.verdict).catch(() => judged.delete(r.id));
  }
  if (derived.bingoWinner && game.status === "playing") updateGame(sala, { status: "ended", endedAt: derived.bingoWinner.at });
};

// ---------- Temas que no cargan: pausa sola y sigue sola, sin perderse temas ----------

let online = navigator.onLine;
watchConnection((ok) => { online = ok; });
let recovering = false;
let failed = { url: null, count: 0 };

const listening = () => $("opt-listen").checked && audio.unlocked;

// Saca de la lista un tema que no carga aunque haya internet, sin contarlo como sonado
const skipSong = (tl) => {
  const order = room.game.order.filter((_, i) => i !== tl.index);
  return updateGame(sala, { order, pausedAt: null, heardUntil: null, autoPaused: null, base: { index: tl.index, start: serverNow() + LEAD_MS } });
};

const watchdog = () => {
  const tl = derived.tl;
  if (!tl) return;
  const game = room.game;
  const stuck = listening() ? audio.stuckAt() : null;

  // Sin conexión no pausamos: los demás no se enterarían y la partida sigue sola en sus celulares.
  // Además la pausa quedaría guardada y, al volver la conexión, los haría retroceder.
  if (!tl.paused) {
    if (online && stuck != null) guard(() => pause(stuck, true))();
    return;
  }

  // Pausada por un corte: probamos si ya volvió todo para seguir
  if (!game.autoPaused || recovering || !online) return;
  recovering = true;
  const song = CATALOG[game.order[tl.index]];
  (listening() ? audio.probe(song.url) : Promise.resolve())
    .then(() => {
      failed = { url: null, count: 0 };
      return resume();
    }, () => {
      failed = failed.url === song.url ? { url: song.url, count: failed.count + 1 } : { url: song.url, count: 1 };
      if (failed.count < 3) return;
      failed = { url: null, count: 0 };
      showBanner(`No se pudo cargar "${song.title}", se saltea`, "bad");
      return skipSong(tl);
    })
    .catch((err) => showError(`No se pudo: ${err.message}`))
    .finally(() => setTimeout(() => { recovering = false; }, 3000));
};

// ---------- Estado ----------

let bannerTimer = null;
const showBanner = (text, kind) => {
  const el = $("banner");
  el.textContent = text;
  el.className = `banner ${kind}`;
  el.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, 8000);
};

const announced = new Set();
let firstSnapshot = true;

const onRoom = (data) => {
  if (!data) return deny("La sala ya no existe", "Creá una partida nueva desde el inicio.");
  if (data.host !== uid) return deny("Esta sala no es tuya", "Solo quien creó la sala puede manejarla desde este dispositivo. Si querés jugar, entrá con tu cartón.");
  room = data;
  derive();
  for (const r of derived.results) {
    if (announced.has(r.id)) continue;
    announced.add(r.id);
    if (!firstSnapshot && r.verdict.ok) {
      showBanner(r.type === "line" ? `🎉 ${r.name} cantó LÍNEA — ¡sigue la música!` : `🏆 ${r.name} cantó ¡BINGO!`, r.type === "line" ? "line" : "bingo");
    }
  }
  firstSnapshot = false;
  judge();
  render();
};

const derive = () => {
  const game = room.game || {};
  const { results, lineWinner, bingoWinner } = game.roundId ? resolveClaims(game, room.claims, room.players || {}) : { results: [], lineWinner: null, bingoWinner: null };
  const ended = game.status === "ended" || !!bingoWinner;
  const now = serverNow();
  derived = {
    status: ended ? "ended" : game.status,
    tl: game.status === "playing" && game.base && !ended ? timeline(game, now) : null,
    results,
    lineWinner,
    bingoWinner,
    endAt: bingoWinner ? bingoWinner.at : game.endedAt || now,
  };
};

const render = () => {
  if (!room) return;
  derive();
  const game = room.game || {};
  const { status, tl } = derived;
  const players = Object.entries(room.players || {});

  const inSetup = manualSetup || status === "setup" || !game.pool;
  show(inSetup ? "screen-setup" : "screen-room");
  audio.update($("opt-listen").checked ? wantedSong(game, tl, status === "ended") : null);
  if (inSetup) return;

  // Jugadores
  $("players-count").textContent = players.length;
  $("players").innerHTML = players.length
    ? players.map(([id, p]) => `<li><span>${escapeHtml(p.name)}</span><button class="kick" data-kick="${id}" title="Sacar">✕</button></li>`).join("")
    : `<li class="hint">Nadie todavía. ¡Pasales el link!</li>`;

  // Novedades
  const feed = buildFeed(derived.results);
  $("feed").innerHTML = feed.length
    ? feed.map((f) => `<li class="feed-${f.kind}">${escapeHtml(f.text)}</li>`).join("")
    : `<li class="hint">Acá aparecen las líneas y bingos que se canten.</li>`;
  renderChat($("chat"), room.chat, uid);

  // Historial (solo si se revela o terminó)
  const history = visibleHistory(game, tl, status === "ended", derived.endAt);
  $("history-box").hidden = !history;
  if (history) {
    $("history-count").textContent = history.length;
    $("history-list").innerHTML = history.map((h) => `<li>${escapeHtml(h)}</li>`).join("");
  }

  const playing = status === "playing";
  $("btn-start").hidden = status !== "lobby";
  $("btn-start").disabled = !players.length;
  $("btn-pause").hidden = !playing;
  $("btn-next").hidden = !playing;
  $("btn-end").hidden = !playing;
  if (!playing) $("countdown-bar").style.width = "0";

  if (status === "ended") {
    $("now-label").textContent = derived.bingoWinner ? `🏆 ¡Ganó ${derived.bingoWinner.name}!` : "Partida terminada";
    $("now-count").textContent = "";
    $("now-reveal").textContent = "";
  } else if (status === "lobby") {
    $("now-label").textContent = players.length ? "Cuando estén todos, ¡dale a Empezar!" : "Esperando jugadores…";
    $("now-count").textContent = `${game.order.length} temas en el bolillero`;
    $("now-reveal").textContent = "";
  }
  renderClock();
};

const renderClock = () => {
  const tl = derived && derived.tl;
  if (!tl) return;
  document.querySelector(".big-now").classList.toggle("playing", tl.phase === "playing" && !tl.paused);
  $("now-count").textContent = `Tema ${Math.max(1, tl.playedCount)} de ${tl.total}`;
  $("btn-pause").textContent = tl.paused ? "▶ Seguir" : "⏸ Pausa";
  $("btn-next").disabled = tl.phase === "preparing";
  // Después del último tema ya no hay siguiente: queda solo Terminar
  $("btn-next").hidden = tl.last && tl.phase === "waiting";

  let label;
  if (!online) label = "📡 Sin conexión — la partida sigue sola en los celulares, reconectando…";
  else if (tl.paused && room.game.autoPaused) label = "🔄 Cargando el tema… sigue solo en un momento";
  else if (tl.paused) label = "⏸ En pausa";
  else if (tl.phase === "preparing") label = "Preparados…";
  else if (tl.phase === "playing") label = "🎶 Sonando…";
  else if (tl.last) label = "Ese fue el último tema. ¿Alguien cantó bingo?";
  else if (tl.phaseTotalMs) label = `Próximo tema en ${Math.ceil(tl.remainingMs / 1000)}…`;
  else label = "Cuando quieras, siguiente tema";
  $("now-label").textContent = label;

  const pct = tl.phaseTotalMs ? (tl.phase === "playing" ? 1 - tl.remainingMs / tl.phaseTotalMs : tl.remainingMs / tl.phaseTotalMs) : 0;
  $("countdown-bar").style.width = `${pct * 100}%`;
  const history = tl.phase === "waiting" ? visibleHistory(room.game, tl, false) : null;
  $("now-reveal").textContent = history && history.length ? `Era: ${history[history.length - 1]}` : "";
};

// Los temas avanzan solos con el reloj
setInterval(() => {
  if (!room) return;
  derive();
  audio.update($("opt-listen").checked ? wantedSong(room.game, derived.tl, derived.status === "ended") : null);
  watchdog();
  renderClock();
}, 200);

// ---------- Arranque ----------

(async () => {
  if (!sala) return deny("Falta el código de sala", "Creá una partida desde el inicio.");
  if (!configured) return deny("Falta configurar Firebase", "Completá js/firebase-config.js con los datos de tu proyecto.");
  try {
    uid = await signIn();
    watchRoom(sala, onRoom);
  } catch (err) {
    deny("No se pudo conectar", err.message);
  }
})();
