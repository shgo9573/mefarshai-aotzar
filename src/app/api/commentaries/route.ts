import { fetchCommentaries } from "@/lib/commentaries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bookId = Number(url.searchParams.get("bookId"));
  const line = Number(url.searchParams.get("line"));
  if (!Number.isFinite(bookId) || !Number.isFinite(line) || bookId <= 0 || line <= 0) {
    return Response.json({ error: "חסרים פרטי הקטע" }, { status: 400 });
  }
  try {
    const result = await fetchCommentaries(bookId, line, url.searchParams.get("base") || "");
    return Response.json({ bookId, line, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "טעינת המפרשים נכשלה";
    return Response.json({ error: message }, { status: 502 });
  }
}
