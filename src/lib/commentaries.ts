import { plainPreview, sanitizeCommentaryHtml, stripTags } from "./hebrew";
import type { CommentaryItem } from "./types";
import { ORACLE } from "./otzaria";

const PRIORITY = [
  "רשי",
  "תוספות",
  "תוספות הראש",
  "תוספות ישנים",
  "רבינו חננאל",
  "ריף",
  "רשב״א",
  "רשבא",
  "ריטבא",
  "רן",
  "ראש",
  "רמבן",
  "מהרשא",
  "מהרם",
  "פני יהושע",
  "שפת אמת",
  "בן יהוידע",
  "מאירי",
  "רשיש",
];

function keyOf(name: string): string {
  return name.replace(/[״"׳'\s]/g, "");
}

function commentatorName(sourceBook: string): string {
  return sourceBook.replace(/\s+על\s+.*/u, "").trim() || sourceBook;
}

export const BASE_LABEL = "הגמרא שעליה נאמר";

function priority(name: string): number {
  if (name === BASE_LABEL) return -1;
  const key = keyOf(name);
  const index = PRIORITY.findIndex((item) => {
    const needle = keyOf(item);
    return key === needle || (key.startsWith(needle) && key.length <= needle.length + 1);
  });
  return index === -1 ? 80 : index;
}

type RawLink = {
  sourceBook?: string;
  category?: string;
  text?: string;
  dibburHamatchil?: string;
  isLineMatch?: boolean;
};

export async function fetchCommentaries(bookId: number, line: number, baseTitle = ""): Promise<{
  lineText: string;
  commentators: string[];
  items: CommentaryItem[];
}> {
  const response = await fetch(`${ORACLE}/api/books/${bookId}/links?line=${line}`, { cache: "no-store" });
  if (!response.ok) throw new Error("טעינת המפרשים נכשלה");
  const data = (await response.json()) as { dafLabel?: string; links?: RawLink[]; lineText?: string };
  const seen = new Set<string>();
  const items: CommentaryItem[] = [];
  for (const link of data.links || []) {
    if (link.category && link.category !== "COMMENTARY" && link.category !== "LINKER") continue;
    const text = sanitizeCommentaryHtml(link.text || "");
    const plain = stripTags(text);
    if (plain.length < 8) continue;
    const rawName = commentatorName(link.sourceBook || "מפרש");
    // Rashi and Tosafot lines are linked back to the Gemara they explain; that link is named after the tractate only.
    const isBase = Boolean(baseTitle) && keyOf(rawName) === keyOf(baseTitle);
    const commentator = isBase ? BASE_LABEL : rawName;
    const signature = `${keyOf(commentator)}:${plain.slice(0, 180)}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    items.push({
      commentator,
      title: link.sourceBook || commentator,
      dibbur: stripTags(link.dibburHamatchil || "").replace(/^.*על\s+/u, ""),
      text,
    });
  }
  items.sort((a, b) => priority(a.commentator) - priority(b.commentator) || a.commentator.localeCompare(b.commentator, "he"));
  const commentators = [...new Set(items.map((item) => item.commentator))].sort(
    (a, b) => priority(a) - priority(b) || a.localeCompare(b, "he"),
  );
  return {
    lineText: data.dafLabel || data.lineText || plainPreview(items[0]?.dibbur || "", 40),
    commentators,
    items,
  };
}
