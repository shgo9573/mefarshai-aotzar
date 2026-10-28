import { fetchPdf, fetchSegments } from "../src/lib/otzaria";
import { analyzePdf } from "../src/lib/detect";
import { getTractate } from "../src/lib/shas";
import { normalizeHebrew } from "../src/lib/hebrew";

async function one(name: string, daf: number, amud: "a" | "b", layers: ("rashi" | "tosafot")[]) {
  const tr = getTractate(name)!;
  const pdf = await fetchPdf(tr.apiName, daf, amud);
  const get = (id?: number | null) =>
    id ? fetchSegments(id, daf, amud).catch(() => []) : Promise.resolve([] as { lineIndex: number; text: string }[]);
  const [g, r, t] = await Promise.all([get(tr.bookId), get(tr.rashiBookId), get(tr.tosafotBookId)]);
  const res = await analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
  const segs = { rashi: r, tosafot: t };
  for (const layer of layers) {
    const list = segs[layer];
    const owned = new Set(
      res.bubbles.filter((b) => b.layer === layer && b.kind === "segment").map((b) => b.segmentIndex)
    );
    console.log(`== ${name} ${daf}${amud} ${layer}: ${list.length} segs`);
    list.forEach((s, i) => {
      const n = normalizeHebrew(s.text);
      if (!owned.has(i + 1)) {
        console.log(`  MISSING seg#${i + 1} L${s.lineIndex} normlen=${n.length} text=${JSON.stringify(s.text.slice(0, 70))}`);
      }
    });
    // neighbours of missing
    for (const b of res.bubbles.filter((x) => x.layer === layer && x.kind === "segment").slice(-4)) {
      console.log(`  tail bubble seg#${b.segmentIndex} score=${b.score} rects=${b.rects.length}`);
    }
  }
}

async function main() {
  await one("כתובות", 22, "a", ["rashi", "tosafot"]);
  await one("ברכות", 3, "b", ["tosafot"]);
  await one("בבא בתרא", 60, "a", ["tosafot"]);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
