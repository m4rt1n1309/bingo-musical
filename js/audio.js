// Reproductor que arranca cada tema a una hora exacta del servidor, igual en todos los celulares.

// WAV silencioso cortito, para "desbloquear" el audio con el primer toque (los celulares lo exigen)
const silentWav = (() => {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples * 2, true);
  let bin = "";
  new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
  return `data:audio/wav;base64,${btoa(bin)}`;
})();

const STUCK_MS = 5000;

export const createSyncAudio = (serverNow) => {
  const el = new Audio();
  el.preload = "auto";
  let unlocked = false;
  let url = null;
  let startTimer = null;
  let retryTimer = null;
  let wanted = null; // { url, startAt } o null si no tiene que sonar nada

  const expectedOffset = () => (serverNow() - wanted.startAt) / 1000;

  const startNow = () => {
    if (!wanted) return;
    const offset = expectedOffset();
    if (offset < 0) {
      clearTimeout(startTimer);
      startTimer = setTimeout(startNow, -offset * 1000);
      return;
    }
    const go = () => {
      if (!wanted) return;
      el.currentTime = Math.max(0, expectedOffset());
      el.play().catch(() => {});
    };
    if (el.readyState >= 1) go();
    else el.addEventListener("loadedmetadata", go, { once: true });
  };

  const apply = () => {
    clearTimeout(startTimer);
    if (!unlocked) return;
    if (!wanted) {
      el.pause();
      return;
    }
    if (url !== wanted.url) {
      clearTimeout(retryTimer);
      url = wanted.url;
      el.src = url;
      el.load();
    }
    startNow();
  };

  // Si el tema no cargó (por ejemplo, se cortó internet), lo volvemos a pedir en un rato
  el.addEventListener("error", () => {
    if (!wanted || url !== wanted.url) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { url = null; apply(); }, 3000);
  });

  // Hasta dónde se escuchó el tema actual y cuándo se lo vio sonando bien por última vez (hora del servidor)
  let heard = null;

  // Corrige si el audio se desfasó (por ejemplo si tardó en cargar)
  setInterval(() => {
    if (!unlocked || !wanted || el.paused || el.readyState < 2) return;
    const drift = el.currentTime - expectedOffset();
    if (Math.abs(drift) > 0.6) el.currentTime = Math.max(0, expectedOffset());
  }, 1000);

  return {
    get unlocked() { return unlocked; },
    unlock() {
      if (unlocked) return Promise.resolve();
      el.src = silentWav;
      return el.play().then(() => {
        unlocked = true;
        el.pause();
        url = null;
        apply();
      });
    },
    // next: { url, startAt } del tema que tiene que sonar, o null
    update(next) {
      const changed = !next !== !wanted || (next && wanted && (next.url !== wanted.url || next.startAt !== wanted.startAt));
      wanted = next;
      if (changed) apply();
    },
    // Volver a arrancar (por ejemplo al volver a la pestaña, si el navegador cortó el audio)
    restart() {
      url = null;
      apply();
    },
    // Si el tema que debería sonar lleva unos segundos sin sonar (no cargó o se trabó),
    // devuelve hasta qué momento se llegó a escuchar; si no, null
    stuckAt() {
      if (!unlocked || !wanted) return null;
      const now = serverNow();
      if (now < wanted.startAt) return null;
      if (!heard || heard.startAt !== wanted.startAt) heard = { startAt: wanted.startAt, pos: wanted.startAt, okAt: wanted.startAt };
      if (url === wanted.url && (el.ended || (!el.paused && el.readyState >= 3))) {
        heard.pos = wanted.startAt + el.currentTime * 1000;
        heard.okAt = now;
      }
      return now - heard.okAt > STUCK_MS ? heard.pos : null;
    },
    // Prueba si el tema se puede bajar (y de paso queda en la caché del navegador)
    probe(src) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      return fetch(src, { mode: "no-cors", signal: ctrl.signal })
        .then((res) => res.blob())
        .finally(() => clearTimeout(timer));
    },
  };
};
