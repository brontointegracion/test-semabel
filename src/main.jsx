import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { sembrarSiHaceFalta, mantenerPartidoEnVivo } from './seed'
import { resolverRegion } from './lib/region'
import { asegurarSesion } from './lib/sesion'
import './styles.css'

async function arrancar() {
  await sembrarSiHaceFalta()
  await resolverRegion()
  await asegurarSesion()
  await mantenerPartidoEnVivo()

  // El partido de ejemplo sigue en juego mientras la app esté abierta: cuando
  // se acaba un período empieza el siguiente. Es andamiaje del prototipo —
  // con un backend, el reloj lo mueve el árbitro desde la consola.
  setInterval(mantenerPartidoEnVivo, 15000)

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

// Si abrir o migrar la base falla —el caso más probable es una pestaña vieja
// contra una base que otra pestaña ya dejó en una versión más nueva— que se
// vea un aviso y un botón para reintentar, no una pantalla en blanco sin
// explicación. React todavía no montó nada en este punto, así que el aviso
// se escribe directo en el DOM.
arrancar().catch((error) => {
  console.error('No se pudo iniciar Sebel:', error)
  const raiz = document.getElementById('root')
  if (!raiz) return
  raiz.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;
                justify-content:center;gap:10px;padding:24px;text-align:center;">
      <p style="font-weight:800;margin:0;">No se pudo abrir Sebel</p>
      <p class="sub" style="max-width:32em;margin:0;">
        Puede que esta pestaña tenga una versión vieja abierta a la vez que otra más nueva.
        Cierra las demás pestañas de Sebel y vuelve a intentar.
      </p>
      <button class="btn" style="margin-top:6px;" onclick="location.reload()">Reintentar</button>
    </div>`
})
