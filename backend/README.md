# Backend de ligas (Worker + Durable Object por liga)

Contrato de respuesta del endpoint de comandos
`POST /v1/ligas/{liga}/partidos/{juego}/comandos` (sobre inmutable + `Authorization: Bearer`).
El cliente decide por `tipo`/`resultado`, no por el texto ni por el código HTTP solo.

| Respuesta | Qué significa | Evidencia | Qué hace el cliente |
|---|---|---|---|
| `400` / `413` / `422` | Petición o sobre inválido. No se tocó nada. | Se valida antes de cualquier escritura. | Corregir; no es un reintento. |
| `401 {error:"no-autorizado"}` | Autorización fallida. Siempre idéntico: sin causa, sin recibo, sin conflicto. | La credencial se comprueba antes de leer recibos y se repite en la lectura protegida. | No reenviar con la misma credencial. |
| `200 {resultado:"rechazado", recibo}` | **Rechazo definitivo** del comando. Hay recibo durable y la secuencia se consumió. | Recibo guardado en la misma transacción. Un reintento devuelve el mismo recibo. | Flujo aprobado: releer estado, confirmar con la persona y crear un `cmdId` **nuevo**. |
| `200 {resultado:"aceptado"\|"recibo-existente", recibo, publicacion}` | Comando confirmado. `publicacion:"pendiente"` NO es un fallo: el mensaje está guardado y no se afirma ninguna entrega. | Recibo y efectos confirmados en una sola transacción. | Seguir. |
| `409 {tipo:"bloqueado"\|"secuencia-ocupada"\|"hueco"\|"conflicto-contenido"}` | Condición del comando, sin recibo nuevo. | Decisión del motor. | Según el tipo. |
| `500`/`503 {tipo:"fallo-sin-escritura", esteIntento:"sin-escritura", alcance:"solo-este-intento", motivo, reintento:"mismo-sobre"}` | **Fallo conocido de infraestructura**: ESTE intento no dejó ninguna escritura. No es un rechazo del comando. **No dice nada de intentos anteriores con el mismo `cmdId`**, que pudieron aceptarse. | Ver "Evidencia de `fallo-sin-escritura`" abajo. Un error SQL por sí solo no basta. | Reenviar el **mismo** sobre con el **mismo** `cmdId`. Nunca crear uno nuevo por esto. |
| `503 {tipo:"resultado-desconocido", reintento:"mismo-sobre"}` | No se puede probar si la confirmación se completó (fallo del cierre de la transacción, respuesta perdida o fallo de transporte Worker ↔ objeto). | Falta de evidencia. | Reenviar el **mismo** sobre con el **mismo** `cmdId`: un reintento autorizado devuelve el recibo original si se confirmó. |

### Evidencia de `fallo-sin-escritura`

- `interno`: el fallo ocurrió mientras solo se leía, o dentro de la transacción antes de la primera escritura
  (incluido un fallo al capturar los valores originales).
- `contencion`: los tres intentos terminaron en conflicto sin escribir.
- `reversion-verificada`: **la reversión la garantiza la plataforma** (si el callback de `transactionSync` lanza, la
  transacción se deshace). Además se **observan**, sin ningún `await`, estas coincidencias con lo capturado dentro de
  la misma transacción antes de la primera escritura: `rev`, cursor y recuentos del partido, el `estado_json` exacto
  y el JSON exacto de cada evento que la orden iba a actualizar. Esas comprobaciones **corroboran**; no demuestran el
  contenido de toda la base de datos ni la durabilidad en Cloudflare producción. Si alguna difiere o no puede
  hacerse, el resultado es `resultado-desconocido`.

Los errores públicos nunca llevan texto de errores internos, SQL, trazas, credenciales ni datos privados.
Un fallo posterior a la confirmación se responde con lo confirmado, no como fallo.
Cómo se decide cada caso: `src/clasificacion.js` y `src/adaptador-liga.js`.

## Admisión de ligas (`LIGAS_ADMITIDAS`)

Antes de buscar o crear cualquier Durable Object, el Worker comprueba que la liga de la dirección esté en una lista
**explícita** de la configuración: `LIGAS_ADMITIDAS="ID1,ID2"`.

- Cada ID es exactamente `[A-Za-z0-9_-]{1,64}`, sin espacios, y se compara por **igualdad exacta** (distingue mayúsculas;
  sin prefijos, subcadenas ni nombres para mostrar).
- **Falla cerrada:** si la variable falta, está vacía o está mal formada (un elemento inválido, una coma de más, más de
  100 IDs, un valor que no es texto), no se admite **ninguna** liga. No se admite "lo que sí es válido".
- Una liga no admitida recibe el mismo `404 {"error":"no-encontrado"}` que una ruta desconocida, con cualquier método,
  cabecera o cuerpo, y sin tocar el binding de Durable Objects. Aplica a lecturas, comandos y siembra. La lista no se
  expone en ninguna respuesta.
- **Admitir solo permite enrutar.** No autoriza a nadie y no prueba que la liga tenga datos: la autorización del
  partido y del dispositivo no cambia.
- La siembra sintética conserva sus propias puertas (`PERMITIR_SEMILLA` y secreto) y además exige que la liga esté
  admitida; no registra ligas.
- `wrangler.jsonc` deja la lista **vacía** (cerrada) en local y en `staging`; solo `env.production` lista las dos ligas del piloto. Las pruebas usan solo IDs sintéticos
  (`LIGA1`…`LIGA100`). Los IDs reales no están definidos en este repositorio.

## Acceso por códigos (piloto; sin correo verificado)

Política aprobada: un organizador con un **código privado**, y un **código por partido** que activa un solo teléfono.
Las direcciones (`/organizador`, `/control/…`) son solo navegación: ninguna lleva autoridad ni secretos.

