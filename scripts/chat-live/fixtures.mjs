// Fictional files the live test uploads for viewing and pinning: a small bar
// chart (PNG) and a two-page text PDF. Built here so no client file is
// needed and no dependency is added.
import zlib from "node:zlib";

/** A 400 by 300 PNG with three bars; the middle one is the tallest and blue. */
export function fictionalPng() {
  const width = 400;
  const height = 300;
  const bars = [
    [60, 120, [200, 60, 60]],
    [170, 200, [60, 140, 200]],
    [280, 80, [60, 170, 90]],
  ];
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      let color = y === height - 20 ? [0, 0, 0] : [255, 255, 255];
      for (const [left, barHeight, barColor] of bars) {
        if (x >= left && x < left + 60 && y >= height - 20 - barHeight && y < height - 20) color = barColor;
      }
      row.set(color, 1 + x * 3);
    }
    rows.push(row);
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), body])) >>> 0);
    return Buffer.concat([length, Buffer.from(type), body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A two-page PDF: a large title and smaller body text on each page. */
export function fictionalPdf() {
  const page = (title, body) =>
    `BT /F1 24 Tf 72 720 Td (${title}) Tj ET\nBT /F1 12 Tf 72 690 Td (${body}) Tj ET`;
  const contents = [
    page("Rig calibration trial log", "Fictional test file. Trial pressure range 2.0 to 4.5 bar."),
    page("Trial 2 observations", "Fictional test file. Sensor drift appeared above 4 bar."),
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...contents.map((stream) => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
