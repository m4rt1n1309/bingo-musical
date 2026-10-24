// Todo lo que habla con Firebase: identidad anónima, hora del servidor y datos de la sala.
//
// rooms/{código}/
//   host      uid del anfitrión (solo él puede tocar `game`, sacar jugadores y dar veredictos)
//   game      { status, roundId, config, pool, order, base, pausedAt, heardUntil, autoPaused, endedAt }
//   players/{uid}  { name, joinedAt, roundId, card }
//   claims/{id}    { uid, name, type, marked, roundId, at, verdict? }
//   chat/{id}      { uid, name, text, at }

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, get, set, update, push, remove, serverTimestamp, goOffline, goOnline,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export const configured = !!firebaseConfig.databaseURL && !firebaseConfig.apiKey.startsWith("PEGAR");

const app = configured ? initializeApp(firebaseConfig) : null;
const auth = app && getAuth(app);
const db = app && getDatabase(app);

// Diferencia entre el reloj de este dispositivo y el de Firebase, para que todos arranquen los temas juntos
let offset = 0;
if (db) onValue(ref(db, ".info/serverTimeOffset"), (snap) => { offset = snap.val() || 0; });
export const serverNow = () => Date.now() + offset;

// En los celulares a veces Firebase queda desconectado aunque haya internet (por ejemplo después de
// bloquear la pantalla) y tarda mucho en volver solo: si pasa un rato así, lo reconectamos a mano
if (db) {
  let connected = false;
  let lostAt = Date.now();
  onValue(ref(db, ".info/connected"), (snap) => {
    connected = !!snap.val();
    if (!connected) lostAt = Date.now();
  });
  const reconnect = (force) => {
    if (connected || !navigator.onLine || (!force && Date.now() - lostAt < 8000)) return;
    lostAt = Date.now();
    goOffline(db);
    goOnline(db);
  };
  setInterval(reconnect, 4000);
  addEventListener("online", () => reconnect(true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reconnect(true); });
}

// Avisa cuando este dispositivo pierde o recupera la conexión (con Firebase o con internet en general)
export const watchConnection = (cb) => {
  let fb = false;
  const emit = () => cb(fb && navigator.onLine);
  if (db) onValue(ref(db, ".info/connected"), (snap) => { fb = !!snap.val(); emit(); });
  addEventListener("online", emit);
  addEventListener("offline", emit);
};

export const signIn = () =>
  new Promise((resolve, reject) => {
    if (!auth) return reject(new Error("Falta configurar Firebase (js/firebase-config.js)."));
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) { stop(); resolve(user.uid); }
    });
    signInAnonymously(auth).catch(reject);
  });

// Después de mucho rato con la pantalla bloqueada, Firebase a veces rechaza lo que escribimos como si
// fuéramos otro (la identidad quedó vencida). Renovamos la identidad y probamos una vez más.
export const isDenied = (err) => /permission[_ ]denied/i.test(`${err && (err.code || "")} ${err && (err.message || "")}`);
const retryDenied = (write) => async (...args) => {
  try {
    return await write(...args);
  } catch (err) {
    if (!isDenied(err) || !auth.currentUser) throw err;
    await auth.currentUser.getIdToken(true);
    await new Promise((r) => setTimeout(r, 500));
    return write(...args);
  }
};

const roomRef = (code, sub = "") => ref(db, `rooms/${code}${sub ? `/${sub}` : ""}`);

// Sin letras que se confundan (0/O, 1/I)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
export const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const createRoom = async (uid) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCode();
    try {
      // Las reglas solo dejan escribir `host` si la sala no existe: si falla, el código estaba tomado
      await set(roomRef(code, "host"), uid);
    } catch {
      continue;
    }
    await set(roomRef(code, "game"), { status: "setup", createdAt: serverTimestamp() });
    return code;
  }
  throw new Error("No se pudo crear la sala. Probá de nuevo.");
};

export const roomExists = async (code) => (await get(roomRef(code, "host"))).exists();

export const watchRoom = (code, onRoom) => onValue(roomRef(code), (snap) => onRoom(snap.val()));

export const setGame = retryDenied((code, game) => set(roomRef(code, "game"), game));
export const updateGame = retryDenied((code, patch) => update(roomRef(code, "game"), patch));

export const savePlayer = retryDenied((code, uid, player) => set(roomRef(code, `players/${uid}`), player));
export const updatePlayer = retryDenied((code, uid, patch) => update(roomRef(code, `players/${uid}`), patch));
export const removePlayer = retryDenied((code, uid) => remove(roomRef(code, `players/${uid}`)));

export const pushClaim = retryDenied((code, claim) => push(roomRef(code, "claims"), { ...claim, at: serverTimestamp() }));
export const setVerdict = retryDenied((code, id, verdict) => set(roomRef(code, `claims/${id}/verdict`), verdict));
export const clearClaims = retryDenied((code) => remove(roomRef(code, "claims")));

export const pushChat = retryDenied((code, msg) => push(roomRef(code, "chat"), { ...msg, at: serverTimestamp() }));
export const clearChat = retryDenied((code) => remove(roomRef(code, "chat")));

export { serverTimestamp };