| Qué | Cómo |
|---|---|
| Código | 20 caracteres de un alfabeto de 32 sin letras ambiguas, en 4 grupos de 5 (100 bits; 5 de id público + 75 de secreto). Aleatoriedad criptográfica; se guarda solo el hash SHA-256 (por tipo de uso); comparación en tiempo constante. Se muestra una vez. |
| Código del organizador | Válido **7 días** desde su emisión, reutilizable, rotable y revocable por el operador. |
| Sesión del organizador | Cookie `__Host-sesion` (`Secure; HttpOnly; SameSite=Strict`). **12 h** sin uso y **24 h** absolutas. Máximo **2** a la vez (una tercera cierra la menos reciente). |
| Código de partido | Se emite desde la sesión del organizador; **48 h** desde su emisión si no se usa. Uno nuevo revoca el que seguía sin usar. |
| Activación | El teléfono genera su token, lo guarda y manda **solo su hash**. Sirve **solo con el partido `programado`** y sin otro controlador activo. |
| Credencial del partido | **72 h** desde la activación para procesar comandos; **7 días más solo** para reintentos exactos de recibos guardados; después, nada. El final del partido, la hora programada, el día o la medianoche no la cambian. |
| Intentos fallidos | 5 fallos bloquean un código 10 min (se duplica, con tope); además un cubo por fuente (hash de la dirección de Cloudflare, solo para el cubo) corta los intentos masivos con 429. Todo fallo es el mismo `401 {"error":"no-autorizado"}`. |
| Cookie y CSRF | Escrituras con cookie: `Origin` exacto, `X-Sebel-Peticion: 1`, `application/json` y `Sec-Fetch-Site: same-origin` si el navegador lo envía. Sin CORS. |

**Recuperación tras una respuesta perdida.** Un código ya usado solo sirve para *recuperar la activación original* (mismo
hash, mismo dispositivo), en cualquier estado del partido y mientras la credencial no esté revocada ni pasado su horizonte
de 7 días extra. No crea controlador ni sube la versión de autorización. La caducidad de 48 h del código sin usar no se
aplica a esa recuperación. Un hash revocado no se puede volver a registrar.

**Sin traspaso.** Antes del inicio el organizador puede revocar y emitir otro código. Después del inicio no hay
sustitución, ni revocación de emergencia, ni liberación de un partido atascado: esas rutas no existen (la emisión y la
revocación devuelven `409 partido-iniciado`).

**Credencial en la ventana de 7 días (solo recibos).** Solo contesta un reintento *exacto* (mismo `cmdId` y contenido) de un
comando con recibo guardado, sea aceptado o rechazado de forma definitiva. Un sobre desconocido o distinto es el `401`
genérico: no se revela ningún recibo ni conflicto. Terminar el partido no revoca nada y las reglas del motor (puntos y
reloj rechazados, correcciones permitidas) no cambian.

**Organizador entre objetos (límite honesto).** Las sesiones viven en un objeto de acceso y los datos en el de la liga:
**no hay atomicidad entre ambos**. El punto de decisión es la lectura de validación en el objeto de acceso. Una
revocación ya confirmada antes de esa lectura la niega; **varias** peticiones validadas antes de la revocación pueden
terminar si llegan a la liga mientras la **edad de su afirmación** (`ahora de la liga − hora de validación`) no pase de
**5 s**. Esos 5 s son el límite de edad. La tolerancia de **1 s** NO añade tiempo a ese límite: solo admite una
afirmación con hora *posterior* a la del reloj de la liga (desfase entre los relojes de los dos objetos) hasta 1 s. La
liga comprueba la edad como primera sentencia de su transacción, antes de leer o escribir; si venció no escribe nada y
el Worker revalida **una sola vez**. Cada acción del organizador deja el id de sesión en la auditoría. Las credenciales
de partido no tienen esta ventana: viven en el objeto de la liga y su revocación es atómica con los comandos.

**Cerrado por defecto.** `ACCESO_ORIGEN` vacío o mal formado: las rutas del organizador no existen (404).
`ACCESO_ADMIN_HABILITADO` distinto de `1`, o `ACCESO_ADMIN_TOKEN` de menos de 32 caracteres: la provisión del operador no
existe. Ningún valor real está en el repositorio; los de las pruebas son sintéticos y solo están en `wrangler.test.jsonc`.
El secreto del operador se entrega como secreto de Cloudflare.

**Actualización del esquema.** Aditiva y por versiones (`meta.esquema`): una base creada con la versión 1 recibe los
`ALTER TABLE` y las tablas nuevas en una sola transacción y conserva sus filas (las credenciales sembradas quedan sin
expiración). `CREATE TABLE IF NOT EXISTS` no añade columnas, por eso no basta.

**Cuerpos de petición acotados.** Todas las rutas leen el cuerpo por flujo con un contador de **bytes** (`src/cuerpo.js`):
4 KiB en las rutas de acceso y 64 KiB en los comandos. `Content-Length` solo es una pista temprana; al superar el límite
se deja de leer y se cancela el flujo (413 `cuerpo-demasiado-grande`). JSON mal formado, UTF-8 inválido o un flujo roto
dan 400 `json-invalido`. Nunca se registra ni se devuelve contenido del cuerpo.

