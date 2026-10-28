import { parseAmud } from "@/lib/hebrew";
import { renderDafImage } from "@/lib/render";
import { getTractate } from "@/lib/shas";

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
    const image = await renderDafImage(tractate.apiName, daf, amud);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(image.length),
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ציור הדף נכשל";
    return Response.json({ error: message }, { status: 502 });
  }
}
