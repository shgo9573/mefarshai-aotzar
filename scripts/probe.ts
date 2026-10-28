import { fetchPdf, fetchSegments } from "../src/lib/otzaria";
import * as detectModule from "../src/lib/detect";
(async () => {
  const pdf = await fetchPdf("יבמות", 40, "b");
  const [g, r, t] = await Promise.all([fetchSegments(115, 40, "b"), fetchSegments(2167, 40, "b"), fetchSegments(1918, 40, "b")]);
  const res = await detectModule.analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
  const rashi = res.bubbles.filter((b) => b.layer === "rashi");
  const maxY = Math.max(...rashi.flatMap((b) => b.rects.map((x) => x.y)));
  console.log("rashi bubbles", rashi.length, "lowest rashi rect y", maxY, "column", JSON.stringify(res.stats.column));
  const lines = rashi.filter((b) => b.kind === "line").length;
  console.log("line-kind rashi", lines);
})();
