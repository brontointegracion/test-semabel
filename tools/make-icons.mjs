// Minimal dependency-free PNG writer, used once to generate the PWA icons.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { crc32 } from 'node:zlib'

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

function png(size, paint) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size)
      const i = row + 1 + x * 4
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8    // bit depth
  ihdr[9] = 6    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// A court-green ground with a white ball outline and two court lines.
const paint = (x, y, size) => {
  const s = size / 512
  const cx = size / 2, cy = size / 2
  const d = Math.hypot(x - cx, y - cy)
  const ring = Math.abs(d - 150 * s) < 16 * s
  const seamV = Math.abs(x - cx) < 11 * s && d < 152 * s
  const seamH = Math.abs(y - cy) < 11 * s && d < 152 * s
  if (ring || seamV || seamH) return [255, 255, 255, 255]
  return [13, 107, 85, 255]
}

mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size, paint))
  console.log(`public/icon-${size}.png`)
}
