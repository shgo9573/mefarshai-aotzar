import { writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fetchPdf, fetchSegments } from "../src/lib/otzaria";
import { analyzePdf } from "../src/lib/detect";

const COLORS: Record<string, string> = {
  gemara: "rgba(220,40,40,0.95)",
  rashi: "rgba(40,110,220,0.95)",
  tosafot: "rgba(30,170,80,0.95)",
};

async function main() {
  const topOnly = process.argv.includes("--top");
  const pdf = await fetchPdf("ברכות", 3, "a");
  const [g, r, t] = await Promise.all([
    fetchSegments(103, 3, "a"),
    fetchSegments(2182, 3, "a"),
    fetchSegments(1927, 3, "a"),
  ]);
  const res = await analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
  console.log("bubbles", res.bubbles.length, "stats", JSON.stringify(res.stats));
  // render page via renderDafImage
  const { renderDafImage } = await import("../src/lib/render");
  const jpg = await renderDafImage("ברכות", 3, "a");
  writeFileSync("/tmp/ber3.jpg", Buffer.from(jpg));
  const img = await loadImage("/tmp/ber3.jpg");
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const sx = img.width / res.pageWidth;
  const sy = img.height / res.pageHeight;
  for (const b of res.bubbles) {
    ctx.strokeStyle = COLORS[b.layer] || "yellow";
    ctx.lineWidth = 3;
    for (const rc of b.rects) {
      ctx.strokeRect(rc.x * sx, rc.y * sy, rc.w * sx, rc.h * sy);
    }
  }
  const out = topOnly ? "public/overlay-ber3-top.jpg" : "public/overlay-ber3.jpg";
  // crop top third for readability
  if (topOnly) {
    const crop = createCanvas(img.width, Math.floor(img.height * 0.42));
    const cctx = crop.getContext("2d");
    cctx.drawImage(canvas, 0, 0, img.width, Math.floor(img.height * 0.42), 0, 0, img.width, Math.floor(img.height * 0.42));
    writeFileSync(out, crop.toBuffer("image/jpeg", 88));
  } else {
    writeFileSync(out, canvas.toBuffer("image/jpeg", 82));
  }
  console.log("wrote", out);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
