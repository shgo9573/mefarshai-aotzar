import { fetchPdf, fetchSegments } from "../src/lib/otzaria";
import { analyzePdf } from "../src/lib/detect";

async function main() {
  const pdf = await fetchPdf("ברכות", 3, "a");
  const [g, r, t] = await Promise.all([
    fetchSegments(103, 3, "a"),
    fetchSegments(2182, 3, "a"),
    fetchSegments(1927, 3, "a"),
  ]);
  const res = await analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
  // Full rect dump for first 3 segments of each layer
  for (const b of res.bubbles) {
    const n = b.segmentIndex;
    if (n > 3) continue;
    console.log(
      `[${b.layer}] seg#${n} id=${b.id} score=${b.score} kind=${b.kind} text=${JSON.stringify(b.text.slice(0, 40))}`
    );
    for (const rc of b.rects) {
      console.log(`    x=${rc.x.toFixed(1)} y=${rc.y.toFixed(1)} w=${rc.w.toFixed(1)} h=${rc.h.toFixed(1)}`);
    }
  }
  // Any segment without a bubble?
  for (const [name, segs, layer] of [["G", g, "gemara"], ["R", r, "rashi"], ["T", t, "tosafot"]] as const) {
    const owned = new Set(res.bubbles.filter((b) => b.layer === layer && b.kind === "segment").map((b) => b.segmentIndex));
    const missing = segs.map((_, i) => i + 1).filter((i) => !owned.has(i));
    console.log(`${name}: segments=${segs.length} missing bubbles for segment# [${missing.join(",")}]`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
