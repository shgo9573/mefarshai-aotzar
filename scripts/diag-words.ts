import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fetchPdf } from "../src/lib/otzaria";
import { decodePdfString } from "../src/lib/hebrew";

async function main() {
  const pdf = await fetchPdf("ברכות", 3, "a");
  const doc = await getDocument({ data: pdf, disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: any[] = (tc as any).items.filter((it: any) => it.str && it.str.trim());
  console.log("total items", items.length, "page", vp.width.toFixed(1), vp.height.toFixed(1));
  const rows: { x: number; y: number; w: number; h: number; fs: number; t: string }[] = [];
  for (const it of items) {
    const fs = Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || Math.abs(it.transform[3] || 0);
    const h = it.height || fs;
    const w = it.width || 0;
    const [x, baseline] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const y = baseline - h;
    const t = decodePdfString(it.str);
    rows.push({ x, y, w, h, fs, t });
  }
  rows.sort((a, b) => a.y - b.y || b.x - a.x);
  // Print items with y < 200 (top of page) to see title + dibburim
  console.log("=== TOP y<190 ===");
  for (const r of rows.filter((r) => r.y < 190)) {
    console.log(
      `y=${r.y.toFixed(1)} x=${r.x.toFixed(1)} w=${r.w.toFixed(1)} fs=${r.fs.toFixed(2)} ${JSON.stringify(r.t)}`
    );
  }
  // font histogram
  const hist = new Map<string, number>();
  for (const r of rows) {
    const k = r.fs.toFixed(2);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  console.log("=== HIST ===");
  for (const [k, v] of [...hist.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))) {
    console.log(k, v);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
