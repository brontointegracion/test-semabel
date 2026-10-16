import { MarcaPublica } from './componentes.jsx'

// Frontera del inicio público cuando no hay ligas configuradas en la compilación (o la configuración es inválida).
// El texto es el mismo de siempre de la frontera «en preparación».
export default function EnPreparacionPublica() {
  return (
    <div className="home publico">
      <MarcaPublica />
      <main className="en-preparacion">
        <h1>Sebel</h1>
        <p className="sub">Estamos preparando los resultados y calendarios en vivo. Vuelve pronto.</p>
      </main>
    </div>
  )
}
