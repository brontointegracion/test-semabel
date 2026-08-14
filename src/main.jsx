import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { sembrarSiHaceFalta } from './seed'
import { resolverRegion } from './lib/region'
import { asegurarSesion } from './lib/sesion'
import './styles.css'

sembrarSiHaceFalta().then(resolverRegion).then(asegurarSesion).then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
