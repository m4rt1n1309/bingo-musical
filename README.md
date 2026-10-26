# 🎵 Bingo Musical

Bingo online de rock nacional, cumbia y pop latino. El anfitrión crea una sala y comparte el link; cada jugador entra desde su celular, **el mismo tema suena en todos los celulares a la vez** y cada uno marca en su cartón. Gana el primero que canta **línea** o **bingo**.

**Jugar:** https://m4rt1n1309.github.io/bingo-musical/

## Cómo funciona

No tiene servidor propio:

- **GitHub Pages** publica la página.
- **Firebase Realtime Database** (plan gratis) es la "pizarra" compartida de cada sala: jugadores, cartones, cantos y el punto de partida de la partida.
- Al empezar, el anfitrión fija el orden de los temas y la hora de arranque. Cada celular calcula solo qué tema toca en cada momento (`js/logic.js`), así que **la partida sigue aunque el anfitrión cierre la página**. Al anfitrión solo se lo necesita para pausar, saltear o arrancar otra ronda.
- Las líneas y los bingos se controlan con los mismos datos en todos los dispositivos. Si el anfitrión está conectado, deja asentado el resultado oficial de cada canto.
- Los fragmentos de 30 segundos salen de iTunes y están precalculados en `js/catalog.js`.

## Cómo se juega

1. **Anfitrión:** "Crear partida" → configurar → "Preparar canciones" → compartir el link por WhatsApp.
2. **Jugadores:** abren el link, ponen su nombre y tocan "Activar sonido". Si quieren, cambian el cartón antes de empezar.
3. El anfitrión toca **Empezar**. Los temas suenan solos, uno detrás de otro.
4. Cuando alguien canta una línea válida, le salen papelitos de colores en el celular y la música sigue sola. Al que canta bingo también le salen.
5. **Nueva ronda** reparte cartones nuevos sin que nadie tenga que volver a entrar.
6. Todos (jugadores y anfitrión) pueden escribir en el **chat** de la sala.

Si el anfitrión también quiere jugar, usa "Abrir mi cartón" o abre el link en otro dispositivo.

## Cambiar los temas

1. Editá `songs.js`.
2. Corré `npm run catalogo`. Busca en iTunes los temas nuevos y regenera `js/catalog.js`, y avisa si alguno no se encontró.
3. Subí los cambios a GitHub.

Para sacar temas del juego sin borrarlos de `songs.js`, corré `npm run temas`. Se abre una pantalla en la compu (http://localhost:8090) con todos los temas: destildá los que no querés y tocá **Guardar**. Quedan anotados en `excluidos.json`, el catálogo se arma de nuevo sin ellos y después hay que subir los cambios a GitHub. Esa pantalla no se publica: funciona solo en tu compu mientras el comando está corriendo.

## Desarrollo

- `npm run dev`: sirve la página en http://localhost:8080.
- `npm test`: tests de las reglas del juego.
- `database.rules.json`: reglas de seguridad de Firebase. Si las cambiás, publicalas con `npm run deploy-rules` (la primera vez, `npm run firebase-login` para entrar con la cuenta de Google del proyecto). También se pueden pegar a mano en la consola de Firebase (Realtime Database → Reglas → Publicar).
- `js/firebase-config.js`: datos del proyecto de Firebase. No son secretos.
