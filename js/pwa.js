// Registra el service worker para que la página se pueda instalar como app en el celular.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* sin app instalable, la página anda igual */ });
}
