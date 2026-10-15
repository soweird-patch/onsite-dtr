import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const colors = { bg: [13, 32, 52], teal: [41, 199, 194], white: [243, 248, 252], pink: [244, 135, 160] };
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), len = Buffer.alloc(4), check = Buffer.alloc(4);
  len.writeUInt32BE(data.length); check.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, check]);
}
function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
function generate(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); row[0] = 0;
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const ring = Math.abs(Math.hypot(nx - .5, ny - .5) - .325) < .026;
      const hand1 = segmentDistance(nx, ny, .5, .5, .5, .29) < .025;
      const hand2 = segmentDistance(nx, ny, .5, .5, .645, .58) < .025;
      const check1 = segmentDistance(nx, ny, .23, .69, .31, .77) < .023;
      const check2 = segmentDistance(nx, ny, .31, .77, .45, .63) < .023;
      const fill = check1 || check2 ? colors.pink : ring ? colors.teal : hand1 || hand2 ? colors.white : colors.bg;
      row.set([...fill, 255], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
}
generate(192); generate(512);
