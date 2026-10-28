import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fetchPdf, fetchSegments } from "../src/lib/otzaria";

// Replicate the pipeline far enough to dump the Tosafot stream lines.
// We import internals indirectly: easiest is to add a debug hook via env.
async function main() {
  process.env.DAF_DEBUG_STREAM = "tosafot";
  const { analyzePdf } = await import("../src/lib/detect");
  const pdf = await fetchPdf("ברכות", 3, "a");
  const [g, r, t] = await Promise.all([
    fetchSegments(103, 3, "a"),
    fetchSegments(2182, 3, "a"),
    fetchSegments(1927, 3, "a"),
  ]);
  const res = await analyzePdf(pdf, { gemara: g, rashi: r, tosafot: t });
  console.log("done", res.bubbles.length);
  void getDocument;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
