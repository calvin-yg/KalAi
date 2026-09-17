/**
 * Render a valid EAN-13 barcode into a Y4M video file, so a browser's fake
 * camera can present a genuinely decodable barcode to the scanner.
 *
 *   node test/make-barcode-video.mjs           # writes barcode.y4m
 *
 * Then launch Chromium with:
 *   --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
 *   --use-file-for-fake-video-capture=<path>/barcode.y4m
 *
 * and open the scanner — it should decode 9300675024235 without a real camera.
 */
import fs from "node:fs";

const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

export function checkDigit(twelve) {
  const d = twelve.split("").map(Number);
  const sum = d.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

function modules(code) {
  const d = code.split("").map(Number);
  const parity = PARITY[d[0]];
  let bits = "101";
  for (let i = 0; i < 6; i += 1) bits += (parity[i] === "L" ? L : G)[d[i + 1]];
  bits += "01010";
  for (let i = 0; i < 6; i += 1) bits += R[d[i + 7]];
  return bits + "101";
}

const W = 640, H = 480;

export function writeY4m(code, path, frames = 30) {
  const bits = modules(code);
  const scale = 4;                      // px per module
  const barW = bits.length * scale;     // 380 px
  const x0 = Math.floor((W - barW) / 2);
  const yTop = 120, yBottom = 360;

  const y = Buffer.alloc(W * H, 255);   // white background
  for (let px = 0; px < barW; px += 1) {
    if (bits[Math.floor(px / scale)] !== "1") continue;
    for (let row = yTop; row < yBottom; row += 1) y[row * W + x0 + px] = 0;
  }
  const u = Buffer.alloc((W / 2) * (H / 2), 128);
  const v = Buffer.alloc((W / 2) * (H / 2), 128);

  const out = fs.createWriteStream(path);
  out.write(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420mpeg2\n`);
  for (let i = 0; i < frames; i += 1) {
    out.write("FRAME\n");
    out.write(y); out.write(u); out.write(v);
  }
  out.end();
  return new Promise((resolve) => out.on("close", resolve));
}

const twelve = "930067502423";
const code = twelve + checkDigit(twelve);
await writeY4m(code, "barcode.y4m");
console.log("generated barcode:", code);
