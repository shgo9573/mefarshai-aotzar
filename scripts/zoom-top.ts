import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

async function main() {
  const img = await loadImage("public/overlay-ber3-top.jpg");
  // top-center region: Gemara opener "קשיא" ~ x 250-430/643, y 0-130/992 of page.
  // overlay-ber3-top.jpg is top 42% of page image. Map fractions accordingly.
  const fx0 = 0.32;
  const fx1 = 0.72;
  const fy0 = 0.0;
  const fy1 = 0.32;
  const sx = Math.floor(img.width * fx0);
  const sy = Math.floor(img.height * (fy0 / 0.42));
  const sw = Math.floor(img.width * (fx1 - fx0));
  const sh = Math.floor(img.height * (fy1 / 0.42));
  const scale = 2.2;
  const canvas = createCanvas(Math.floor(sw * scale), Math.floor(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  writeFileSync("public/zoom-dibbur.jpg", canvas.toBuffer("image/jpeg", 90));
  console.log("wrote public/zoom-dibbur.jpg", canvas.width, canvas.height);
  void readFileSync;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
