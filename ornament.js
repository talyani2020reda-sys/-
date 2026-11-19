// يولّد زخارف الغلاف (شريط هندسي إسلامي) كصورة PNG بلون يختاره المستخدم
const sharp = require('sharp');

function star(cx, cy, r, color, sw = 1.6) {
  const s = r * 1.414;
  return `<g stroke="${color}" stroke-width="${sw}" fill="none">
    <rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}"/>
    <rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" transform="rotate(45 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.38}"/></g>`;
}

function bandSvg(main, accent, flip = false) {
  const W = 1500, H = 150;
  let g = '';
  for (let x = 60; x < W; x += 110) {
    g += star(x, 75, 28, main);
    if (x + 55 < W) g += `<path d="M${x + 55} 62 L${x + 68} 75 L${x + 55} 88 L${x + 42} 75Z" fill="${accent}"/>`;
  }
  const medal = `<g>
    <circle cx="${W / 2}" cy="75" r="62" fill="#fff" stroke="${accent}" stroke-width="3"/>
    <circle cx="${W / 2}" cy="75" r="52" fill="none" stroke="${main}" stroke-width="1.5"/>
    ${star(W / 2, 75, 38, main, 2.2)}${star(W / 2, 75, 24, accent, 2)}</g>`;
  const lines = `<g stroke="${accent}" fill="none"><line x1="0" y1="14" x2="${W}" y2="14" stroke-width="3"/><line x1="0" y1="24" x2="${W}" y2="24" stroke-width="1"/>
    <line x1="0" y1="${H - 24}" x2="${W}" y2="${H - 24}" stroke-width="1"/><line x1="0" y1="${H - 14}" x2="${W}" y2="${H - 14}" stroke-width="3"/></g>`;
  const inner = `${lines}${g}${medal}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <g ${flip ? `transform="translate(0 ${H}) scale(1 -1)"` : ''}>${inner}</g></svg>`;
}

async function ornament(main = '#1b2a4a', accent = '#b8923a', flip = false) {
  return sharp(Buffer.from(bandSvg(main, accent, flip))).png().toBuffer();
}
module.exports = { ornament, W: 1500, H: 150 };
