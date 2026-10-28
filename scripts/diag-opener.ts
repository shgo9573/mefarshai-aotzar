import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fetchPdf } from "../src/lib/otzaria";
import { decodePdfString, normalizeHebrew } from "../src/lib/hebrew";

function letterCount(text: string): number {
  return normalizeHebrew(text).length;
}

async function main() {
  const pdf = await fetchPdf("ברכות", 3, "a");
  const doc = await getDocument({ data: pdf, disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const words: { text: string; x: number; y: number; w: number; h: number; fs: number }[] = [];
  for (const it of (tc as any).items) {
    if (!it.str?.trim()) continue;
    const fs = Math.hypot(it.transform[2] || 0, it.transform[3] || 0);
    const h = it.height || fs;
    const w = it.width || 0;
    const [x, baseline] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    words.push({ text: decodePdfString(it.str).replace(/\s+/g, " ").trim(), x, y: baseline - h, w, h, fs });
  }
  const font = 11.2;
  const pageHeight = vp.height;
  const body = words.filter((w) => Math.abs(w.fs - font) <= 0.3 && letterCount(w.text) >= 2 && w.y > pageHeight * 0.03);
  const xs = body.map((w) => w.x).sort((a, b) => a - b);
  const xe = body.map((w) => w.x + w.w).sort((a, b) => a - b);
  const low = xs[Math.floor(xs.length * 0.01)] - 5;
  const high = xe[Math.floor(xe.length * 0.99)] + 5;
  console.log("body range", low.toFixed(1), high.toFixed(1), "body count", body.length);
  const sized = words.filter(
    (w) => w.fs >= font * 0.93 && w.fs <= font * 1.1 && w.w > 0.6 && w.y > pageHeight * 0.03 && w.x >= low && w.x + w.w <= high
  );
  // candidate openers: big words in left column area
  for (const word of words) {
    if (word.fs <= font * 1.1 || word.fs > 40) continue;
    if (word.x < 100 || word.x > 350 || word.y < 60 || word.y > 260) continue;
    const base = word.y + word.h;
    const sameLine = sized.filter((o) => Math.abs(o.y + o.h - base) <= 2.5);
    const cont = sameLine.filter((o) => o.x + o.w <= word.x + 2 && word.x - (o.x + o.w) <= font * 1.6);
    const right = sameLine.filter((o) => o.x >= word.x + word.w - 2 && o.x - (word.x + word.w) <= font * 1.6);
    console.log(
      `opener ${JSON.stringify(word.text)} fs=${word.fs.toFixed(2)} x=${word.x.toFixed(0)} y=${word.y.toFixed(0)} base=${base.toFixed(1)} letters=${letterCount(word.text)}`
    );
    console.log(`  sameLine(${sameLine.length}):`, sameLine.map((o) => `[x${o.x.toFixed(0)} base${(o.y + o.h).toFixed(0)} ${JSON.stringify(o.text.slice(0, 8))}]`).join(" "));
    console.log(`  continues=${cont.length} rightNeighbour=${right.length}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
