// Tests de las reglas del juego: npm test
import assert from "node:assert/strict";
import { timeline, playedAt, checkClaim, resolveClaims } from "../js/logic.js";

const game = (over = {}) => ({
  roundId: "r1",
  order: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  config: { duration: 20, pause: 10, cols: 3 },
  base: { index: 0, start: 100000 },
  pausedAt: null,
  ...over,
});
const s = (sec) => 100000 + sec * 1000;
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`✓ ${name}`); };

test("antes de arrancar: preparados, nada sonó", () => {
  const t = timeline(game(), s(-2));
  assert.equal(t.phase, "preparing");
  assert.equal(t.playedCount, 0);
  assert.equal(t.remainingMs, 2000);
});

test("tema 1 sonando y después pausa entre temas", () => {
  let t = timeline(game(), s(5));
  assert.deepEqual([t.phase, t.index, t.posMs, t.playedCount], ["playing", 0, 5000, 1]);
  t = timeline(game(), s(25));
  assert.deepEqual([t.phase, t.remainingMs, t.phaseTotalMs], ["waiting", 5000, 10000]);
});

test("avanza solo: tema 3 a los 65 s", () => {
  const t = timeline(game(), s(65));
  assert.deepEqual([t.phase, t.index, t.posMs, t.songStart], ["playing", 2, 5000, s(60)]);
  assert.deepEqual([...playedAt(game(), s(65))], [10, 11, 12]);
});

test("tema trabado: se congela donde se dejó de escuchar", () => {
  const t = timeline(game({ pausedAt: s(8), heardUntil: s(3) }), s(50));
  assert.deepEqual([t.paused, t.phase, t.index, t.posMs], [true, "playing", 0, 3000]);
});

test("pausa que llegó tarde a Firebase: no vuelve para atrás", () => {
  // Se trabó en el tema 1 pero la pausa recién llegó con el tema 3 sonando
  const t = timeline(game({ pausedAt: s(65), heardUntil: s(3) }), s(100));
  assert.deepEqual([t.paused, t.index, t.posMs], [true, 2, 5000]);
});

test("después del último tema se queda esperando", () => {
  const t = timeline(game(), s(10000));
  assert.deepEqual([t.phase, t.index, t.last, t.playedCount, t.remainingMs], ["waiting", 9, true, 10, 0]);
});

test("pausa manual: no avanza solo", () => {
  const g = game({ config: { duration: 20, pause: 0, cols: 3 } });
  assert.equal(timeline(g, s(10)).phase, "playing");
  const t = timeline(g, s(500));
  assert.deepEqual([t.phase, t.index, t.playedCount], ["waiting", 0, 1]);
});

test("en pausa el tiempo se congela", () => {
  const g = game({ pausedAt: s(8) });
  const t = timeline(g, s(300));
  assert.deepEqual([t.phase, t.posMs, t.paused], ["playing", 8000, true]);
});

test("saltar al tema 6 (base movida)", () => {
  const g = game({ base: { index: 5, start: s(40) } });
  const t = timeline(g, s(45));
  assert.deepEqual([t.phase, t.index, t.playedCount], ["playing", 5, 6]);
  assert.equal(timeline(g, s(30)).playedCount, 5);
});

test("línea: fila completa con temas que sonaron", () => {
  const card = [10, 11, 12, 13, 14, 15, 16, 17, 18];
  const played = new Set([10, 11, 12, 15]);
  assert.deepEqual(checkClaim("line", card, [0, 1, 2], played, 3), { ok: true, cells: [0, 1, 2], wrong: [] });
  assert.deepEqual(checkClaim("line", card, [3, 4, 5], played, 3), { ok: false, reason: "not-played", wrong: [3, 4] });
  assert.equal(checkClaim("line", card, [0, 1, 4], played, 3).reason, "no-row");
});

test("bingo: incompleto, mal y bien", () => {
  const card = [10, 11, 12];
  assert.equal(checkClaim("bingo", card, [0, 1], new Set(card), 3).reason, "incomplete");
  assert.deepEqual(checkClaim("bingo", card, [0, 1, 2], new Set([10, 11]), 3).wrong, [2]);
  assert.equal(checkClaim("bingo", card, [0, 1, 2], new Set(card), 3).ok, true);
});

test("cantos: primera línea gana, la segunda no cuenta, el bingo termina", () => {
  const g = game();
  const players = {
    a: { roundId: "r1", card: [10, 11, 12, 13, 14, 15, 16, 17, 18] },
    b: { roundId: "r1", card: [10, 11, 12, 19, 18, 17, 16, 15, 14] },
  };
  const claims = {
    c1: { uid: "a", name: "Ana", type: "line", marked: [0, 1, 2], roundId: "r1", at: s(70) },
    c2: { uid: "b", name: "Beto", type: "line", marked: [0, 1, 2], roundId: "r1", at: s(71) },
    c3: { uid: "b", name: "Beto", type: "bingo", marked: [0, 1, 2, 3, 4, 5, 6, 7, 8], roundId: "r1", at: s(72) },
    c4: { uid: "a", name: "Ana", type: "bingo", marked: [0, 1, 2, 3, 4, 5, 6, 7, 8], roundId: "r1", at: s(400) },
    c5: { uid: "b", name: "Beto", type: "bingo", marked: [0, 1, 2, 3, 4, 5, 6, 7, 8], roundId: "r1", at: s(401) },
    viejo: { uid: "a", name: "Ana", type: "bingo", marked: [], roundId: "r0", at: s(1) },
  };
  const { results, lineWinner, bingoWinner } = resolveClaims(g, claims, players);
  assert.equal(lineWinner.name, "Ana");
  assert.equal(results.find((r) => r.id === "c2").verdict.reason, "line-taken");
  assert.equal(results.find((r) => r.id === "c3").verdict.reason, "not-played");
  assert.equal(bingoWinner.name, "Ana");
  assert.equal(results.length, 4); // c5 llegó después del bingo y "viejo" es de otra ronda
});

test("el veredicto del anfitrión manda", () => {
  const g = game();
  const players = { a: { roundId: "r1", card: [10, 11, 12, 13, 14, 15, 16, 17, 18] } };
  const claims = { c1: { uid: "a", name: "Ana", type: "line", marked: [0, 1, 2], roundId: "r1", at: s(1), verdict: { ok: true, cells: [0, 1, 2], wrong: [] } } };
  assert.equal(resolveClaims(g, claims, players).lineWinner.name, "Ana");
});

console.log(`\n${n} tests OK`);
