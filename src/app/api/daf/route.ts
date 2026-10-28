import { dafLabel, parseAmud } from "@/lib/hebrew";
import { ALGO_VERSION, analyzePdf } from "@/lib/detect";
import { fetchPdf, fetchSegments } from "@/lib/otzaria";
import { clampDaf, dafExists, getTractate } from "@/lib/shas";
import { readCachedDaf, recordVisit, writeCachedDaf } from "@/lib/store";
import type { DafPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tractate = getTractate(url.searchParams.get("masechta") || "ברכות");
  if (!tractate) return Response.json({ error: "המסכת לא נמצאה בש״ס" }, { status: 404 });
  const requestedDaf = Number(url.searchParams.get("daf") || tractate.startDaf);
  const requestedAmud = parseAmud(url.searchParams.get("amud"));
  const placed = clampDaf(tractate, requestedDaf, requestedAmud);
  if (!dafExists(tractate, placed.daf, placed.amud)) {
    return Response.json({ error: "הדף הזה אינו קיים במסכת" }, { status: 400 });
  }

  const cached = await readCachedDaf(tractate.name, placed.daf, placed.amud);
  if (cached) {
    await recordVisit(tractate.name, placed.daf, placed.amud);
    return Response.json(cached);
  }

  const load = (bookId: number | null | undefined) =>
    bookId ? fetchSegments(bookId, placed.daf, placed.amud).catch(() => []) : Promise.resolve([]);

  try {
    const [pdf, gemara, rashi, tosafot] = await Promise.all([
      fetchPdf(tractate.apiName, placed.daf, placed.amud),
      load(tractate.bookId),
      load(tractate.rashiBookId),
      load(tractate.tosafotBookId),
    ]);
    const analysis = await analyzePdf(pdf, { gemara, rashi, tosafot });
    const payload: DafPayload = {
      algo: ALGO_VERSION,
      tractate: tractate.name,
      apiName: tractate.apiName,
      daf: placed.daf,
      amud: placed.amud,
      label: dafLabel(placed.daf, placed.amud),
      bookId: tractate.bookId,
      pageWidth: analysis.pageWidth,
      pageHeight: analysis.pageHeight,
      bubbles: analysis.bubbles.map((bubble) => ({
        ...bubble,
        bookId:
          bubble.layer === "gemara"
            ? tractate.bookId
            : bubble.layer === "rashi"
              ? (tractate.rashiBookId ?? null)
              : (tractate.tosafotBookId ?? null),
      })),
      stats: analysis.stats,
    };
    await writeCachedDaf(payload);
    await recordVisit(tractate.name, placed.daf, placed.amud);
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ניתוח הדף נכשל";
    return Response.json({ error: message }, { status: 502 });
  }
}
