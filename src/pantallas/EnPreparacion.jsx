import './AccesoOrganizador.css'

// Frontera explícita del modo compartido: hasta que las lecturas públicas vengan del servidor, las pantallas
// del prototipo (que leen datos de demostración guardados en el navegador) NO se montan.
export default function EnPreparacion() {
  return (
    <main className="en-preparacion">
      <h1>Sebel</h1>
      <p className="sub">Estamos preparando los resultados y calendarios en vivo. Vuelve pronto.</p>
    </main>
  )
}
