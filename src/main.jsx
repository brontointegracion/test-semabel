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

arrancar()
