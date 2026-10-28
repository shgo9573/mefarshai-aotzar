import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { decodePdfString, normalizeHebrew, plainPreview, stripTags } from "./hebrew";
import type { Bubble, BubbleRect, LayerKind } from "./types";

export const ALGO_VERSION = 8;

const GEMARA_TOLERANCE = 0.16;
const COMMENTARY_LOW = 0.93;
const COMMENTARY_HIGH = 1.1;
const MIN_COVERAGE = 0.68;
const SMALL_GAP = 14;

export type Segment = {
  lineIndex: number;
  text: string;
};

export type LayerInput = {
  gemara: Segment[];
  rashi: Segment[];
  tosafot: Segment[];
};

type RawWord = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
};

type Row = { baseline: number; words: RawWord[] };

type Cluster = {
  row: number;
  baseline: number;
  minX: number;
  maxX: number;
  letters: number;
  words: RawWord[];
};

type Line = {
  top: number;
  bottom: number;
  minX: number;
  maxX: number;
  words: RawWord[];
  marker: boolean;
};

type Component = {
  members: number[];
  letters: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type CharRef = { ch: string; x: number; w: number; line: number };

type Placement = { segment: number; start: number; end: number; score: number };

type RectDraft = { layer: LayerKind; line: number; rect: BubbleRect };

type Draft = { order: number; rects: RectDraft[]; bubble: Omit<Bubble, "rects"> };

type Stream = {
  lines: Line[];
  chars: CharRef[];
  lineStart: number[];
  lineEnd: number[];
  lineText: string[];
  text: string;
  /** Stream indices where a printed line begins (dibburim open lines). */
  starts: Set<number>;
};

type PdfTextItem = {
  str?: string;
  transform: number[];
  width?: number;
  height?: number;
};

export type DetectionStats = {
  gemaraFont: number;
  commentaryFont: number;
  pitch: number;
  column: { minX: number; maxX: number; minY: number; maxY: number } | null;
  segments: number;
  matched: number;
  filled: number;
  gemaraWords: number;
  lines: number;
  wideLines: number;
  layers: Record<LayerKind, number>;
  sides: { rashi: "right" | "left" | null; tosafot: "right" | "left" | null };
  collisions: number;
  restored: number;
  method: string;
};

export type DetectionResult = {
  pageWidth: number;
  pageHeight: number;
  bubbles: Bubble[];
  stats: DetectionStats;
};

const GLYPH_WIDTH: Record<string, number> = {
  א: 0.62, ב: 0.58, ג: 0.42, ד: 0.55, ה: 0.6, ו: 0.28, ז: 0.32, ח: 0.6, ט: 0.58, י: 0.28,
  כ: 0.53, ך: 0.55, ל: 0.55, מ: 0.6, ם: 0.6, נ: 0.4, ן: 0.28, ס: 0.58, ע: 0.58, פ: 0.58,
  ף: 0.55, צ: 0.55, ץ: 0.55, ק: 0.58, ר: 0.55, ש: 0.68, ת: 0.62,
};

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function letterCount(text: string): number {
  return normalizeHebrew(text).length;
}

function glyphWidth(char: string): number {
  if (char === " ") return 0.3;
  if (GLYPH_WIDTH[char]) return GLYPH_WIDTH[char];
  if (/[\u0591-\u05C7]/.test(char)) return 0;
  return 0.25;
}

function wordToChars(word: RawWord, line: number): CharRef[] {
  const glyphs = [...word.text];
  const weights = glyphs.map(glyphWidth);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let right = word.x + word.w;
  const chars: CharRef[] = [];
  glyphs.forEach((glyph, index) => {
    const width = (weights[index] / total) * word.w;
    const x = right - width;
    right = x;
    const normalized = normalizeHebrew(glyph);
    if (normalized) chars.push({ ch: normalized, x, w: Math.max(width, 0.8), line });
  });
  return chars;
}

function extractWords(
  items: PdfTextItem[],
  viewport: { convertToViewportPoint: (x: number, y: number) => [number, number] },
): RawWord[] {
  const words: RawWord[] = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const fontSize = Math.hypot(item.transform[2] || 0, item.transform[3] || 0) || Math.abs(item.transform[3] || 0);
    const height = item.height || fontSize;
    const width = item.width || 0;
    if (width < 0.4 || height < 0.4) continue;
    const [x, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    words.push({
      text: decodePdfString(item.str).replace(/\s+/g, " ").trim(),
      x,
      y: baseline - height,
      w: width,
      h: height,
      fontSize,
    });
  }
  return words;
}

/** Dominant font size by letter mass inside a range. */
function dominantFont(words: RawWord[], min: number, max: number, pageHeight: number): number {
  const buckets = new Map<number, { weight: number; sizes: number[] }>();
  for (const word of words) {
    if (word.y < pageHeight * 0.03 || word.fontSize < min || word.fontSize > max) continue;
    const letters = letterCount(word.text);
    if (letters < 2) continue;
    const key = Math.round(word.fontSize * 10);
    const bucket = buckets.get(key) || { weight: 0, sizes: [] };
    bucket.weight += letters;
    bucket.sizes.push(word.fontSize);
    buckets.set(key, bucket);
  }
  let best: { weight: number; sizes: number[] } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  return best ? median(best.sizes) : 0;
}

/**
 * Page typography differs between tractates (the Gemara is 13.7pt in Berachot but about 11.8pt in Menachot),
 * so sizes are never hard-coded. Count letters per font size, merge neighbouring sizes, and take the largest
 * size that carries a real share of the text as the Gemara and the next size down as Rashi / Tosafot.
 * Titles, catch-words and chapter openers are too sparse to qualify; margin notes are too small.
 */
function detectFonts(words: RawWord[], pageHeight: number): { gemara: number; commentary: number } {
  const buckets = new Map<number, { mass: number; sizes: number[] }>();
  for (const word of words) {
    if (word.y < pageHeight * 0.03 || word.fontSize < 8.8 || word.fontSize > 18) continue;
    const letters = letterCount(word.text);
    if (letters < 2) continue;
    const key = Math.round(word.fontSize * 10);
    const bucket = buckets.get(key) || { mass: 0, sizes: [] };
    bucket.mass += letters;
    bucket.sizes.push(word.fontSize);
    buckets.set(key, bucket);
  }
  const clusters: { mass: number; sizes: number[] }[] = [];
  let previousKey = -Infinity;
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(key)!;
    const last = clusters[clusters.length - 1];
    if (last && key - previousKey <= 3) {
      last.mass += bucket.mass;
      last.sizes.push(...bucket.sizes);
    } else {
      clusters.push({ mass: bucket.mass, sizes: [...bucket.sizes] });
    }
    previousKey = key;
  }
  if (!clusters.length) return { gemara: 0, commentary: 0 };
  const top = Math.max(...clusters.map((cluster) => cluster.mass));
  const sizes = clusters
    .map((cluster) => ({ size: median(cluster.sizes), mass: cluster.mass }))
    .sort((a, b) => b.size - a.size);
  // Opening pages hold only a few lines of Gemara, so its floor is absolute (about 15 words), not a share of the page.
  const floor = Math.max(70, top * 0.03);
  const gemara = sizes.find((cluster) => cluster.mass >= floor)?.size || 0;
  const commentary = sizes.find((cluster) => cluster.size <= gemara * 0.93 && cluster.mass >= top * 0.12)?.size || 0;
  return { gemara, commentary };
}