**Contadores temporales por fuente (límite de almacenamiento).** Cada objeto (acceso y liga) guarda como mucho
**500 fuentes activas + 1 fila compartida de desbordamiento = 501 filas** en `limite_fuente`. Las filas vencidas (ventana de
10 min) se borran en la misma transacción. Con el tope lleno, una fuente nueva cuenta en el cubo de desbordamiento con el
mismo umbral (20 fallos): no se expulsa ninguna fila activa, no se reinicia la cuenta de nadie y la protección no se
apaga. **Limitación de disponibilidad:** si muchas fuentes nuevas fallan a la vez, el cubo compartido se llena y todas
las fuentes nuevas reciben 429 hasta que acabe su ventana. Lo mismo ocurre, en menor escala, con el umbral de 20 fallos por
dirección: teléfonos y organizador que **comparten una dirección** (wifi del recinto, red móvil con NAT) comparten
también ese cubo, y si falta la cabecera de dirección de Cloudflare todos caen en el mismo cubo `desconocida`. Los umbrales
no se han cambiado; hay que revisarlos antes del piloto real. Cada intento fallido lee hasta ~500 filas de este cubo.

## Plantilla compartida (organizador) y lectura de preparación del teléfono

Solo con conexión: **no existe ninguna cola ni borrador de plantilla en el servidor** (el cuerpo solo admite las claves listadas;
cualquier campo de cola, borrador u hora del cliente es un 422). La lista blanca de claves **no prueba** que haya conexión: el
cliente que escriba debe mostrar «Se requiere conexión a internet para esta acción.» y no guardar nada local como si fuera compartido.

| Ruta (cookie de sesión; las que escriben exigen además Origin exacto, `X-Sebel-Peticion: 1` y JSON) | Qué hace |
|---|---|
| `GET /v1/organizador/ligas/{liga}` | liga y equipos, con `bloqueada` y conteos de activos/inactivos |
| `GET …/equipos/{equipo}/jugadores` | plantilla (activos e inactivos) con los campos privados del organizador, `rev` de cada ficha y `bloqueada` |
| `POST …/equipos/{equipo}/jugadores` | alta |
| `POST …/jugadores/{ficha}/editar` · `/desactivar` · `/reactivar` | edición, baja y reactivación (con `revEsperada`) |
| `GET /v1/ligas/{liga}/partidos/{juego}/preparacion` (Bearer del partido) | `{ preparacion, etiquetas, rev, ultimoClientSeq }` |

No hay ruta ni método para **borrar** una ficha: desactivar la conserva (y libera su número).

**Reglas.** Las de negocio (campos, número 0–99 obligatorio, `numeroPendiente` solo si es `undefined`/`false`, duplicados, reactivación)
son `src/lib/roster-reglas.js`, la misma definición que usa la plantilla local; aquí no se repiten. Registrar exige un número;
las fichas **anteriores** sin número válido (sembradas) no se editan ni reactivan sin darles uno, y el inicio del partido sigue
exigiendo números válidos y únicos entre los activos: son dos cosas distintas (registro frente a preparación).

**Bloqueo.** Un equipo no admite alta, edición, baja ni reactivación mientras CUALQUIERA de sus partidos (local o visitante)
esté `vivo`: el estado se queda en `vivo` durante las pausas y los descansos entre periodos. `programado` (aunque la hora
programada ya haya pasado) y `final` no bloquean. Un estado desconocido o ausente **bloquea**; un `estado_json` ilegible deshace la
operación (503). Cada operación corre en una `transactionSync` del mismo objeto de liga que decide el inicio, así que ambos se
ordenan: el inicio compara la huella de preparación vigente al confirmar (una edición previa que cambie números o activos lo
hace rechazar de forma definitiva), y una edición posterior al inicio se rechaza con `equipo-bloqueado`. Esto es una propiedad de
esa ejecución sincrónica, demostrada por las pruebas con datos sintéticos; no se ha probado en Cloudflare.

**Orden de una operación** (todo sincrónico): afirmación del organizador vigente (primera sentencia) → recibo previo de
`(organizador, operación)` → alcance → bloqueo → revisión esperada → reglas, identidad y número → cambio + auditoría + recibo.
Una excepción deshace todo.

**Recibos.** La clave es `(organizador_id, operacion_id)`; guardan liga, tipo, destino y la huella del contenido exacto.
Un reintento exacto devuelve el resultado original **antes** de buscar candidatos, leer otras ligas, mirar el bloqueo o validar
contra la plantilla actual (`reproducido: true`); también se repite igual un rechazo ya decidido, aunque el bloqueo haya terminado.
El mismo identificador con otro contenido, destino o tipo es `409 operacion-conflicto` sin datos. Conocer un `operacionId` no da
acceso: antes de revelar nada se valida la sesión, la posesión de la liga (en el objeto de acceso) y la afirmación (en la liga);
otro organizador tiene su propio espacio de identificadores. Tras un rechazo **conocido**, la corrección lleva un identificador nuevo.
Un fallo desconocido (503 `resultado-desconocido`) se reintenta con la misma solicitud y el mismo identificador. Los recibos guardan
datos privados del organizador (la ficha); no se registran ni se envían al teléfono. No hay política de retención todavía.

**Afirmación.** Igual que en `codigos-partido.js`: vale 5 s (más 1 s de tolerancia hacia el futuro) y no hay atomicidad entre el
objeto de acceso y el de liga. Varias peticiones validadas antes de una revocación pueden terminar dentro de esa ventana. Si
caduca, el Worker revalida una vez; si vuelve a caducar, 503 `fallo-sin-escritura` (`asercion-vencida`). El id de sesión queda en
auditoría y recibo.

**Identidad entre ligas.** Una persona real conserva UN `personaId` en sus fichas de cada liga del mismo organizador.
- Altas sin resolución: se buscan candidatos por **nombre normalizado** (sin mayúsculas ni acentos) en la misma liga y en las demás
  ligas del organizador. Con candidatos, el alta se detiene (`candidatos`, solo edad, nunca fecha de nacimiento) sin escribir.
  Sin candidatos en ninguna liga se crea una identidad nueva (`pr-…`, aleatoria); la auditoría guarda qué ligas se consultaron.
