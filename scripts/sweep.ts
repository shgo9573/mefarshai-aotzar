import { fetchPdf, fetchSegments } from "../src/lib/otzaria";
import { analyzePdf } from "../src/lib/detect";
import { getTractate } from "../src/lib/shas";

const PAGES: [string, number, "a" | "b"][] = [
  ["ברכות", 2, "a"],
  ["ברכות", 2, "b"],
  ["ברכות", 3, "a"],
  ["ברכות", 3, "b"],
  ["ברכות", 9, "b"],
  ["שבת", 2, "a"],
  ["שבת", 50, "a"],
  ["עירובין", 13, "a"],
  ["פסחים", 50, "a"],
  ["כתובות", 22, "a"],
  ["נדרים", 32, "a"],
  ["גיטין", 30, "b"],
  ["בבא מציעא", 59, "b"],
  ["בבא בתרא", 60, "a"],
  ["סנהדרין", 37, "a"],
  ["מנחות", 40, "a"],
  ["חולין", 2, "a"],
  ["יבמות", 40, "b"],
  ["זבחים", 20, "a"],
  ["נדה", 20, "b"],
];

async function main() {
  for (const [name, daf, amud] of PAGES) {
    const tr = getTractate(name);
    if (!tr) {
      console.log(`${name}: unknown tractate`);
      continue;
    }
    try {
      const pdf = await fetchPdf(tr.apiName, daf, amud);
      const get = (id?: number | null) =>
        id ? fetchSegments(id, daf, amud).catch(() => []) : Promise.resolve([] as { lineIndex: number; text: string }[]);
      const [g, r, t] = await Promise.all([get(tr.bookId), get(tr.rashiBookId), get(tr.tosafotBookId)]);
      const res = await analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
      const owned = new Map<string, Set<number>>();
      const weak: string[] = [];
      for (const b of res.bubbles) {
        if (b.kind !== "segment") continue;
        if (!owned.has(b.layer)) owned.set(b.layer, new Set());
        owned.get(b.layer)!.add(b.segmentIndex);
        if (b.score < 0.68) weak.push(`${b.layer[0]}#${b.segmentIndex}=${b.score}`);
      }
      const miss: string[] = [];
      const counts: Record<string, [number, number]> = {
        gemara: [g.length, 0],
        rashi: [r.length, 0],
        tosafot: [t.length, 0],
      };
      for (const [layer, set] of owned) counts[layer][1] = set.size;
      for (const [layer, [segs, got]] of Object.entries(counts)) {
        if (segs > 0 && got < segs) miss.push(`${layer[0]}:${got}/${segs}`);
      }
      console.log(
        `${name} ${daf}${amud}: G/R/T segs ${g.length}/${r.length}/${t.length} | bubbles G${res.stats.layers.gemara} R${res.stats.layers.rashi} T${res.stats.layers.tosafot} | restored=${res.stats.restored} collisions=${res.stats.collisions} | MISS[${miss.join(" ") || "none"}] WEAK[${weak.slice(0, 8).join(" ") || "none"}]`
      );
    } catch (e) {
      console.log(`${name} ${daf}${amud}: ERROR ${(e as Error).message}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