function groupRows(words: RawWord[], font: number): Row[] {
  const sorted = [...words].sort((a, b) => a.y + a.h - (b.y + b.h));
  const tolerance = Math.max(2.2, font * 0.28);
  const rows: Row[] = [];
  for (const word of sorted) {
    const baseline = word.y + word.h;
    const row = rows[rows.length - 1];
    if (row && baseline - row.baseline <= tolerance) {
      row.words.push(word);
      row.baseline = row.words.reduce((sum, item) => sum + item.y + item.h, 0) / row.words.length;
    } else {
      rows.push({ baseline, words: [word] });
    }
  }
  return rows;
}

function estimatePitch(rows: Row[], fallback: number): number {
  const gaps: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const gap = rows[index].baseline - rows[index - 1].baseline;
    if (gap > fallback * 0.45 && gap < fallback * 2.4) gaps.push(gap);
  }
  return gaps.length ? median(gaps) : fallback;
}

/** Break a row at wide horizontal gaps so two columns on the same line stay apart. */
function splitRow(row: Row, rowIndex: number, gap: number): Cluster[] {
  const sorted = [...row.words].sort((a, b) => b.x + b.w - (a.x + a.w));
  const clusters: Cluster[] = [];
  let current: RawWord[] = [];
  let left = Infinity;
  const flush = () => {
    if (!current.length) return;
    clusters.push({
      row: rowIndex,
      baseline: row.baseline,
      minX: Math.min(...current.map((word) => word.x)),
      maxX: Math.max(...current.map((word) => word.x + word.w)),
      letters: current.reduce((sum, word) => sum + letterCount(word.text), 0),
      words: current,
    });
    current = [];
    left = Infinity;
  };
  for (const word of sorted) {
    if (current.length && left - (word.x + word.w) > gap) flush();
    current.push(word);
    left = Math.min(left, word.x);
  }
  flush();
  return clusters;
}

/** Connected components: lines that are vertically near and horizontally overlapping form one block. */
function components(clusters: Cluster[], reach: number): Component[] {
  const parent = clusters.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  for (let a = 0; a < clusters.length; a += 1) {
    for (let b = a + 1; b < clusters.length; b += 1) {
      const first = clusters[a];
      const second = clusters[b];
      if (first.row === second.row) continue;
      if (Math.abs(first.baseline - second.baseline) > reach) continue;
      const overlap = Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX);
      if (overlap > -6) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, Component>();
  clusters.forEach((cluster, index) => {
    const root = find(index);
    const group =
      groups.get(root) ||
      ({ members: [], letters: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity } as Component);
    group.members.push(index);
    group.letters += cluster.letters;
    group.minX = Math.min(group.minX, cluster.minX);
    group.maxX = Math.max(group.maxX, cluster.maxX);
    group.minY = Math.min(group.minY, cluster.baseline);
    group.maxY = Math.max(group.maxY, cluster.baseline);
    groups.set(root, group);
  });
  return [...groups.values()].sort((a, b) => b.letters - a.letters);
}

function buildLines(clusters: Cluster[], members: number[], pitch: number, font: number): Line[] {
  const byRow = new Map<number, { words: RawWord[]; baseline: number }>();
  for (const index of members) {
    const cluster = clusters[index];
    const entry = byRow.get(cluster.row) || { words: [], baseline: cluster.baseline };
    entry.words.push(...cluster.words);
    byRow.set(cluster.row, entry);
  }
  const band = Math.max(6, Math.min(pitch - 0.8, font * 0.95));
  const lines: Line[] = [];
  for (const entry of byRow.values()) {
    if (!entry.words.some((word) => letterCount(word.text) > 0)) continue;
    // The bubble must cover the tallest glyphs on its line (e.g. an oversized
    // dibbur-hamatchil opener), not just the body height. Neighbours are
    // clamped to a shared midpoint below so nothing overlaps.
    const glyphTop = Math.min(...entry.words.map((word) => word.y));
    const glyphBottom = Math.max(...entry.words.map((word) => word.y + word.h));
    const bottom = Math.max(entry.baseline + 1.4, glyphBottom + 1.2);
    const top = Math.min(bottom - band, glyphTop - 1.0);
    lines.push({
      top,
      bottom,
      minX: Math.min(...entry.words.map((word) => word.x)),
      maxX: Math.max(...entry.words.map((word) => word.x + word.w)),
      words: entry.words,
      marker: false,
    });
  }
  const sorted = lines.sort((a, b) => a.top - b.top);
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const cur = sorted[index];
    if (prev.bottom > cur.top) {
      const mid = (prev.bottom + cur.top) / 2;
      prev.bottom = mid;
      cur.top = mid;
    }
  }
  return sorted;
}

/** Oversized Gemara glyphs: a chapter's opening word, and גמ׳ / מתני׳ markers. */
function attachMarkers(
  words: RawWord[],
  lines: Line[],
  font: number,
  pitch: number,
  pageHeight: number,
  reserved: { minX: number; maxX: number; minY: number; maxY: number }[] = [],
) {
  const body = lines.filter((line) => !line.marker);
  if (!body.length) return;
  const markers = words.filter((word) => {
    if (word.fontSize < font + 1 || word.fontSize > 40 || word.y <= pageHeight * 0.03 || letterCount(word.text) === 0) return false;
    const cx = word.x + word.w / 2;
    const cy = word.y + word.h / 2;
    return !reserved.some((box) => cx >= box.minX - 3 && cx <= box.maxX + 3 && cy >= box.minY - 3 && cy <= box.maxY + 3);
  });
  const added: Line[] = [];
  for (const word of markers) {
    const center = word.x + word.w / 2;
    const base = word.y + word.h;
    let host: Line | null = null;
    let distance = Infinity;
    for (const line of body) {
      const gap = Math.abs(line.bottom - 1.4 - base);
      if (gap <= pitch * 0.9 && center >= line.minX - 8 && center <= line.maxX + 8 && gap < distance) {
        host = line;
        distance = gap;
      }
    }
    if (host) {
      host.words.push(word);
      continue;
    }
    const markerLine: Line = {
      top: word.y - 1.0,
      bottom: base + 1.2,
      minX: word.x,
      maxX: word.x + word.w,
      words: [word],
      marker: true,
    };
    const first = body[0];
    if (base <= first.bottom && base >= first.top - pitch * 4.5 && center >= first.minX - 10 && center <= first.maxX + 10) {
      added.push(markerLine);
      continue;
    }
    const upper = [...body].reverse().find((line) => line.bottom <= word.y + 3);
    const lower = body.find((line) => line.top >= base - 3);
    if (
      upper &&
      lower &&
      lower.top - upper.bottom <= pitch * 5 &&
      center >= upper.minX &&
      center <= upper.maxX &&
      center >= lower.minX &&
      center <= lower.maxX
    ) {
      added.push(markerLine);
    }
  }
  lines.push(...added);
  // A marker line never reaches into its neighbours: clip it to the free band between them.
  for (const marker of added) {
    for (const other of lines) {
      if (other === marker || other.marker) continue;
      if (overlapLength(marker.minX, marker.maxX, other.minX, other.maxX) <= 0) continue;
      if (other.top < marker.top && other.bottom > marker.top && other.bottom + 0.4 < marker.bottom - 6) {
        marker.top = other.bottom + 0.4;
      }
      if (other.top < marker.bottom && other.bottom > marker.bottom && other.top - 0.4 > marker.top + 6) {
        marker.bottom = other.top - 0.4;
      }
    }
  }
  lines.sort((a, b) => a.top - b.top || (a.marker === b.marker ? 0 : a.marker ? -1 : 1));
}

