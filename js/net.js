// Todo lo que habla con Firebase: identidad anónima, hora del servidor y datos de la sala.
//
// rooms/{código}/
//   host      uid del anfitrión (solo él puede tocar `game`, sacar jugadores y dar veredictos)
//   game      { status, roundId, config, pool, order, base, pausedAt, endedAt }
//   players/{uid}  { name, joinedAt, roundId, card }
//   claims/{id}    { uid, name, type, marked, roundId, at, verdict? }

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, get, set, update, push, remove, serverTimestamp,
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

export const signIn = () =>
  new Promise((resolve, reject) => {
    if (!auth) return reject(new Error("Falta configurar Firebase (js/firebase-config.js)."));
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) { stop(); resolve(user.uid); }
    });
    signInAnonymously(auth).catch(reject);
  });

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

export const setGame = (code, game) => set(roomRef(code, "game"), game);
export const updateGame = (code, patch) => update(roomRef(code, "game"), patch);

export const savePlayer = (code, uid, player) => set(roomRef(code, `players/${uid}`), player);
export const updatePlayer = (code, uid, patch) => update(roomRef(code, `players/${uid}`), patch);
export const removePlayer = (code, uid) => remove(roomRef(code, `players/${uid}`));

export const pushClaim = (code, claim) => push(roomRef(code, "claims"), { ...claim, at: serverTimestamp() });
export const setVerdict = (code, id, verdict) => set(roomRef(code, `claims/${id}/verdict`), verdict);
export const clearClaims = (code) => remove(roomRef(code, "claims"));

export { serverTimestamp };
