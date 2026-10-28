import { getTractate } from "@/lib/shas";
import { fetchPdf } from "@/lib/otzaria";
import { parseAmud } from "@/lib/hebrew";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tractate = getTractate(url.searchParams.get("masechta"));
  const daf = Number(url.searchParams.get("daf"));
  const amud = parseAmud(url.searchParams.get("amud"));
  if (!tractate || !Number.isFinite(daf)) {
    return Response.json({ error: "מסכת או דף לא תקינים" }, { status: 400 });
  }
  try {
    const pdf = await fetchPdf(tractate.apiName, daf, amud);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Cache-Control": "public, max-age=86400",
        "Content-Disposition": `inline; filename="daf-${daf}${amud}.pdf"; filename*=UTF-8''${encodeURIComponent(
          `${tractate.apiName}-${daf}${amud}.pdf`,
        )}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "טעינת הדף נכשלה";
    return Response.json({ error: message }, { status: 502 });
  }
}