function buildStream(lines: Line[]): Stream {
  const chars: CharRef[] = [];
  const lineStart: number[] = [];
  const lineEnd: number[] = [];
  const lineText: string[] = [];
  lines.forEach((line, index) => {
    const ordered = [...line.words].sort((a, b) => b.x + b.w - (a.x + a.w));
    lineStart[index] = chars.length;
    for (const word of ordered) chars.push(...wordToChars(word, index));
    lineEnd[index] = chars.length - 1;
    lineText[index] = ordered.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
  });
  return {
    lines,
    chars,
    lineStart,
    lineEnd,
    lineText,
    text: chars.map((char) => char.ch).join(""),
    starts: new Set(lineStart),
  };
}

/**
 * Semi-global edit distance: find where a segment sits inside the page stream.
 * Commentary segments open with their dibbur hamatchil at a printed line start,
 * so when `anchors` is given an end position whose alignment starts at a line
 * start wins ties (and near-ties up to the bonus). This keeps one segment from
 * swallowing its neighbour's dibbur. Never used for the Gemara, whose segments
 * routinely start mid-line.
 */
const LINE_START_BONUS = 1.5;

function alignSegment(target: string, stream: string, from: number, slack: number, anchors?: Set<number>) {
  const n = target.length;
  const to = Math.min(stream.length, from + Math.ceil(n * 1.35) + 60 + slack);
  const m = to - from;
  if (n < 3 || m < 3) return null;
  let prevCost = new Int32Array(m + 1);
  let prevStart = new Int32Array(m + 1);
  let prevMatch = new Int32Array(m + 1);
  let curCost = new Int32Array(m + 1);
  let curStart = new Int32Array(m + 1);
  let curMatch = new Int32Array(m + 1);
  for (let j = 0; j <= m; j += 1) prevStart[j] = j;
  for (let i = 1; i <= n; i += 1) {
    const code = target.charCodeAt(i - 1);
    curCost[0] = prevCost[0] + 1;
    curStart[0] = prevStart[0];
    curMatch[0] = prevMatch[0];
    for (let j = 1; j <= m; j += 1) {
      const same = stream.charCodeAt(from + j - 1) === code;
      let cost = prevCost[j - 1] + (same ? 0 : 1);
      let start = prevStart[j - 1];
      let match = prevMatch[j - 1] + (same ? 1 : 0);
      const up = prevCost[j] + 1;
      if (up < cost || (up === cost && prevMatch[j] > match)) {
        cost = up;
        start = prevStart[j];
        match = prevMatch[j];
      }
      const left = curCost[j - 1] + 1;
      if (left < cost || (left === cost && curMatch[j - 1] > match)) {
        cost = left;
        start = curStart[j - 1];
        match = curMatch[j - 1];
      }
      curCost[j] = cost;
      curStart[j] = start;
      curMatch[j] = match;
    }
    [prevCost, curCost] = [curCost, prevCost];
    [prevStart, curStart] = [curStart, prevStart];
    [prevMatch, curMatch] = [curMatch, prevMatch];
  }
  let bestJ = -1;
  let bestKey = Infinity;
  let bestMatch = -1;
  for (let j = 1; j <= m; j += 1) {
    const key = prevCost[j] - (anchors?.has(from + prevStart[j]) ? LINE_START_BONUS : 0);
    if (key < bestKey || (key === bestKey && prevMatch[j] > bestMatch)) {
      bestKey = key;
      bestMatch = prevMatch[j];
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;
  let start = from + prevStart[bestJ];
  // Printed text abbreviates ("דר׳" for "דרבי"), so the cheapest alignment may skip the segment's first letters.
  // The previous segment ended at `from`; if the gap to it is short and the skipped stream text is a prefix of the
  // segment, the segment really starts where the previous one ended.
  const skipped = start - from;
  if (skipped > 0 && skipped <= Math.max(6, Math.floor(n * 0.2))) {
    // Strict: the skipped stream text must read as an in-order prefix of the segment (e.g. "קשיאדר" vs "קשיאדרבי").
    const head = stream.slice(from, start);
    let cursorInTarget = 0;
    let ordered = 0;
    for (const char of head) {
      const at = target.indexOf(char, cursorInTarget);
      if (at >= 0 && at - cursorInTarget <= 2) {
        ordered += 1;
        cursorInTarget = at + 1;
      }
    }
    if (ordered === head.length) start = from;
  }
  return { start, end: from + bestJ, coverage: bestMatch / n };
}

/** Tiny edit distance for dibbur-head comparisons (a handful of chars). */
function headDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  for (let j = 0; j <= m; j += 1) prev[j] = j;
  for (let i = 1; i <= n; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= m; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

function placeSegments(targets: string[], stream: string, anchors?: Set<number>): Placement[] {
  const aligned: (Placement | null)[] = targets.map(() => null);
  const accept = (result: ReturnType<typeof alignSegment>, target: string, cursor: number) => {
    if (!result) return false;
    const span = result.end - result.start;
    const tight = result.start - cursor <= 2 && span <= target.length * 1.05 && span >= target.length * 0.5;
    const threshold = tight ? MIN_COVERAGE - 0.12 : MIN_COVERAGE;
    return result.coverage >= threshold && span <= target.length * 1.6 + 10;
  };

  // Forward pass: each segment is searched right after the previous match. If a segment cannot be found there,
  // the search window for the next ones grows by its length (slack), so one missing segment does not stall the rest.
  let cursor = 0;
  let slack = 0;
  targets.forEach((target, index) => {
    if (target.length < 3) return;
    const result = alignSegment(target, stream, cursor, slack);
    if (accept(result, target, cursor) && result) {
      aligned[index] = { segment: index, start: Math.max(result.start, cursor), end: result.end, score: Math.round(result.coverage * 100) / 100 };
      cursor = result.end;
      slack = 0;
    } else {
      slack += target.length;
    }
  });

  // Recovery pass: a wrong anchor squeezes every later segment into too little text. Detect such runs (three or
  // more consecutive misses) and re-align them in the whole free region between the surrounding good anchors.
  for (let index = 0; index < targets.length; ) {
    if (aligned[index] || targets[index].length < 3) {
      index += 1;
      continue;
    }
    let runEnd = index;
    while (runEnd < targets.length && !aligned[runEnd]) runEnd += 1;
    const runLength = runEnd - index;
    if (runLength >= 3) {
      let previous = index - 1;
      while (previous >= 0 && !aligned[previous]) previous -= 1;
      let regionStart = previous >= 0 ? (aligned[previous] as Placement).end : 0;
      const regionEnd = runEnd < targets.length ? (aligned[runEnd] as Placement).start : stream.length;
      // The anchor just before the run is the usual suspect: drop it and let the run re-claim its text.
      const suspect = previous >= 0 ? (aligned[previous] as Placement) : null;
      if (suspect && regionEnd - regionStart < targets.slice(index, runEnd).reduce((sum, t) => sum + t.length, 0) * 0.6) {
        regionStart = suspect.start;
        aligned[previous] = null;
        index = previous;
      }
      let local = regionStart;
      for (let k = index; k < runEnd; k += 1) {
        const target = targets[k];
        if (target.length < 3) continue;
        const room = regionEnd - local;
        if (room < 3) break;
        const result = alignSegment(target, stream.slice(0, regionEnd), local, Math.max(0, room - target.length));
        if (accept(result, target, local) && result) {
          aligned[k] = { segment: k, start: Math.max(result.start, local), end: result.end, score: Math.round(result.coverage * 100) / 100 };
          local = result.end;
        }
      }
    }
    index = Math.max(index + 1, runEnd);
  }

  // Dibbur snap: a commentary segment opens with its dibbur hamatchil at a
  // printed line start. If a line start just behind a segment's start reads
  // like that segment's head, the previous segment swallowed the dibbur —
  // move the boundary to the line start and give the dibbur back.
  if (anchors && anchors.size) {
    const starts = [...anchors].sort((a, b) => a - b);
    const ordered = aligned.filter((item): item is Placement => Boolean(item)).sort((a, b) => a.start - b.start);
    ordered.forEach((cur, order) => {
      if (cur.score === 0.5) return;
      const head = targets[cur.segment].slice(0, 8);
      if (head.length < 6) return;
      const prev = order > 0 ? ordered[order - 1] : null;
      const floor = prev ? Math.max(prev.start + 1, prev.end - 30) : 0;
      for (let s = starts.length - 1; s >= 0; s -= 1) {
        const p = starts[s];
        if (p > cur.start) continue;
        if (p < cur.start - 24 || p < floor) break;
        if (headDistance(stream.slice(p, p + head.length), head) <= 2) {
          cur.start = p;
          if (prev && prev.end > p) prev.end = p;
          break;
        }
      }
    });
  }

  if (aligned.some(Boolean)) {
    // Fill unplaced runs proportionally — and guarantee every segment a
    // minimum share. Without the guarantee, trailing segments vanish whenever
    // the previous placement overshoots to (near) the stream end, which is
    // exactly how the last Rashi/Tosafot comments of a daf went missing.
    let cursor = 0;
    const takeRun = () => {
      while (cursor < targets.length && (aligned[cursor] || targets[cursor].length < 3)) cursor += 1;
      if (cursor >= targets.length) return null;
      const start = cursor;
      while (cursor < targets.length && !aligned[cursor]) cursor += 1;
      return { from: start, to: cursor };
    };
    let run = takeRun();
    while (run) {
      let prevPl: Placement | null = null;
      for (let i = run.from - 1; i >= 0; i -= 1) {
        if (aligned[i]) {
          prevPl = aligned[i] as Placement;
          break;
        }
      }
      let nextPl: Placement | null = null;
      for (let i = run.to; i < targets.length; i += 1) {
        if (aligned[i]) {
          nextPl = aligned[i] as Placement;
          break;
        }
      }
      let regionStart = prevPl ? prevPl.end : 0;
      let regionEnd = nextPl ? nextPl.start : stream.length;
      const pend: number[] = [];
      for (let i = run.from; i < run.to; i += 1) if (targets[i].length >= 3) pend.push(i);
      const need = pend.length * 3;
      let span = regionEnd - regionStart;
      if (span < need && prevPl && prevPl.end - prevPl.start > 3) {
        const take = Math.min(prevPl.end - prevPl.start - 3, need - span);
        prevPl.end -= take;
        regionStart -= take;
        span += take;
      }
      if (span < need && nextPl && nextPl.end - nextPl.start > 3) {
        const take = Math.min(nextPl.end - nextPl.start - 3, need - span);
        nextPl.start += take;
        regionEnd += take;
        span += take;
      }
      if (pend.length && span > 0) {
        const total = pend.reduce((sum, index) => sum + targets[index].length, 0) || 1;
        const shares = pend.map((index) => Math.max(3, Math.round((span * targets[index].length) / total)));
        let over = shares.reduce((a, b) => a + b, 0) - span;
        if (over > 0) {
          const order = shares.map((_, k) => k).sort((a, b) => shares[b] - shares[a]);
          for (const k of order) {
            if (over <= 0) break;
            const cut = Math.min(shares[k] - 3, over);
            shares[k] -= cut;
            over -= cut;
          }
        }
        let position = regionStart;
        pend.forEach((index, k) => {
          const end = k === pend.length - 1 ? regionEnd : Math.min(regionEnd, position + Math.max(1, shares[k]));
          if (end > position) aligned[index] = { segment: index, start: position, end, score: 0.5 };
          position = end;
        });
      }
      run = takeRun();
    }
  }

  const placed = aligned.filter((item): item is Placement => Boolean(item)).sort((a, b) => a.start - b.start);
  if (placed.length) {
    if (placed[0].start <= SMALL_GAP) placed[0].start = 0;
    const last = placed[placed.length - 1];
    if (stream.length - last.end <= SMALL_GAP) last.end = stream.length;
    for (let index = 1; index < placed.length; index += 1) {
      const gap = placed[index].start - placed[index - 1].end;
      if (gap > 0 && gap <= SMALL_GAP) {
        const middle = placed[index - 1].end + Math.floor(gap / 2);
        placed[index - 1].end = middle;
        placed[index].start = middle;
      } else if (gap < 0) {
        // Overlapping claims (usually a swallowed dibbur): split at the midpoint
        // so each segment keeps its own side instead of one covering both.
        const middle = placed[index - 1].end + Math.floor(gap / 2);
        placed[index - 1].end = middle;
        placed[index].start = middle;
      }
    }
  }
  return placed;
}

function rectsForRange(stream: Stream, layer: LayerKind, start: number, end: number): RectDraft[] {
  const spans = new Map<number, { minX: number; maxX: number; first: boolean; last: boolean }>();
  for (let index = start; index < end; index += 1) {
    const char = stream.chars[index];
    if (!char) continue;
    const span = spans.get(char.line) || { minX: Infinity, maxX: -Infinity, first: false, last: false };
    span.minX = Math.min(span.minX, char.x);
    span.maxX = Math.max(span.maxX, char.x + char.w);
    if (index === stream.lineStart[char.line]) span.first = true;
    if (index === stream.lineEnd[char.line]) span.last = true;
    spans.set(char.line, span);
  }
  const drafts: RectDraft[] = [];
  for (const [lineIndex, span] of [...spans.entries()].sort((a, b) => a[0] - b[0])) {
    const line = stream.lines[lineIndex];
    const right = span.first ? line.maxX + 2.2 : Math.min(line.maxX + 2.2, span.maxX + 1.8);
    const left = span.last ? line.minX - 2.2 : Math.max(line.minX - 2.2, span.minX - 1.8);
    if (right - left < 4) continue;
    drafts.push({ layer, line: lineIndex, rect: { x: left, y: line.top, w: right - left, h: line.bottom - line.top } });
  }
  return drafts;
}

/** Neighbours on the same line of the same layer meet at a shared edge. */
function separateWithinLayer(drafts: RectDraft[]) {
  const byLine = new Map<string, RectDraft[]>();
  for (const draft of drafts) {
    const key = `${draft.layer}:${draft.line}`;
    const list = byLine.get(key) || [];
    list.push(draft);
    byLine.set(key, list);
  }
  for (const list of byLine.values()) {
    list.sort((a, b) => a.rect.x - b.rect.x);
    for (let index = 1; index < list.length; index += 1) {
      const left = list[index - 1].rect;
      const right = list[index].rect;
      const edge = left.x + left.w;
      if (edge > right.x - 1.2) {
        const middle = (edge + right.x) / 2;
        left.w = Math.max(2, middle - 0.7 - left.x);
        const rightEdge = right.x + right.w;
        right.x = middle + 0.7;
        right.w = Math.max(2, rightEdge - right.x);
      }
    }
  }
}

/** A commentary rect never covers Gemara: it is trimmed back to the free side. */
function clipAgainst(target: RectDraft[], blockers: RectDraft[]): number {
  let clipped = 0;
  for (const draft of target) {
    for (const blocker of blockers) {
      const a = draft.rect;
      const b = blocker.rect;
      const vertical = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (vertical <= Math.min(a.h, b.h) * 0.25) continue;
      const horizontal = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (horizontal <= 0) continue;
      clipped += 1;
      const centerA = a.x + a.w / 2;
      const centerB = b.x + b.w / 2;
      if (centerA <= centerB) {
        const edge = Math.min(a.x + a.w, b.x - 1.2);
        a.w = edge - a.x;
      } else {
        const edge = Math.max(a.x, b.x + b.w + 1.2);
        a.w = a.x + a.w - edge;
        a.x = edge;
      }
    }
  }
  return clipped;
}

/** Final guarantee: no two bubbles share a pixel. Gemara wins over commentary; earlier wins over later. */
function resolveOverlaps(items: { layer: LayerKind; owner: number; rect: BubbleRect }[]): number {
  const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y);
  let fixed = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.rect.y >= a.rect.y + a.rect.h) break;
      if (a.owner === b.owner) continue;
      const vertical = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
      if (vertical <= 0.6) continue;
      const horizontal = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
      if (horizontal <= 0.6) continue;
      fixed += 1;
      const victim =
        a.layer !== b.layer ? (a.layer === "gemara" ? b : a) : a.owner > b.owner ? a : b;
      const keeper = victim === a ? b : a;
      if (victim.rect.x + victim.rect.w / 2 <= keeper.rect.x + keeper.rect.w / 2) {
        const edge = Math.min(victim.rect.x + victim.rect.w, keeper.rect.x - 1.2);
        victim.rect.w = Math.max(0, edge - victim.rect.x);
      } else {
        const edge = Math.max(victim.rect.x, keeper.rect.x + keeper.rect.w + 1.2);
        victim.rect.w = Math.max(0, victim.rect.x + victim.rect.w - edge);
        victim.rect.x = edge;
      }
    }
  }
  return fixed;
}

