import { recentDafim } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const recent = await recentDafim();
  return Response.json({ recent });
}