- `otra-persona`: decisión explícita de crear una identidad nueva. `misma-persona`: solo con un `personaId` que ya tenga ficha en
  ESTA liga. `misma-persona-otra-liga {ligaOrigenId, fichaOrigenId, personaId}`: el Worker lee la ficha de la liga de origen (con
  la misma afirmación) y la liga de destino exige que la evidencia coincida con lo pedido. El cliente no puede enviar esa evidencia.
- Si no se puede leer una liga necesaria, **no se crea nada** (503 `identidad-no-verificable`, sin recibo); el reintento exacto de
  algo ya decidido no necesita las otras ligas.
- **Límites.** Leer otra liga y escribir en esta no es atómico: dos altas concurrentes de la misma persona, o un alta mientras otra
  liga la añade, pueden no verse y dejar dos identidades. El nombre solo **sugiere**: otra grafía, o una ficha anterior sin partes
  de nombre, no coincide. Una ficha y su persona no se borran ni cambian, por eso la comprobación de un vínculo no caduca. No hay
  forma de deshacer un vínculo erróneo (separar/unir queda fuera). Los `personaId` de una carga real revisada no deben empezar por `pr-`.

**Lectura de preparación del teléfono.** Solo con una credencial **activa** de ESE partido (una en recuperación solo repite recibos
guardados: 401 genérico aquí). Se resume el token (único `await`) y en un tramo sincrónico se relee la credencial y se leen la
preparación, las etiquetas, `rev` y `ultimoClientSeq`. `preparacion` es el contexto del motor, íntegro; `etiquetas` (nombre en
camiseta si lo hay, si no el nombre completo, solo activos) va fuera para no romper su comprobación. El estado del partido y los
nombres de equipo salen de la lectura pública. Un rechazo definitivo del inicio por huella vieja consume su secuencia; la
recuperación exige este refresco, la confirmación de la persona y un `cmdId` nuevo con `clientSeq = ultimoClientSeq + 1`. El
cliente conserva sus etiquetas históricas: el refresco solo trae activos. No recompone el estado de un partido en curso (eso no existe).

**Datos de prueba.** Los campos opcionales de ficha de `/v1/_semilla` existen solo para pruebas sintéticas; no son ni autorizan un
procedimiento de carga de datos reales.

## Estado autoritativo para el teléfono que controla el partido

`GET /v1/ligas/{liga}/partidos/{juego}/estado` (Bearer del partido; solo GET). Código: `src/lectura-estado-control.js`. Solo lee: no escribe ninguna fila.

**Respuesta (lista blanca; nunca filas ni el estado del motor tal cual).**

| Campo | Origen | Para qué |
|---|---|---|
| `version` | constante (1) | versión del contrato de esta lectura |
| `gameId`, `deviceId` | el partido y el dispositivo de la credencial autenticada | `crearCola`, `construirSobre` |
| `servidorAhoraMs` | reloj del servidor, tomado dentro del tramo protegido | estimar el desfase de hora del teléfono |
| `credencial.expiraEn` / `retornoHasta` | `credenciales` | cuándo deja de procesar órdenes y cuándo deja de repetir recibos (nulos si la credencial no caduca) |
| `cursor.rev` / `cursor.ultimoClientSeq` | `partidos` | el par con el que se reanuda la cola (`crearCola`, `reanudar`) |
| `partido.ligaId/localId/visitaId` | `partidos` | qué equipo es local |
| `estado.config` | `estado_json.config` (lo que usan las reglas) | `deporte` y `minutosPorPeriodo`, **tal cual y también nulo** |
| `estado.partido` | `estado_json.partido` | `estado`, `inicio`, `relojEstado`, `relojRestante`, `relojDesde` |
| `estado.auditSeq/corridaSeq/cursorReloj` | `estado_json` | órdenes de reloj y parada automática |
| `estado.eventos` | `eventos`, por `seq`, con todas las anuladas | `id, partidoId, seq, tipo, equipoId, jugadorId, puntos, periodo, anulado, creadoEn` y, si existen, `anuladoEn, anuladoRev, rehacerBloqueado` |
| `atribucion` | `crearAtribucion` (contexto del motor) | `{ version, equipos, jugadores }`; el cliente la verifica con `atribucionIntegra`. `null` si el partido no tiene equipos válidos (el motor rechaza entonces los puntos nuevos) |
| `etiquetas` | `jugadores` | `[{ id, etiqueta }]`, **solo para mostrar y fuera de la atribución** |

`estado` es la forma de `crearEstado` sin `rev` (la revisión vive solo en `cursor.rev`). No hay filas de auditoría del reloj: el motor solo necesita `auditSeq`.

**Etiquetas.** Los jugadores ACTIVOS de los dos equipos y los referenciados por los eventos de ESTE partido, también si se desactivaron después (las fichas no se borran). Nombre en camiseta si lo hay; si no, el nombre completo guardado; `null` para una ficha anterior sin ninguno. Un jugador inactivo y sin eventos no aparece (sí figura en `atribucion` con `elegible: false`). Nunca partes del nombre, fechas de nacimiento, contactos, `personaId`, códigos, hashes, recibos, auditoría, bandeja ni nada de otros partidos. Los `id` de los eventos de puntos y faltas se derivan del `cmdId` de su orden y SÍ se envían; no se afirma que ningún texto derivado de un `cmdId` esté ausente.

**Autorización y consistencia.** La liga se admite antes de enrutar al Durable Object. Se resume el token (único `await`) y en UN tramo sincrónico se relee la credencial: debe ser ACTIVA, de ESTE partido, no revocada. Una credencial en recuperación (pasó la hora de procesar órdenes pero sigue el horizonte de recibos), vencida, revocada, de otro partido o desconocida recibe el mismo 401 `no-autorizado`, igual que un partido desconocido; la cookie del organizador no sirve. Todos los campos salen de ese mismo tramo, que no se intercala con la confirmación de una orden. Respuestas `no-store`.