function buildLayerBubbles(
  stream: Stream,
  layer: LayerKind,
  segments: Segment[],
  idPrefix: string,
  includeLeftovers = true,
  anchorLineStarts = false,
): { drafts: Draft[]; matched: number; filled: number } {
  const targets = segments.map((segment) => normalizeHebrew(segment.text));
  const placed = placeSegments(targets, stream.text, anchorLineStarts ? stream.starts : undefined);
  const covered = new Uint8Array(stream.text.length);
  for (const placement of placed) covered.fill(1, placement.start, placement.end);

  const drafts: Draft[] = [];
  for (const placement of placed) {
    const segment = segments[placement.segment];
    let rects = rectsForRange(stream, layer, placement.start, placement.end);
    if (!rects.length) {
      // Aligned but nothing drawable (all chars filtered): fall back to the
      // full line holding the placement start, marked as estimated.
      const at = Math.max(0, Math.min(stream.chars.length - 1, placement.start));
      const line = stream.chars[at]?.line ?? 0;
      rects = rectsForRange(stream, layer, stream.lineStart[line] ?? at, (stream.lineEnd[line] ?? at) + 1);
      if (!rects.length) continue;
      drafts.push({
        order: placement.start,
        rects,
        bubble: {
          id: `${idPrefix}-${segment.lineIndex}`,
          layer,
          lineIndex: segment.lineIndex,
          segmentIndex: placement.segment + 1,
          text: stripTags(segment.text),
          preview: plainPreview(segment.text),
          score: 0.5,
          kind: "segment",
        },
      });
      continue;
    }
    drafts.push({
      order: placement.start,
      rects,
      bubble: {
        id: `${idPrefix}-${segment.lineIndex}`,
        layer,
        lineIndex: segment.lineIndex,
        segmentIndex: placement.segment + 1,
        text: stripTags(segment.text),
        preview: plainPreview(segment.text),
        score: placement.score,
        kind: "segment",
      },
    });
  }

  let leftovers = 0;
  if (includeLeftovers) stream.lines.forEach((_, line) => {
    let runStart = -1;
    for (let index = stream.lineStart[line]; index <= stream.lineEnd[line] + 1; index += 1) {
      const free = index <= stream.lineEnd[line] && !covered[index];
      if (free && runStart < 0) runStart = index;
      if (!free && runStart >= 0) {
        if (index - runStart >= 3) {
          const rects = rectsForRange(stream, layer, runStart, index);
          if (rects.length) {
            leftovers += 1;
            drafts.push({
              order: runStart,
              rects,
              bubble: {
                id: `${idPrefix}-line-${leftovers}`,
                layer,
                lineIndex: null,
                segmentIndex: 0,
                text: stream.lineText[line],
                preview: plainPreview(stream.lineText[line], 80),
                score: 1,
                kind: "line",
              },
            });
          }
        }
        runStart = -1;
      }
    }
  });

  const matched = placed.filter((placement) => placement.score !== 0.5).length;
  return { drafts, matched, filled: placed.length - matched };
}

