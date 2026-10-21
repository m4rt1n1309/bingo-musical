// Reglas del juego, sin dependencias: las usan el anfitrión y los jugadores (y los tests).
//
// No hay servidor que vaya diciendo "ahora suena tal tema". Al empezar, el anfitrión fija
// un punto de partida (base) y cada dispositivo calcula solo qué tema toca en cada momento:
//   el tema base.index arranca en base.start, el siguiente duration + pause después, y así.
// Pausar, seguir o saltear un tema es solo mover ese punto de partida.

export const ROWS = 3;
export const LEAD_MS = 2500; // margen para que todos los celulares carguen el tema antes de que arranque

export const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const songKey = (s) => `${s.artist} — ${s.title}`;

/**
 * Qué está pasando en la partida en el momento `now` (hora del servidor, en ms).
 * game: { order, config: { duration, pause }, base: { index, start }, pausedAt }
 */
export const timeline = (game, now) => {
  const D = game.config.duration * 1000;
  const P = game.config.pause * 1000;
  const total = game.order.length;
  const paused = game.pausedAt != null;
  const t = paused && now > game.pausedAt ? game.pausedAt : now;
  const { index, start } = game.base;
  const out = { paused, total, index, songStart: start, posMs: 0, remainingMs: 0, phaseTotalMs: 0, last: false };

  if (index >= total) return { ...out, phase: "waiting", index: total - 1, playedCount: total, last: true };

  const elapsed = t - start;
  if (elapsed < 0) return { ...out, phase: "preparing", playedCount: index, remainingMs: -elapsed, last: index === total - 1 };

  // Cuántos temas pasaron desde la base (con pausa manual, nunca se avanza solo)
  const cycle = D + P;
  let n = P > 0 ? Math.floor(elapsed / cycle) : 0;
  n = Math.min(n, total - 1 - index);
  const cur = index + n;
  const within = elapsed - n * cycle;
  const last = cur === total - 1;
  const common = { ...out, index: cur, songStart: start + n * cycle, playedCount: cur + 1, last };

  if (within < D) return { ...common, phase: "playing", posMs: within, remainingMs: D - within, phaseTotalMs: D };
  if (P > 0 && !last) return { ...common, phase: "waiting", remainingMs: cycle - within, phaseTotalMs: P };
  return { ...common, phase: "waiting" }; // espera manual, o fue el último tema
};

/** Índices (del catálogo) de los temas que ya empezaron a sonar en `now`. */
export const playedAt = (game, now) => new Set(game.order.slice(0, timeline(game, now).playedCount));

/**
 * Revisa un canto de línea o bingo.
 * card: índices del catálogo en el cartón; marked: casilleros marcados; played: Set de temas que sonaron.
 * Devuelve { ok, reason, wrong: [casilleros mal marcados], cells: [casilleros de la línea ganadora] }
 */
export const checkClaim = (type, card, marked, played, cols) => {
  const markedSet = new Set(marked || []);
  const notPlayed = (cells) => cells.filter((c) => !played.has(card[c]));

  if (type === "line") {
    const rows = [...Array(ROWS)].map((_, r) => [...Array(cols)].map((_, c) => r * cols + c));
    const full = rows.filter((row) => row.every((c) => markedSet.has(c)));
    if (!full.length) return { ok: false, reason: "no-row", wrong: [] };
    const good = full.find((row) => !notPlayed(row).length);
    if (good) return { ok: true, cells: good, wrong: [] };
    return { ok: false, reason: "not-played", wrong: [...new Set(full.flatMap(notPlayed))] };
  }

  const all = card.map((_, c) => c);
  const unmarked = all.filter((c) => !markedSet.has(c));
  if (unmarked.length) return { ok: false, reason: "incomplete", missing: unmarked.length, wrong: [] };
  const wrong = notPlayed(all);
  if (wrong.length) return { ok: false, reason: "not-played", wrong };
  return { ok: true, wrong: [] };
};

/**
 * Resultado de todos los cantos de la ronda, en orden de llegada.
 * Si el anfitrión ya dio su veredicto sobre un canto, vale ese (así no cambia si después se pausa o saltea).
 * Si no (por ejemplo, el anfitrión se desconectó), cada dispositivo lo calcula igual con los mismos datos.
 */
export const resolveClaims = (game, claims, players) => {
  const list = Object.entries(claims || {})
    .map(([id, c]) => ({ id, ...c }))
    .filter((c) => c.roundId === game.roundId && typeof c.at === "number")
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  let lineWinner = null;
  let bingoWinner = null;
  const results = [];
  for (const c of list) {
    if (bingoWinner) break; // después del bingo no cuenta nada
    const player = players[c.uid];
    let verdict = c.verdict;
    if (!verdict) {
      if (c.type === "line" && lineWinner) verdict = { ok: false, reason: "line-taken", wrong: [] };
      else if (!player || player.roundId !== game.roundId) verdict = { ok: false, reason: "no-card", wrong: [] };
      else verdict = checkClaim(c.type, player.card, c.marked, playedAt(game, c.at), game.config.cols);
    }
    if (verdict.ok && c.type === "line" && !lineWinner) lineWinner = { uid: c.uid, name: c.name, at: c.at };
    if (verdict.ok && c.type === "bingo") bingoWinner = { uid: c.uid, name: c.name, at: c.at };
    results.push({ ...c, verdict });
  }
  return { results, lineWinner, bingoWinner };
};

/** Texto para mostrarle a quien cantó. */
export const verdictMessage = (type, verdict, cardSongs, lineWinnerName) => {
  if (verdict.ok) return type === "line" ? "✅ ¡LÍNEA! Bien ahí. Ahora vamos por el cartón lleno." : "🏆 ¡BINGO! ¡Ganaste!";
  const titles = (cells) =>
    cells.map((c) => `"${cardSongs[c].title}"`).join(", ") + (cells.length > 1 ? " todavía no sonaron" : " todavía no sonó");
  switch (verdict.reason) {
    case "no-row": return "No tenés ninguna fila completa marcada.";
    case "incomplete": return `Te faltan marcar ${verdict.missing} casillero${verdict.missing > 1 ? "s" : ""}.`;
    case "line-taken": return `La línea ya la cantó ${lineWinnerName || "otro jugador"}. ¡Vamos por el bingo!`;
    case "not-played": return `❌ ${type === "line" ? "Línea mal cantada" : "Bingo mal cantado"}: ${titles(verdict.wrong)}.`;
    default: return "No se pudo revisar el canto.";
  }
};