**Topes provisionales (507 `estado-demasiado-grande`).** Más de **4 000 eventos** (se cuenta ANTES de armar la instantánea) o más de **1 MiB** de respuesta serializada medida en **bytes UTF-8**. Son salvaguardas de disponibilidad, **no evidencia de que todas las partidas reales quepan**: el motor no limita los eventos por partido ni las plantillas, y estas cifras salen de estimaciones sintéticas (de 173 a 598 bytes por evento según el largo de los identificadores). Se aplican DESPUÉS de autorizar, así que no revelan nada a quien no está autorizado, y nunca devuelven una instantánea truncada. Superarlos **solo bloquea esta hidratación**; el manejo de órdenes (`/comandos`) no cambia.

**Qué NO resuelve (contrato de recuperación).**
- Una instantánea **no resuelve una orden de resultado incierto**. No hay recibos aquí y `rev`, `ultimoClientSeq` o los totales NUNCA prueban que una orden concreta se aceptó: un rechazo definitivo también consume su secuencia. La orden incierta se resuelve repitiendo su sobre ORIGINAL inmutable con su `cmdId`, que devuelve el recibo original (también con la credencial en recuperación, y aunque la plantilla haya cambiado después). Nunca se reconstruye un sobre sin resolver a partir del estado refrescado.
- Con una cola local no vacía, primero se resuelven los envíos en vuelo repitiendo sus sobres y solo después se hidrata o se compara; si el servidor va por delante sin que ningún envío lo explique, es un fallo de almacenamiento local, no una aceptación.
- Ante un rechazo definitivo la cola se detiene y se conservan las órdenes dependientes; no se reenvían solas. La recuperación sigue siendo: refrescar, confirmación de la persona y `cmdId` nuevo.
- No recupera las órdenes que el teléfono perdió (cola o token borrados): sin token no hay lectura; con token pero sin cola, la instantánea solo da una base nueva.
- **La recuperación cuando se pierde el sobre del inicio queda diferida:** esta lectura no autoriza puntuar en ese escenario. El inicio requiere conexión y aceptación confirmada del servidor; la puntuación sin conexión se permite solo después. Esta tarea no añade comportamiento de cliente.

**Configuración de periodos.** `config.minutosPorPeriodo` se devuelve como está (nulo incluido). Con nulo el motor usa los valores de respaldo del prototipo (`MINUTOS_POR_PERIODO`: 10 min baloncesto, 20 min futsal) al iniciar; **no son duraciones aprobadas para el piloto real** y no existe ninguna ruta para escribirlas.

Pruebas: `test/estado-telefono.check.js` (datos sintéticos; sin Cloudflare).

## Aplicación y API en el mismo origen (archivos estáticos del Worker)

`wrangler.jsonc` declara `assets` (carpeta `../dist`, `not_found_handling: single-page-application`,
`run_worker_first: ["/v1/*"]`):

- Las navegaciones del navegador a rutas de la aplicación (por ejemplo `/anthony/access`) se sirven como archivos
  estáticos (las que no son un archivo reciben `index.html`). Los archivos estáticos no cuentan como peticiones del Worker.
- Todo `/v1/*`, sea `fetch` o navegación, entra primero al Worker, que responde su propio JSON: una ruta de la API que no
  existe da un 404 JSON, nunca la página de la aplicación.
- La aplicación para publicar se compila en **modo compartido**: `VITE_MODO_COMPARTIDO=1 npm run build` en la raíz. En ese
  modo no hay rol de organizador local ni datos de demostración, y las pantallas públicas del prototipo no se montan
  (se muestra "en preparación") hasta que las lecturas públicas vengan del servidor.
- Encabezados de los archivos estáticos: `public/_headers` (se copia a `dist`). No se aplican a lo que genera el Worker,
  que ya pone los suyos. Si `_headers` también se aplica a la respuesta de la caída a `index.html` hay que comprobarlo en
  Cloudflare. Los encabezados de las cargas dependen de que la política CSP (`connect-src` permite la búsqueda de región
  `https://ipwho.is`) se compruebe con el navegador real.
- `wrangler dev` y el despliegue necesitan que `../dist` exista. `scripts/humo-local.mjs` usa una carpeta temporal.

### Producción (`env.production`; preparado, NO desplegado)

Un solo Worker `semabel-production` (nombre estable: el espacio de Durable Objects pertenece al nombre; no cambiarlo después) sirve la
aplicación, `/v1/*` y los objetos `LigaDO`/`AccesoDO` (SQLite) en `https://semabel.com` (dominio personalizado). `workers_dev` y
`preview_urls` están en `false`. Variables: `LIGAS_ADMITIDAS=PLATINIUM-U10,PLATINIUM-U12`, `ACCESO_ORIGEN=https://semabel.com`,
`ACCESO_ADMIN_HABILITADO=0` (puerta del operador cerrada), `PERMITIR_SEMILLA=0`. `vars` y `durable_objects` no se heredan entre entornos
y se declaran en el entorno; `migrations` (v1, v2) se heredan del nivel superior y no se repiten. Secreto (nunca en archivos):
`ACCESO_ADMIN_TOKEN`, solo cuando se abra una ventana de carga.

**Compilación de la interfaz (desde la RAÍZ del repositorio; sale en `dist/`, que Wrangler lee como `../dist`):**

    rm -rf dist
    VITE_MODO_COMPARTIDO=1 VITE_LIGAS_PUBLICAS=PLATINIUM-U10,PLATINIUM-U12 VITE_PAIS_PILOTO=PA npm run build