type Side = "rashi" | "tosafot";

type Fragment = Cluster & { label: Side | null };

type SplitPoint = { index: number; x0: number; x1: number; left: Side; right: Side };

type Group = {
  row: number;
  baseline: number;
  items: RawWord[];
  votes: { r: number; t: number }[];
  split: SplitPoint | null;
  label: Side | null;
};

/** Narrowest empty strip we accept as the gutter between two columns. */
const MIN_GUTTER = 5.5;
/** A split needs real text evidence on both sides. */
const MIN_SIDE_VOTES = 3;
/** The split must beat "the whole line is one commentary" by this many votes. */
const SPLIT_MARGIN = 5;

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function overlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function trigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let index = 0; index + 3 <= value.length; index += 1) set.add(value.slice(index, index + 3));
  return set;
}

/** Trigrams that appear in `source` and nowhere in `other`: the only evidence that actually discriminates. */
function uniqueGrams(source: Set<string>, other: Set<string>): Set<string> {
  const unique = new Set<string>();
  for (const gram of source) if (!other.has(gram)) unique.add(gram);
  return unique;
}

function itemVotes(text: string, onlyRashi: Set<string>, onlyTosafot: Set<string>) {
  const normalized = normalizeHebrew(text);
  let r = 0;
  let t = 0;
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    const gram = normalized.slice(index, index + 3);
    if (onlyRashi.has(gram)) r += 1;
    else if (onlyTosafot.has(gram)) t += 1;
  }
  return { r, t };
}

