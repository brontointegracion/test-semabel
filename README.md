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
| **Inicio** | La portada pública: la visión arriba, el país detectado solo, y filtros de provincia → deporte → *ahora mismo* / *lo que viene* |
| **Siguiendo** | Los equipos que sigue quien mira: cuándo juegan, dónde, cómo llegar y cómo les fue |
| **Equipo** | La página del equipo: puesto, forma, plantilla con números, resultados y el botón de seguir |
| **Figuras** | Máximos anotadores de la provincia, cruzando todas sus ligas |
| **Votaciones** | Dentro del partido: ¿quién gana? antes, jugador del partido después. Un toque, sin cuenta |
| **Noticias** | Últimas noticias, con una nota de pago que corta a la mitad |
| **Mis ligas** | Las ligas del organizador, con el saldo de partidos disponible |
| **Nueva liga** | Condiciones → calendario propuesto → publicar. El generador de verdad, no una maqueta |
| **Liga** | Página pública: posiciones, calendario y goleadores, todo derivado de eventos |
| **Marcador** | La pantalla que reemplaza el marcador físico: números enormes, código corto para la tele, pantalla completa. Deslizando hacia abajo: mejor anotador y quien más faltas cometió, por equipo |
| **Consola del árbitro** | Anotar y cargar faltas con una mano, deshacer y rehacer siempre visibles, registro de las últimas acciones |
| **Jugador** | Perfil acumulado y el momento de reclamarlo, que es donde se pide el consentimiento |
| **Cancha** | La cancha como entidad propia, con su agenda, sus ligas y cómo llegar |
| **Saldo** | Saldo prepago de partidos, paquetes y medios de pago locales |

## Las direcciones

Un link se comparte por WhatsApp, se lee antes de tocarlo y a veces se dicta. Por eso lleva
nombre y termina en un código corto, que es lo que de verdad identifica:

```
/p/halcones-vs-titanes-2026-08-14-7531    un partido, con su fecha
/l/liga-barrial-san-miguelito-4821        una liga
/j/luis-carrasco-3092                     un jugador
/e/halcones-1234                          un equipo
/c/cancha-don-bosco-1177                  una cancha
/n/el-barrio-que-aprendio-sus-numeros-2044   una noticia
/b/7531                                   el marcador, para escribir en el televisor
```

El nombre es solo para quien lee: la búsqueda va siempre por el código. Si un equipo se
renombra, los links viejos siguen funcionando. `src/lib/enlaces.js`.

## Quién ve qué

| | Invitado | Dueño de la liga |
|---|---|---|
| Portada, ligas, equipos, partido, jugador, figuras, votar, noticias | sí | sí |
| Mis ligas, crear liga, saldo, canchas | — | sí |
| Consola del árbitro | — | solo en sus ligas |

El botón **«Soy organizador»** arriba a la derecha entra como Miguel Robles, que organiza dos
de las seis ligas de ejemplo. Con **«Salir»** se vuelve a invitado. Abre el marcador de una
liga ajena estando dentro: el botón de llevar el marcador no aparece, porque ser organizador
no alcanza — hay que ser el de *esa* liga.

En el producto real, aquí va la sesión de verdad. Lo que no cambia es dónde se pregunta por
el permiso: `src/lib/sesion.js`.

## Decisiones del spec que el código sí implementa

- **El marcador es una lista de eventos, nunca un número.** `src/lib/marcador.js`.
  El puntaje, la tabla y la estadística de cada jugador se calculan sumando eventos.
  Deshacer anula el último; rehacer lo revive; nada se borra.
- **Una franja de cancha se vende una sola vez.** `src/lib/calendario.js` y su prueba.
- **Ningún equipo juega dos veces el mismo día.**
- **Cobrar nunca pasa en la cancha.** El saldo se compra sentado; el partido lo consume solo.
- **Anotar el resultado a mano es gratis.** El saldo compra el vivo, no el derecho a existir.
- **Español primero.** La interfaz nació en español, no traducida.
- **El sitio se restringe al país de quien mira.** Se detecta por IP; si eso falla, por la zona
  horaria del dispositivo. No se muestra ni se puede cambiar: nadie elige qué país ve. Dentro
  del país, el filtro es por provincia. `src/lib/region.js`.
- **La publicidad no toca el partido.** El espacio patrocinado vive en la portada y en
  noticias, nunca sobre el marcador.

## El color

Blanco y rojo, un solo tema. No hay modo oscuro: la aplicación se ve igual aunque el
teléfono esté en oscuro. Todo el rojo sale de dos variables al inicio de `src/styles.css`:

```css
--acento:     #D7263D;   /* rellenos, barras, estado en vivo */
--acento-ink: #A50F26;   /* texto rojo sobre blanco */
```

Cambiar esas dos líneas cambia la aplicación entera. El rojo del ícono está en
`tools/make-icons.mjs` (constante `ROJO`); después de tocarlo, `node tools/make-icons.mjs`.

## Dónde vive todo

```
src/
  db.js              Dexie sobre IndexedDB: las tablas que tendría el backend
  seed.js            Dos ligas de barrio en Panamá, con eventos reales simulados
  datos.js           Hooks de lectura (useLiveQuery): la UI se actualiza sola
  lib/marcador.js    Eventos, deshacer/rehacer, tabla de posiciones, estadística
  lib/calendario.js  Round-robin + reparto en franjas libres
  lib/reloj-calculo.js  La cuenta regresiva, sin base de datos: se puede probar
  lib/reloj.js       Arrancar, detener, ajustar y cerrar el período
  lib/sesion.js      Quién puede qué
  lib/enlaces.js     Direcciones legibles; el código es lo que identifica
  lib/mapas.js       Waze y Google Maps por coordenadas
  lib/seguir.js      Seguir equipos y jugadores, sin cuenta
  lib/votos.js       Votaciones; los votos ajenos son simulados y estables
  lib/meta.js        Título, descripción y datos estructurados por página
  pantallas/         Una pantalla por archivo
```

## Datos

Se siembran solos la primera vez, relativos a hoy, así que siempre hay temporada en curso
y un partido en vivo que abrir.

Ese partido está siempre en juego, nunca en pausa: el período en curso arranca con su tiempo
completo —10:00 en baloncesto— y el reloj corre hacia abajo. Los puntos que trae son los de
los períodos ya terminados; el que está jugándose empieza en cero, como corresponde a un
reloj sin usar.

Se recarga al abrir la app y cada vez que llega a cero (`mantenerPartidoEnVivo` en
`src/seed.js`), para que la demostración no dependa de cuándo se sembraron los datos. Con la
consola del árbitro abierta se desactiva: ahí el reloj es suyo.

Para empezar de cero:

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
node tools/probar-reloj.mjs
node tools/probar-enlaces.mjs
```

El primero verifica, de 4 a 12 equipos, que el calendario sea todos contra todos sin repetir
pareja, que ninguna franja se use dos veces, que ningún equipo juegue dos veces el mismo día
y que respete franjas ya ocupadas por otra liga.

El segundo verifica la cuenta regresiva: que detenido no corra, que corriendo baje segundo a
segundo, que llegue a cero sin pasarse y que 59.4s se vea como `01:00` y no como `00:59`.

El tercero verifica las direcciones: acentos y ñ fuera, que el número dentro de un nombre no
se confunda con el que identifica, y que sin fecha no se cuele un «undefined».