(`VITE_LIGAS_PUBLICAS` debe coincidir con `LIGAS_ADMITIDAS`.) El `dist/` que haya en el árbol puede ser antiguo: compilar siempre antes de desplegar.

**Comprobación local sin red ni cuenta** (desde `backend/`): `node_modules/.bin/wrangler deploy --dry-run --env production --outdir RUTA-FUERA-DEL-REPO`
debe listar los dos objetos y las cinco variables anteriores. Despliegue (manual, por el usuario): siempre con `--env production`; sin
`--env` se publicaría la configuración local. No usar `wrangler.test.jsonc` ni `env.staging` (activa la siembra).

## Carga del operador y ejecutor local de plantillas (herramientas de carga; SOLO sintético hasta nueva autorización)

**Carga del operador** (`src/carga.js`, `src/rutas-carga.js`). Dos llamadas, ambas con el Bearer del operador (`ACCESO_ADMIN_TOKEN`; la
misma puerta que la provisión: `ACCESO_ADMIN_HABILITADO=1` y secreto de 32+ caracteres; si no, la ruta no existe). Una cookie de
sesión de organizador no sirve. Orden: puerta del operador → liga **admitida** (404 si no, antes de cualquier objeto) → POST → Bearer
(401) → cuerpo acotado por bytes → validación completa (422 con códigos fijos, sin eco) → liga.

| Ruta | Qué hace |
|---|---|
| `POST /v1/admin/ligas/{liga}/estructura` | `{ cargaId, liga:{ id, nombre, deporte:"baloncesto", categoria?, subcategoria?, minutosPorPeriodo? }, equipos:[{ id, nombre }] }` (≤100 equipos, 32 KiB). Una transacción: liga + equipos + recibo. Sin jugadores, credenciales ni organizadores. La duración del periodo es opcional aquí. |
| `POST /v1/admin/ligas/{liga}/partidos` | `{ cargaId, minutosPorPeriodo, partidos:[{ id, localId, visitaId, programadoPara?, sede? }] }` (≤100 por lote, ≤300 por liga, 48 KiB). `minutosPorPeriodo` es **obligatorio y explícito** (1–120) y se copia al estado de cada partido; no puede contradecir la duración de la liga ni la de partidos ya creados. `programadoPara`: ISO con zona explícita y fecha real, guardada en UTC. Cada partido nace con el estado canónico del motor (`programado`) y su resumen público 0-0 derivado por la misma función que el commit. |

Reglas: campos estrictos; IDs `[A-Za-z0-9_-]{1,64}`; nombres de equipo únicos sin distinguir mayúsculas/recortes (como `NuevaLiga`);
rivales distintos y existentes; clasificación con `resolverClasificacion`. **Idempotencia**: `cargaId` (16–64 caracteres) + huella del
contenido normalizado (claves y listas ordenadas, instantes en UTC) en la tabla `cargas` (esquema **v6**, aditiva): mismo id y contenido →
200 `reproducido:true` sin escrituras; mismo id con otro contenido (o con otro tipo) → 409 `carga-conflicto`; otro `cargaId` sobre una liga ya
cargada → 409 `liga-ya-cargada`; un partido existente → 409 `partido-existente`. Nunca se sobrescribe ni se edita nada; no hay API de
reprogramación. Un fallo a mitad deshace la transacción entera y responde `503 resultado-desconocido` (repetir la MISMA carga es seguro).
Marcha atrás del despliegue: la tabla `cargas` es aditiva y el código anterior la ignora; no hay migración inversa.

**Ejecutor local de plantillas** (`scripts/runner-plantilla.mjs`, lógica en `scripts/lib/runner-plantilla.js`). Consume `paquete.json`
revisado + un **mapeo explícito** (`{ version:1, paqueteSha256, ligas:{ "<liga del paquete>":{ ligaId, equipos:{ "<team_key>":"<equipoId>" } } },
identidades:{ "<source_ref>": <resolucionIdentidad> } }`). El hash del paquete del mapeo debe coincidir.

- **Simulacro por defecto**: `node scripts/runner-plantilla.mjs --paquete P --mapeo M` — sin red y sin escribir archivos; imprime un
  resumen sin nombres (listas / retenidas / excluidas, operaciones, alias, problemas).
- **Aplicar**: `--aplicar --origen http://127.0.0.1:PUERTO --acceso-origen https://<ACCESO_ORIGEN configurado> --diario RUTA`; por omisión
  el origen solo puede ser `127.0.0.1`, `[::1]` o `localhost` (destino de producción: ver «Herramientas de carga de producción», `--remoto`). **Verificar**: lo mismo con `--verificar`.
- **Credencial** (código del organizador, que el operador ya provisionó; el ejecutor nunca provisiona): variable `SEBEL_CODIGO_ORGANIZADOR` o
  `--codigo-archivo` (permisos 0600). Nunca por argumentos (se rechaza), direcciones, diario ni salida. Se usa la sesión y el CSRF de siempre.
- **Solo filas `ready`**; retenidas y excluidas se contabilizan y los totales deben cuadrar. Todo se valida antes de empezar; una sola decisión
  de identidad ausente impide aplicar NADA. Cada fila exige su `resolucionIdentidad` en el mapeo (`otra-persona`, `misma-persona`,
  `misma-persona-otra-liga`): nunca se deduce "persona nueva" de que no haya candidatos, ni se fusiona por nombre o número. `shirt_name` →
  `nombreCamiseta` (sin tocar nombre ni apellido); la fecha de nacimiento no se copia.