function support(votes: { r: number; t: number }[], label: Side): number {
  return votes.reduce((sum, vote) => sum + (label === "rashi" ? vote.r - vote.t : vote.t - vote.r), 0);
}

/**
 * One physical line segment (items sorted left to right) holds either one commentary or two side by side.
 * Try every gap as a possible gutter and keep the split with the best textual support.
 */
function decideGroup(items: RawWord[], votes: { r: number; t: number }[]): { split: SplitPoint | null; label: Side | null } {
  const n = items.length;
  const preR = [0];
  const preT = [0];
  const preRight = [-Infinity];
  for (let index = 0; index < n; index += 1) {
    preR.push(preR[index] + votes[index].r);
    preT.push(preT[index] + votes[index].t);
    preRight.push(Math.max(preRight[index], items[index].x + items[index].w));
  }
  const totalR = preR[n];
  const totalT = preT[n];
  const total = totalR + totalT;
  const singleScore = Math.abs(totalR - totalT);

  let best: SplitPoint | null = null;
  let bestScore = -Infinity;
  for (let k = 1; k < n; k += 1) {
    const gap = items[k].x - preRight[k];
    if (gap < MIN_GUTTER) continue;
    const leftR = preR[k];
    const leftT = preT[k];
    const rightR = totalR - leftR;
    const rightT = totalT - leftT;
    if (leftR + leftT < MIN_SIDE_VOTES || rightR + rightT < MIN_SIDE_VOTES) continue;
    const leftDiff = leftR - leftT;
    const rightDiff = rightR - rightT;
    const bonus = 0.35 * Math.min(gap, 16);
    if (leftDiff > 0 && rightDiff < 0) {
      const score = leftDiff - rightDiff + bonus;
      if (score > bestScore) {
        bestScore = score;
        best = { index: k, x0: preRight[k], x1: items[k].x, left: "rashi", right: "tosafot" };
      }
    }
    if (leftDiff < 0 && rightDiff > 0) {
      const score = rightDiff - leftDiff + bonus;
      if (score > bestScore) {
        bestScore = score;
        best = { index: k, x0: preRight[k], x1: items[k].x, left: "tosafot", right: "rashi" };
      }
    }
  }
  if (best && bestScore - singleScore >= SPLIT_MARGIN) return { split: best, label: null };
  if (total >= 4 && singleScore >= Math.max(3, total * 0.5)) {
    return { split: null, label: totalR >= totalT ? "rashi" : "tosafot" };
  }
  return { split: null, label: null };
}

/**
 * Labels every piece of commentary-size text as Rashi, Tosafot, or neither.
 *  1. Keep only text inside the body x-range, which removes margin headings (Masoret HaShas, Hagahot HaBach...).
 *  2. Cut each row at wide gaps (the Gemara channel), then decide each segment by unique-trigram votes.
 *  3. Rows with no clear evidence reuse the gutter position found in neighbouring rows.
 *  4. A fragment with no evidence is labelled only if the same commentary sits right above AND below it.
 */
