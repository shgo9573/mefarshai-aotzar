import { fetchPdf, fetchSegments } from "../src/lib/otzaria";
import * as detectModule from "../src/lib/detect";

async function main() {
  const name = "ברכות";
  const daf = 3;
  const amud = "a" as const;
  console.log("fetching", name, daf, amud);
  const pdf = await fetchPdf(name, daf, amud);
  console.log("pdf bytes", pdf.length);
  const [g, r, t] = await Promise.all([
    fetchSegments(103, daf, amud),
    fetchSegments(2182, daf, amud),
    fetchSegments(1927, daf, amud),
  ]);
  console.log("segments G/R/T:", g.length, r.length, t.length);
  console.log("--- G segs ---");
  g.slice(0, 12).forEach((s, i) => console.log(i, "L" + s.lineIndex, JSON.stringify(s.text.slice(0, 90))));
  console.log("--- R segs ---");
  r.slice(0, 12).forEach((s, i) => console.log(i, "L" + s.lineIndex, JSON.stringify(s.text.slice(0, 90))));
  console.log("--- T segs ---");
  t.slice(0, 12).forEach((s, i) => console.log(i, "L" + s.lineIndex, JSON.stringify(s.text.slice(0, 90))));
  const res = await detectModule.analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
  console.log("STATS", JSON.stringify(res.stats, null, 2));
  for (const b of res.bubbles) {
    console.log(
      `[${b.layer}] id=${b.id} kind=${b.kind} seg=${b.segmentIndex} line=${b.lineIndex} score=${b.score} rects=${b.rects.length} preview=${JSON.stringify(b.preview.slice(0, 60))}`
    );
    for (const rc of b.rects.slice(0, 4)) {
      console.log(`    rect x=${rc.x.toFixed(1)} y=${rc.y.toFixed(1)} w=${rc.w.toFixed(1)} h=${rc.h.toFixed(1)}`);
    }
  }
}

main().catch((e) => {
  console.error("DIAG FAILED", e);
  process.exit(1);
});
