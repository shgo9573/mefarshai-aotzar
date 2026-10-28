import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dafOverlays, dafVisits } from "@/db/schema";
import { ALGO_VERSION } from "./detect";
import type { Amud, DafPayload, RecentDaf } from "./types";

const memory = new Map<string, DafPayload>();

function keyOf(tractate: string, daf: number, amud: Amud) {
  return `${tractate}:${daf}:${amud}`;
}

export async function readCachedDaf(tractate: string, daf: number, amud: Amud): Promise<DafPayload | null> {
  const key = keyOf(tractate, daf, amud);
  const remembered = memory.get(key);
  if (remembered?.algo === ALGO_VERSION) return remembered;
  try {
    const rows = await db
      .select()
      .from(dafOverlays)
      .where(and(eq(dafOverlays.tractate, tractate), eq(dafOverlays.daf, daf), eq(dafOverlays.amud, amud)))
      .limit(1);
    const payload = rows[0]?.payload as DafPayload | undefined;
    if (payload && payload.algo === ALGO_VERSION) {
      memory.set(key, payload);
      return payload;
    }
  } catch {
    return remembered || null;
  }
  return null;
}

export async function writeCachedDaf(payload: DafPayload) {
  memory.set(keyOf(payload.tractate, payload.daf, payload.amud), payload);
  try {
    await db
      .insert(dafOverlays)
      .values({
        tractate: payload.tractate,
        daf: payload.daf,
        amud: payload.amud,
        bookId: payload.bookId,
        algo: payload.algo,
        bubbleCount: payload.bubbles.length,
        payload,
      })
      .onConflictDoUpdate({
        target: [dafOverlays.tractate, dafOverlays.daf, dafOverlays.amud],
        set: {
          bookId: payload.bookId,
          algo: payload.algo,
          bubbleCount: payload.bubbles.length,
          payload,
          createdAt: new Date(),
        },
      });
  } catch {
    // The table may not exist yet; the in-memory cache still serves this process.
  }
}

export async function recordVisit(tractate: string, daf: number, amud: Amud) {
  try {
    await db.insert(dafVisits).values({ tractate, daf, amud });
  } catch {
    return;
  }
}

export async function recentDafim(): Promise<RecentDaf[]> {
  try {
    const rows = await db.select().from(dafVisits).orderBy(desc(dafVisits.visitedAt)).limit(40);
    const seen = new Set<string>();
    const recent: RecentDaf[] = [];
    for (const row of rows) {
      const key = `${row.tractate}:${row.daf}:${row.amud}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push({
        tractate: row.tractate,
        daf: row.daf,
        amud: row.amud === "b" ? "b" : "a",
        visitedAt: row.visitedAt.toISOString(),
      });
      if (recent.length >= 8) break;
    }
    return recent;
  } catch {
    return [];
  }
}