function labelCommentary(
  words: RawWord[],
  font: number,
  input: LayerInput,
  pageHeight: number,
): { fragments: Fragment[]; pitch: number } {
  if (!font) return { fragments: [], pitch: 10.4 };
  const body = words.filter(
    (word) => Math.abs(word.fontSize - font) <= 0.3 && letterCount(word.text) >= 2 && word.y > pageHeight * 0.03,
  );
  if (!body.length) return { fragments: [], pitch: font * 0.93 };
  const low = percentile(body.map((word) => word.x), 0.01) - 5;
  const high = percentile(body.map((word) => word.x + word.w), 0.99) + 5;
  const sized = words.filter(
    (word) =>
      word.fontSize >= font * COMMENTARY_LOW &&
      word.fontSize <= font * COMMENTARY_HIGH &&
      word.w > 0.6 &&
      word.y > pageHeight * 0.03 &&
      word.x >= low &&
      word.x + word.w <= high,
  );
  // Large opening words ("דיבור המתחיל" of Tosafot) sit on a commentary baseline, inside the column, above the
  // Gemara size. They belong to the commentary line they open, not to the Gemara.
  const openers = words.filter((word) => {
    if (word.fontSize <= font * COMMENTARY_HIGH || word.fontSize > 40) return false;
    // A real opening word, not a "גמ׳" / "מתני׳" marker the printer placed in the margin.
    if (letterCount(word.text) < 3 || /['׳"״]/.test(word.text)) return false;
    if (word.y <= pageHeight * 0.03 || word.x < low || word.x + word.w > high) return false;
    const base = word.y + word.h;
    const sameLine = sized.filter((other) => Math.abs(other.y + other.h - base) <= font * 0.4);
    const continues = sameLine.some(
      (other) => other.x + other.w <= word.x + 2 && word.x - (other.x + other.w) <= font * 1.6,
    );
    // A neighbouring column to the right (e.g. Rashi next to a Gemara opener)
    // disqualifies the word; text touching it on the same line does not — a
    // dibbur can open mid-line after the previous comment's tail (e.g. "היה").
    const rightNeighbour = sameLine.some(
      (other) =>
        other.x - (word.x + word.w) > 4 &&
        other.x >= word.x + word.w - 2 &&
        other.x - (word.x + word.w) <= font * 1.6,
    );
    return continues && !rightNeighbour;
  });
  const candidates = [...sized, ...openers];
  const rows = groupRows(candidates, font);
  const pitch = estimatePitch(rows, font * 0.93);

  const rashiGrams = trigrams(input.rashi.map((segment) => normalizeHebrew(segment.text)).join(""));
  const tosafotGrams = trigrams(input.tosafot.map((segment) => normalizeHebrew(segment.text)).join(""));
  const onlyRashi = uniqueGrams(rashiGrams, tosafotGrams);
  const onlyTosafot = uniqueGrams(tosafotGrams, rashiGrams);

  const groups: Group[] = [];
  rows.forEach((row, rowIndex) => {
    const sorted = [...row.words].sort((a, b) => a.x - b.x);
    let current: RawWord[] = [];
    let edge = -Infinity;
    const flush = () => {
      if (!current.length) return;
      const votes = current.map((word) => itemVotes(word.text, onlyRashi, onlyTosafot));
      groups.push({ row: rowIndex, baseline: row.baseline, items: current, votes, ...decideGroup(current, votes) });
      current = [];
      edge = -Infinity;
    };
    for (const word of sorted) {
      if (current.length && word.x - edge > font * 1.6) flush();
      current.push(word);
      edge = Math.max(edge, word.x + word.w);
    }
    flush();
  });

  // Pass 2: reuse the gutter seen in nearby rows where this row's own text is too thin to decide.
  const gutters = groups
    .filter((group) => group.split)
    .map((group) => ({ baseline: group.baseline, ...(group.split as SplitPoint) }));
  for (const group of groups) {
    if (group.split || !gutters.length) continue;
    const near = gutters.filter((gutter) => Math.abs(gutter.baseline - group.baseline) <= pitch * 3.2);
    if (!near.length) continue;
    let reach = -Infinity;
    const rights = group.items.map((word) => (reach = Math.max(reach, word.x + word.w)));
    let chosen: SplitPoint | null = null;
    let chosenOverlap = 0;
    for (let k = 1; k < group.items.length; k += 1) {
      const x0 = rights[k - 1];
      const x1 = group.items[k].x;
      if (x1 - x0 < MIN_GUTTER) continue;
      for (const gutter of near) {
        const shared = overlapLength(x0, x1, gutter.x0, gutter.x1);
        if (shared < 4 || shared <= chosenOverlap) continue;
        if (support(group.votes.slice(0, k), gutter.left) < -2) continue;
        if (support(group.votes.slice(k), gutter.right) < -2) continue;
        chosen = { index: k, x0, x1, left: gutter.left, right: gutter.right };
        chosenOverlap = shared;
      }
    }
    if (chosen) {
      group.split = chosen;
      group.label = null;
    }
  }

  const fragments: Fragment[] = [];
  const make = (group: Group, items: RawWord[], label: Side | null): Fragment => ({
    row: group.row,
    baseline: group.baseline,
    minX: Math.min(...items.map((word) => word.x)),
    maxX: Math.max(...items.map((word) => word.x + word.w)),
    letters: items.reduce((sum, word) => sum + letterCount(word.text), 0),
    words: items,
    label,
  });
  for (const group of groups) {
    if (group.split) {
      fragments.push(make(group, group.items.slice(0, group.split.index), group.split.left));
      fragments.push(make(group, group.items.slice(group.split.index), group.split.right));
    } else {
      fragments.push(make(group, group.items, group.label));
    }
  }

  // Pass 3: an unlabelled fragment inside a column takes the label of its labelled neighbours above and below.
  const sameStrip = (a: Fragment, b: Fragment) =>
    overlapLength(a.minX, a.maxX, b.minX, b.maxX) / Math.max(1, Math.min(a.maxX - a.minX, b.maxX - b.minX)) >= 0.6;
  const neighbours = (fragment: Fragment) => {
    let above: Fragment | null = null;
    let below: Fragment | null = null;
    for (const other of fragments) {
      if (other === fragment || !other.label || !sameStrip(fragment, other)) continue;
      const delta = other.baseline - fragment.baseline;
      if (delta < -0.5 && delta >= -pitch * 3.2 && (!above || other.baseline > above.baseline)) above = other;
      if (delta > 0.5 && delta <= pitch * 3.2 && (!below || other.baseline < below.baseline)) below = other;
    }
    return { above, below };
  };
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const fragment of fragments) {
      if (fragment.label) continue;
      const { above, below } = neighbours(fragment);
      if (above && below && above.label === below.label) {
        fragment.label = above.label;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Pass 4: one commentary can outlive the other. Once Tosafot (or Rashi) has ended, the remaining rows of the
  // page belong to the survivor, including the wide strip under the Gemara. Walk down the page: an unlabelled
  // fragment that touches a labelled fragment directly above it, with no opposing label in reach, inherits it.
  const ordered = [...fragments].sort((a, b) => a.baseline - b.baseline);
  const hasOpposing = (fragment: Fragment, label: Side) =>
    fragments.some(
      (other) =>
        other.label &&
        other.label !== label &&
        Math.abs(other.baseline - fragment.baseline) <= pitch * 1.2 &&
        overlapLength(other.minX, other.maxX, fragment.minX, fragment.maxX) > -font * 1.6,
    );
  for (let pass = 0; pass < 40; pass += 1) {
    let changed = false;
    for (const fragment of ordered) {
      if (fragment.label) continue;
      const feeders = fragments.filter((other) => {
        if (!other.label) return false;
        const delta = fragment.baseline - other.baseline;
        if (delta <= 0.5 || delta > pitch * 1.6) return false;
        return overlapLength(other.minX, other.maxX, fragment.minX, fragment.maxX) >= Math.min(20, (fragment.maxX - fragment.minX) * 0.4);
      });
      if (!feeders.length) continue;
      const labels = new Set(feeders.map((other) => other.label));
      if (labels.size !== 1) continue;
      const label = feeders[0].label as Side;
      if (hasOpposing(fragment, label)) continue;
      fragment.label = label;
      changed = true;
    }
    if (!changed) break;
  }
  return { fragments, pitch };
}

export async function analyzePdf(buffer: Uint8Array, input: LayerInput): Promise<DetectionResult> {
  const pdf = await getDocument({ data: buffer, disableWorker: true }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;
  const words = extractWords(content.items as PdfTextItem[], viewport);

  // ---------- Gemara: the dominant body size, as one connected block ----------
  const fonts = detectFonts(words, pageHeight);
  const gemaraFont = fonts.gemara || dominantFont(words, 12.2, 16.2, pageHeight) || 13.68;
  const gemaraWords = words.filter(
    (word) => Math.abs(word.fontSize - gemaraFont) <= GEMARA_TOLERANCE && word.w > 0.6 && word.y > pageHeight * 0.03,
  );
  const gemaraRows = groupRows(gemaraWords, gemaraFont);
  const pitch = estimatePitch(gemaraRows, gemaraFont * 0.87);
  const gemaraClusters = gemaraRows.flatMap((row, index) => splitRow(row, index, gemaraFont * 2.4));
  const gemaraParts = components(gemaraClusters, pitch * 4.5);
  const gemaraMembers: number[] = [];
  if (gemaraParts.length) {
    const main = gemaraParts[0];
    gemaraMembers.push(...main.members);
    for (const part of gemaraParts.slice(1)) {
      const overlap = Math.min(part.maxX, main.maxX) - Math.max(part.minX, main.minX);
      if (part.letters >= 30 && overlap > 20) gemaraMembers.push(...part.members);
    }
  }
  const gemaraLines = buildLines(gemaraClusters, gemaraMembers, pitch, gemaraFont);
  const gemaraBox = gemaraLines.length
    ? {
        minX: Math.min(...gemaraLines.map((line) => line.minX)),
        maxX: Math.max(...gemaraLines.map((line) => line.maxX)),
        minY: gemaraLines[0].top,
        maxY: gemaraLines[gemaraLines.length - 1].bottom,
      }
    : null;

  // ---------- Rashi and Tosafot: the next size down, labelled by their own text ----------
  const commentaryFont = fonts.commentary || dominantFont(words, gemaraFont * 0.6, gemaraFont * 0.93, pageHeight);
  const { fragments: commentaryClusters, pitch: commentaryPitch } = labelCommentary(
    words,
    commentaryFont,
    input,
    pageHeight,
  );

  const columns: { layer: Side; members: number[]; minX: number; maxX: number; tentative: boolean }[] = [];
  for (const layer of ["rashi", "tosafot"] as const) {
    const members = commentaryClusters.map((_, index) => index).filter((index) => commentaryClusters[index].label === layer);
    const letters = members.reduce((sum, index) => sum + commentaryClusters[index].letters, 0);
    if (!members.length || letters < 30) continue;
    columns.push({
      layer,
      members,
      minX: Math.min(...members.map((index) => commentaryClusters[index].minX)),
      maxX: Math.max(...members.map((index) => commentaryClusters[index].maxX)),
      tentative: members.length < 3 || letters < 90,
    });
  }
  const columnStreams = columns.map((column) =>
    buildStream(buildLines(commentaryClusters, column.members, commentaryPitch, commentaryFont || 11.2)),
  );

  // Gemara markers come last: a big glyph standing inside a commentary line is that commentary's opening word.
  const reserved = commentaryClusters
    .filter((cluster) => cluster.label)
    .map((cluster) => ({
      minX: cluster.minX,
      maxX: cluster.maxX,
      minY: cluster.baseline - (commentaryFont || 11.2),
      maxY: cluster.baseline + 1,
    }));
  attachMarkers(words, gemaraLines, gemaraFont, pitch, pageHeight, reserved);
  const gemaraStream = buildStream(gemaraLines);

  // ---------- Bubbles per layer ----------
  const gemara = buildLayerBubbles(gemaraStream, "gemara", input.gemara, "gemara");
  const allDrafts: Draft[] = [...gemara.drafts];
  const sides: DetectionStats["sides"] = { rashi: null, tosafot: null };
  const layerCounts: Record<LayerKind, number> = { gemara: gemara.drafts.length, rashi: 0, tosafot: 0 };
  let matched = gemara.matched;
  let filled = gemara.filled;

  columnStreams.forEach((stream, index) => {
    const column = columns[index];
    const layer = column.layer;
    const segments = layer === "rashi" ? input.rashi : input.tosafot;
    const built = buildLayerBubbles(stream, layer, segments, layer, false, true);
    // A tentative sliver (too few fragments for a real column) is kept only if
    // at least one segment genuinely matches it; otherwise it is stray text.
    if (column.tentative && built.matched === 0) return;
    allDrafts.push(...built.drafts);
    layerCounts[layer] = built.drafts.length;
    matched += built.matched;
    filled += built.filled;
    const centers = column.members.map((member) => (commentaryClusters[member].minX + commentaryClusters[member].maxX) / 2);
    sides[layer] = median(centers) > pageWidth / 2 ? "right" : "left";
  });

  const gemaraRects = gemara.drafts.flatMap((draft) => draft.rects);
  const commentaryRects = allDrafts.filter((draft) => draft.bubble.layer !== "gemara").flatMap((draft) => draft.rects);
  let collisions = clipAgainst(commentaryRects, gemaraRects);
  separateWithinLayer(allDrafts.flatMap((draft) => draft.rects));

  allDrafts.sort((a, b) => a.order - b.order);
  // Snapshot before clipping: a segment that was aligned but erased by the
  // overlap guards must still get a bubble (marked as estimated) — never a
  // silent miss.
  const backup = allDrafts.map((draft) =>
    draft.rects.map((item) => ({ layer: item.layer, line: item.line, rect: { ...item.rect } })),
  );
  collisions += resolveOverlaps(
    allDrafts.flatMap((draft, owner) => draft.rects.map((item) => ({ layer: item.layer, owner, rect: item.rect }))),
  );
  let restored = 0;
  const bubbles: Bubble[] = allDrafts
    .map((draft, index) => {
      const kept = draft.rects.filter((item) => item.rect.w > 7 && item.rect.h > 3.5);
      if (kept.length) {
        return {
          ...draft.bubble,
          rects: kept.map((item) => ({
            x: round(item.rect.x),
            y: round(item.rect.y),
            w: round(item.rect.w),
            h: round(item.rect.h),
          })),
        };
      }
      const spare = backup[index]
        .filter((item) => item.rect.w > 7 && item.rect.h > 3.5)
        .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
      if (!spare || draft.bubble.kind !== "segment") return null;
      restored += 1;
      return {
        ...draft.bubble,
        score: 0.5,
        rects: [
          {
            x: round(spare.rect.x),
            y: round(spare.rect.y),
            w: round(spare.rect.w),
            h: round(spare.rect.h),
          },
        ],
      };
    })
    .filter((bubble): bubble is Bubble => Boolean(bubble && bubble.rects.length));

  const bodyLines = gemaraLines.filter((line) => !line.marker);
  const widths = bodyLines.map((line) => line.maxX - line.minX);
  const typicalWidth = median(widths);
  return {
    pageWidth: round(pageWidth),
    pageHeight: round(pageHeight),
    bubbles,
    stats: {
      gemaraFont: round(gemaraFont),
      commentaryFont: round(commentaryFont),
      pitch: round(pitch),
      column: gemaraBox
        ? {
            minX: round(gemaraBox.minX),
            maxX: round(gemaraBox.maxX),
            minY: round(gemaraBox.minY),
            maxY: round(gemaraBox.maxY),
          }
        : null,
      segments: input.gemara.length + input.rashi.length + input.tosafot.length,
      matched,
      filled,
      gemaraWords: gemaraLines.reduce((sum, line) => sum + line.words.length, 0),
      lines: bodyLines.length,
      wideLines: widths.filter((width) => width > typicalWidth * 1.25).length,
      layers: layerCounts,
      sides,
      collisions,
      restored,
      method: "גודל פונט לכל שכבה, רצף שורות, והתאמה לטקסט של אוצריא",
    },
  };
}