- **Operación**: `operacionId = op-` + 40 hex de SHA-256(liga destino, equipo destino, `source_ref`) — ni hora, ni orden, ni número.
- **Diario** (privado: contiene los cuerpos exactos; fuera de cualquier repositorio, modo 0600, ≤2 MiB, ≤500 operaciones): se guarda completo
  antes de enviar; antes de cada envío se anota `enviando` (si no se puede guardar, no se envía); tras cada respuesta se guarda el resultado
  (con los `fichaId`/`personaId` acuñados). Respuesta perdida, red caída, 401/5xx o cuerpo inesperado → `incierta`: se detiene y la siguiente
  ejecución reintenta **primero** esa operación con el **mismo cuerpo e identificador**. Un rechazo (número ocupado, identidad inválida,
  conflicto) detiene y el diario se niega a continuar hasta decidir a mano. Nunca se borra nada ni se crea un identificador de reemplazo.
- **Verificación**: lee del organizador y del público; cada ficha del diario (por su identificador acuñado) debe tener nombre, apellido, número
  y alias esperados, números únicos por equipo, nombre del equipo, partidos públicos válidos y ningún campo privado en las lecturas públicas.

Pruebas: `test/carga.check.js`, `test/runner-plantilla.check.js` y el humo por HTTP real `node scripts/humo-carga.mjs` (workerd local, datos
sintéticos). Este mecanismo NO está autorizado para datos reales ni para Cloudflare hasta una orden aparte.

### Appending teams to an already loaded league (REPORT_169)

The initial structure load (`/estructura`) never extends a league (`liga-ya-cargada`); to add teams to a populated league use the operator route below. It reuses the
same door as the other operator loads (gate `ACCESO_ADMIN_HABILITADO=1` + 32+ char secret, league in `LIGAS_ADMITIDAS`, Bearer of the operator; an organizer cookie does not work).

| Route | Body | Responses |
|---|---|---|
| `POST /v1/admin/ligas/{liga}/equipos` | `{ cargaId, equipos:[{ id, nombre }] }` (1–100 teams, 32 KiB; `cargaId` 16–64 chars, **new**, distinct from the structure/games loads) | `201 { ok, cargaId, tipo:"equipos", ligaId, agregados, equipos, totalEquipos, reproducido:false }`; exact replay `200 …reproducido:true` (the ORIGINAL response, even if the league grew since); `409 carga-conflicto` (same `cargaId`, different content or another load type); `409 liga-sin-estructura` (league not initialised: nothing is created); `409 equipo-existente`, `409 nombre-existente` (case-insensitive), `409 clave-publica-ambigua`, `409 liga-demasiado-grande` (more than 100 teams); `422 payload-invalido` with fixed codes (`equipos.id-duplicado`, `equipos.nombre-duplicado`, `equipos.clave-ambigua`, …); `503 resultado-desconocido` → repeat the SAME load |

- **Atomic and additive:** the whole batch is validated first; the new teams and the idempotency receipt (`cargas`, type `equipos`; no schema change) are written in ONE transaction. A rejected or failed batch leaves no partial insert and no receipt. The league row, existing teams, players, people, games, scoring state and organizer ownership are never touched.
- **Collisions:** team ids are compared exactly and case-insensitively; names with the same trim/lower-case rule as the structure load; and a team is rejected if its **public key** (id without the `{liga}-` prefix, lower-case; same rule as `src/lib/publico/claves.js`) equals the key or the id of another team in the league (the public team URL would be ambiguous). Only pairs involving a NEW team are checked, so a pre-existing ambiguity does not block an append.
- **Tool:** `node scripts/operador-carga.mjs equipos --equipos LIGA_ID=append.json [--equipos …]` is a dry-run by default (no requests, no files). Apply with `--aplicar --remoto --origen https://semabel.com --diario NEW-PRIVATE/journal.json` (same exact-origin, TLS, timeout, no-redirect, secret-file and write-ahead-journal rules as the other commands). The journal stores the exact body; after a lost/uncertain response the next run resends the IDENTICAL body and `cargaId` and the server replays it. A 409/422 stops the run and the journal refuses to continue. Use a NEW journal for a new run; never reuse a local-rehearsal journal.
- **Initial structure payloads no longer describe the complete team set after an append.** The original `/estructura` payload still describes only the original teams (and the server still replays it exactly). Verify the complete league with `verificar --estructura INITIAL.json --equipos LIGA=append.json --leer …`: the expected set is the initial teams PLUS the appended ones and must match EXACTLY. Verifying the initial structure alone after an append correctly FAILS (unexpected teams); verifying only `--equipos` checks that the appended teams are present with their exact names but does not claim the league is complete.
- **Loading order for added teams:** (1) open the operator gate for the window; (2) `equipos` append per league; (3) `verificar … --leer`; (4) roster runner (`runner-plantilla.mjs --aplicar --remoto`) for the new teams with their identity decisions, then `--verificar`; (5) close the gate. Games involving the new teams use the existing `partidos` command (the tool cross-checks team ids against `--estructura` + `--equipos`).

### Herramientas de carga de producción (REPORT_163; implementadas y probadas SOLO con datos sintéticos y transporte simulado)

Tres piezas, todas con **simulacro por defecto** (sin red, sin escrituras) y sin dependencias nuevas:

| Pieza | Para qué |
|---|---|
| `scripts/runner-plantilla.mjs` | Plantillas (rosters), como antes. Añade `--remoto` y `--tiempo-ms`. |
| `scripts/operador-carga.mjs` (+ `lib/operador.js`) | Provisión del organizador, recuperación del código, estructura de ligas, lotes de partidos (aparte) y lectura de comprobación. |
| `scripts/lib/transporte.js` | Destino, entorno TLS, redirecciones y tiempos (compartido). |

