import { writeFileSync } from "node:fs";
import { fetchPdf } from "../src/lib/otzaria";
import { renderDafImage } from "../src/lib/render";

async function main() {
  const pdf = await fetchPdf("ברכות", 3, "a");
  console.log("pdf bytes", pdf.length);
  const jpg = await renderDafImage("ברכות", 3, "a");
  writeFileSync("public/diag-ber3.jpg", Buffer.from(jpg));
  console.log("wrote public/diag-ber3.jpg", jpg.length);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
