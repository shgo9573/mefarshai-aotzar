import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fetchPdf, fetchSegments } from "../src/lib/otzaria";
import { analyzePdf } from "../src/lib/detect";
import { getTractate } from "../src/lib/shas";
import { decodePdfString, normalizeHebrew } from "../src/lib/hebrew";

function letterCount(t: string): number {
  return normalizeHebrew(t).length;
}

async function bb60a() {
  const tr = getTractate("בבא בתרא")!;
  const pdf = await fetchPdf(tr.apiName, 60, "a");
  // What commentary-size text exists on the page at all?
  const doc = await getDocument({ data: pdf.slice(), disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const hist = new Map<string, number>();
  const words: { fs: number; n: number }[] = [];
  for (const it of (tc as any).items) {
    if (!it.str?.trim()) continue;
    const fs = Math.hypot(it.transform[2] || 0, it.transform[3] || 0);
    if (fs < 8.8 || fs > 18) continue;
    const t = decodePdfString(it.str);
    if (letterCount(t) < 2) continue;
    const key = fs.toFixed(1);
    hist.set(key, (hist.get(key) || 0) + letterCount(t));
    words.push({ fs, n: letterCount(t) });
  }
  console.log("BB60a font mass:", [...hist.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, v]) => `${k}:${v}`).join(" "));
  const t = await fetchSegments(tr.tosafotBookId!, 60, "a");
  console.log("tosafot segs:", t.length, t.map((s) => `L${s.lineIndex}:${s.text.slice(0, 40)}`));
  const g = await fetchSegments(tr.bookId!, 60, "a");
  const r = await fetchSegments(tr.rashiBookId!, 60, "a").catch(() => []);
  console.log("gemara segs:", g.length, "rashi segs:", r.length);
  const res = await analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
  console.log("layers:", JSON.stringify(res.stats.layers), "fonts:", res.stats.gemaraFont, res.stats.commentaryFont);
}

async function yev() {
  const tr = getTractate("יבמות")!;
  const pdf = await fetchPdf(tr.apiName, 40, "b");
  const get = (id?: number | null) =>
    id ? fetchSegments(id, 40, "b").catch(() => []) : Promise.resolve([] as { lineIndex: number; text: string }[]);
  const [g, r, t] = await Promise.all([get(tr.bookId), get(tr.rashiBookId), get(tr.tosafotBookId)]);
  const res = await analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
  const owned = new Set(res.bubbles.filter((b) => b.layer === "rashi" && b.kind === "segment").map((b) => b.segmentIndex));
  const missing = r.map((_, i) => i + 1).filter((i) => !owned.has(i));
  console.log("Yevamot R missing:", missing.join(","));
  for (const m of missing) {
    const s = r[m - 1];
    console.log(`  seg#${m} L${s.lineIndex} normlen=${normalizeHebrew(s.text).length} ${JSON.stringify(s.text.slice(0, 80))}`);
  }
  // tail bubbles
  for (const b of res.bubbles.filter((x) => x.layer === "rashi" && x.kind === "segment").slice(-5)) {
    console.log(`  tail seg#${b.segmentIndex} score=${b.score} rects=${b.rects.length} y0=${b.rects[0]?.y}`);
  }
}

async function main() {
  await bb60a();
  await yev();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
