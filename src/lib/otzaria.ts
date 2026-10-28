import { fromHebrewNumber, stripTags } from "./hebrew";
import type { Amud } from "./types";
import type { Segment } from "./detect";

export const ORACLE = "https://otzaria.duckdns.org";

export type TocEntry = { title: string; index: number };

function parseDafTitle(title: string): { daf: number; amud: Amud } | null {
  const match = title.match(/דף\s+([א-ת]{1,4})\s*([.:]|ע[״"']?[אב])?/);
  if (!match) return null;
  const daf = fromHebrewNumber(match[1]);
  if (!daf) return null;
  const marker = match[2] || ".";
  const amud: Amud = marker.includes(":") || marker.includes("ב") ? "b" : "a";
  return { daf, amud };
}

export async function fetchPdf(apiName: string, daf: number, amud: Amud): Promise<Uint8Array> {
  const url = `${ORACLE}/api/tzurat-hadaf/page?masechta=${encodeURIComponent(apiName)}&daf=${daf}&amud=${amud}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`לא נמצא דף PDF (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
    throw new Error("השרת לא החזיר קובץ PDF");
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchToc(bookId: number): Promise<TocEntry[]> {
  const response = await fetch(`${ORACLE}/api/books/${bookId}/toc`, { cache: "no-store" });
  if (!response.ok) throw new Error("טעינת תוכן המסכת נכשלה");
  const data = (await response.json()) as { toc?: TocEntry[] };
  return data.toc || [];
}

export async function fetchSegments(bookId: number, daf: number, amud: Amud): Promise<Segment[]> {
  const toc = await fetchToc(bookId);
  const located = toc
    .map((entry) => ({ ...entry, parsed: parseDafTitle(entry.title) }))
    .filter((entry) => entry.parsed);
  const current = located.find((entry) => entry.parsed?.daf === daf && entry.parsed.amud === amud);
  if (!current) return [];
  const next = located.find((entry) => entry.index > current.index);
  const end = next ? next.index - 1 : current.index + 48;
  const response = await fetch(
    `${ORACLE}/api/books/${bookId}/content?start=${current.index}&end=${end + 5}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("טעינת טקסט הגמרא נכשלה");
  const data = (await response.json()) as { lines?: { lineIndex: number; content: string }[] };
  return (data.lines || [])
    .filter((line) => line.lineIndex >= current.index && line.lineIndex <= end)
    .filter((line) => !/^<h\d/i.test(line.content.trim()))
    .map((line) => ({ lineIndex: line.lineIndex, text: stripTags(line.content) }))
    .filter((line) => line.text.replace(/\s/g, "").length > 1);
}
