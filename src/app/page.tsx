import { Suspense } from "react";
import { DafStudio } from "@/components/DafStudio";
import { recentDafim } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const recent = await recentDafim();
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-amber-100">טוען את הדף…</div>}>
      <DafStudio initialRecent={recent} />
    </Suspense>
  );
}