**Reglas de transporte (ambas herramientas).** Por omisión solo loopback. Un destino remoto exige `--remoto` Y `--origen https://semabel.com`
(texto exacto: se rechazan otro esquema, puerto, credenciales, ruta, mayúsculas, subdominios y cualquier otro host; no hay lista configurable).
Con `--remoto` no se ejecuta si `NODE_TLS_REJECT_UNAUTHORIZED=0` ni con `NODE_EXTRA_CA_CERTS`. Cada petición va solo a ese origen, con
`redirect: 'manual'` y tiempo máximo (15 s por omisión; `--tiempo-ms` 1000–60000); una redirección (3xx) es un fallo y **nunca se sigue**, así
que ni la cookie ni el Bearer se reenvían. Un fallo en una mutación queda «incierto»; el reintento reenvía lo idéntico (mismo cuerpo, mismo
`cargaId`/`operacionId`, tomados del diario), nunca con otro identificador. Con `--remoto`, el `--acceso-origen` del ejecutor de plantillas debe
ser el mismo origen. **No cambia la autenticación ni la autorización del servidor.**

**Credenciales.** Token del operador: variable `SEBEL_OPERADOR_TOKEN` o `--token-archivo RUTA` (permisos 0600). Código del organizador:
`SEBEL_CODIGO_ORGANIZADOR` o `--codigo-archivo RUTA` (0600). Nunca por argumentos (un valor con forma de token/código se rechaza), direcciones,
diarios ni salida. El código que emite el servidor se escribe directamente en `--codigo-salida` (archivo NUEVO: se crea 0600 **antes** de enviar,
no se pisa uno con contenido y nunca se imprime).

**Diarios.** Uno NUEVO por ejecución remota, fuera de cualquier repositorio, 0600, escritura atómica. Un diario creado para otro destino
(p. ej. loopback, con identificadores acuñados por un servidor local) no se reutiliza: `diario-de-otro-plan`, sin ninguna petición.
Escribir el diario va primero: si no se puede guardar, no se envía.

**Comandos** (`operador-carga.mjs`; sin `--aplicar`/`--leer` solo validan y resumen):

    # estructura de ligas (idempotente por cargaId + contenido; 200 reproducido si ya estaba)
    node scripts/operador-carga.mjs estructura --estructura U10.json --estructura U12.json
    node scripts/operador-carga.mjs estructura --estructura U10.json --estructura U12.json --aplicar --remoto --origen https://semabel.com --diario D/estructura.json
    # lote de partidos, SEPARADO (idempotente por cargaId); la liga se indica con LIGA=archivo; --estructura contrasta los equipos
    node scripts/operador-carga.mjs partidos --partidos PLATINIUM-U10=u10.json --partidos PLATINIUM-U12=u12.json --estructura U10.json --estructura U12.json
    # organizador (NO idempotente: un solo organizador activo)
    node scripts/operador-carga.mjs provisionar --nombre "…" --ligas PLATINIUM-U10,PLATINIUM-U12 --aplicar --remoto --origen https://semabel.com --diario D/provision.json --codigo-salida D/codigo-organizador
    # lectura de comprobación (solo GET públicos, sin credenciales)
    node scripts/operador-carga.mjs verificar --estructura … --partidos LIGA=… --leer --remoto --origen https://semabel.com [--diario D/…]

**Respuesta perdida al provisionar (recuperación).** El servidor solo admite UN organizador activo y la provisión no es idempotente. Si la
respuesta se pierde, la herramienta queda «incierta» y se detiene. Volver a ejecutar el MISMO comando reenvía la misma petición, y es seguro:
si la primera sí se aplicó, el servidor responde 409 `organizador-existente` (no crea nada ni emite código) y la herramienta se detiene con el
aviso `organizador-existente-tras-respuesta-incierta`, **sin rotar nada por su cuenta**. El código solo se recupera con el comando explícito
`recuperar ... --confirmo-rotacion --codigo-salida ARCHIVO-NUEVO`, que emite otro código, REVOCA el vigente y cierra las sesiones (úsese solo si
no se dispone de un código válido). Una rotación incierta exige además `--confirmo-rotacion-repetida` para repetirla (cada rotación es otro código).
Si el código llega pero no se puede guardar, el diario queda `codigo-no-guardado` (sin el código) y la salida es `recuperar`.

**Orden de la carga inicial (manual, cuando haya autorización aparte):** (1) despliegue con la puerta cerrada y comprobación pública; (2) secreto
`ACCESO_ADMIN_TOKEN` y nuevo despliegue con `ACCESO_ADMIN_HABILITADO=1`; (3) `provisionar`; (4) `estructura` (U10 y U12) y repetición para ver
`reproducido`; (5) plantillas con `runner-plantilla.mjs --aplicar --remoto` por liga, y `--verificar`; (6) `partidos` (lote aparte, solo tras revisar las
horas: lo cargado no se edita); (7) `verificar … --leer`; (8) nuevo despliegue con la puerta en `0`. No se infieren ni crean vínculos de identidad entre ligas.

Pruebas: `test/transporte.check.js`, `test/carga-remota.check.js` (workerd; el «borde» simulado traduce `https://semabel.com` al Worker de pruebas, sin red real) y
`node --test test/cli-carga.node-test.mjs` (línea de comandos contra un servidor 127.0.0.1 simulado).

## Pruebas locales (runtime de Workers, datos sintéticos)

Desde `backend/`: `node_modules/.bin/vitest run --config vitest.config.mjs`

**`wrangler.test.jsonc` es solo configuración de pruebas locales y NO debe desplegarse.** Apunta al punto de entrada de
pruebas (`test/worker-prueba.js`, con reloj y pausas manipulables) y lleva secretos y variables sintéticos (siembra,
operador, lista de ligas de prueba). Desplegarla expondría rutas y secretos de prueba. El despliegue usa `wrangler.jsonc`.

