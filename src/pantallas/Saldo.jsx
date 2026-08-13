import { useState } from 'react'
import { db } from '../db'
import { useCuenta } from '../datos'
import { Marca } from '../ui'

const PAQUETES = [
  { partidos: 10, precio: 12, nota: 'Para probar una vuelta corta' },
  { partidos: 30, precio: 30, nota: 'Una temporada de barrio', destacado: true },
  { partidos: 90, precio: 75, nota: 'Varias ligas a la vez' },
]

const METODOS = [
  { id: 'yappy', nombre: 'Yappy', nota: 'Panamá' },
  { id: 'tarjeta', nombre: 'Tarjeta', nota: 'Visa / MC' },
]

export default function Saldo() {
  const cuenta = useCuenta()
  const [metodo, setMetodo] = useState('yappy')
  const [comprado, setComprado] = useState(null)

  if (!cuenta) return null

  const comprar = async (p) => {
    await db.cuenta.update('yo', { saldo: cuenta.saldo + p.partidos })
    setComprado(p)
    setTimeout(() => setComprado(null), 2600)
  }

  return (
    <>
      <Marca />

      <div className="saldo-hero" style={{ marginTop: 14 }}>
        <div className="n">{cuenta.saldo}</div>
        <div className="q">partidos disponibles para llevar el marcador</div>
      </div>

      <div className="aviso" style={{ marginTop: 14 }}>
        <div>
          Un partido de saldo = un partido con marcador en vivo. No es una moneda ni tiene
          conversión. <strong>Anotar el resultado final a mano siempre es gratis.</strong>
        </div>
      </div>

      <h2 className="seccion">Recargar</h2>
      <div className="lista">
        {PAQUETES.map((p) => (
          <button
            key={p.partidos}
            className={`paquete ${p.destacado ? 'destacado' : ''}`}
            onClick={() => comprar(p)}
          >
            <div style={{ flex: 1 }}>
              <div className="n">{p.partidos} partidos</div>
              <div className="sub">{p.nota}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="precio">${p.precio}</div>
              <div className="sub" style={{ fontSize: '0.7rem' }}>
                ${(p.precio / p.partidos).toFixed(2)} c/u
              </div>
            </div>
          </button>
        ))}
      </div>

      {comprado && (
        <div className="aviso" style={{ marginTop: 12 }}>
          <div>
            Listo: {comprado.partidos} partidos añadidos por {METODOS.find((m) => m.id === metodo).nombre}.
            El cobro pasó aquí, sentado, no en la cancha antes de empezar.
          </div>
        </div>
      )}

      <h2 className="seccion">Método de pago</h2>
      <div className="metodos">
        {METODOS.map((m) => (
          <button
            key={m.id}
            className={`metodo ${metodo === m.id ? 'on' : ''}`}
            onClick={() => setMetodo(m.id)}
          >
            <div>{m.nombre}</div>
            <div className="sub" style={{ fontSize: '0.68rem', fontWeight: 500 }}>{m.nota}</div>
          </button>
        ))}
      </div>
      <p className="sub" style={{ marginTop: 10 }}>
        El plan pagado se enciende país por país, según el medio de pago que la gente usa de
        verdad. Crear la liga y publicarla es gratis en todas partes.
      </p>

      <h2 className="seccion">Si la cancha paga</h2>
      <div className="card">
        <div style={{ fontWeight: 700 }}>Plan mensual de cancha</div>
        <p className="sub" style={{ marginTop: 6 }}>
          Marcador ilimitado para todas las ligas que juegan ahí, y página propia de la cancha.
          Es la versión que convierte el marcador en un servicio del local.
        </p>
        <button className="btn fantasma" style={{ marginTop: 12 }}>Hablar con Sebel</button>
      </div>
    </>
  )
}
