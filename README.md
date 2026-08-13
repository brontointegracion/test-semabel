# Sebel — prototipo navegable

Prototipo de la plataforma descrita en [REQUISITOS.md](./REQUISITOS.md). Sirve para
caminar el producto con alguien enfrente: no hay backend, todo vive en el navegador.

```bash
npm install
npm run dev      # http://localhost:5173
```

Ábrelo en el teléfono con la IP que imprime Vite, o en Chrome con el emulador móvil
(⌘/Ctrl + Shift + M). Está diseñado para pantalla de teléfono primero.

## Qué se puede recorrer

| Pantalla | Qué demuestra |
|---|---|
| **Ligas** | Las ligas del organizador, con el saldo de partidos disponible |
| **Nueva liga** | Condiciones → calendario propuesto → publicar. El generador de verdad, no una maqueta |
| **Liga** | Página pública: posiciones, calendario y goleadores, todo derivado de eventos |
| **Marcador** | La pantalla que reemplaza el marcador físico: números enormes, código corto para la tele, pantalla completa |
| **Consola del árbitro** | Anotar con una mano, deshacer y rehacer siempre visibles, registro de las últimas acciones |
| **Jugador** | Perfil acumulado y el momento de reclamarlo, que es donde se pide el consentimiento |
| **Cancha** | La cancha como entidad propia, con su agenda y sus ligas |
| **Saldo** | Saldo prepago de partidos, paquetes y medios de pago locales |

## Decisiones del spec que el código sí implementa

- **El marcador es una lista de eventos, nunca un número.** `src/lib/marcador.js`.
  El puntaje, la tabla y la estadística de cada jugador se calculan sumando eventos.
  Deshacer anula el último; rehacer lo revive; nada se borra.
- **Una franja de cancha se vende una sola vez.** `src/lib/calendario.js` y su prueba.
- **Ningún equipo juega dos veces el mismo día.**
- **Cobrar nunca pasa en la cancha.** El saldo se compra sentado; el partido lo consume solo.
- **Anotar el resultado a mano es gratis.** El saldo compra el vivo, no el derecho a existir.
- **Español primero.** La interfaz nació en español, no traducida.

## Dónde vive todo

```
src/
  db.js              Dexie sobre IndexedDB: las tablas que tendría el backend
  seed.js            Dos ligas de barrio en Panamá, con eventos reales simulados
  datos.js           Hooks de lectura (useLiveQuery): la UI se actualiza sola
  lib/marcador.js    Eventos, deshacer/rehacer, tabla de posiciones, estadística
  lib/calendario.js  Round-robin + reparto en franjas libres
  pantallas/         Una pantalla por archivo
```

## Datos

Se siembran solos la primera vez, relativos a hoy, así que siempre hay temporada en curso
y un partido en vivo que abrir. Para empezar de cero:

```js
// en la consola del navegador
indexedDB.deleteDatabase('sebel'); location.reload()
```

## PWA

`vite-plugin-pwa` genera manifiesto y service worker, también en desarrollo. Para probar
la instalación como app conviene usar el build:

```bash
npm run build && npm run preview
```

## Prueba del generador

```bash
node tools/probar-calendario.mjs
```

Verifica, de 4 a 12 equipos: todos contra todos sin repetir pareja, ninguna franja usada
dos veces, ningún equipo dos veces el mismo día, y que respeta franjas ya ocupadas por
otra liga en la misma cancha.
