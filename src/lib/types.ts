export type Amud = "a" | "b";

export type BubbleRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LayerKind = "gemara" | "rashi" | "tosafot";

export const LAYER_LABELS: Record<LayerKind, string> = {
  gemara: "גמרא",
  rashi: "רש״י",
  tosafot: "תוספות",
};

export type Bubble = {
  id: string;
  layer: LayerKind;
  /** Otzaria book that holds this bubble's text (Gemara, Rashi or Tosafot of the tractate). */
  bookId?: number | null;
  lineIndex: number | null;
  segmentIndex: number;
  text: string;
  preview: string;
  score: number;
  kind: "segment" | "line";
  rects: BubbleRect[];
};

export type DafPayload = {
  algo: number;
  tractate: string;
  apiName: string;
  daf: number;
  amud: Amud;
  label: string;
  bookId: number | null;
  pageWidth: number;
  pageHeight: number;
  bubbles: Bubble[];
  stats: {
    gemaraFont: number;
    commentaryFont?: number;
    pitch?: number;
    column: { minX: number; maxX: number; minY: number; maxY: number } | null;
    segments: number;
    matched: number;
    filled?: number;
    gemaraWords: number;
    lines?: number;
    wideLines?: number;
    layers?: Record<LayerKind, number>;
    sides?: { rashi: "right" | "left" | null; tosafot: "right" | "left" | null };
    collisions?: number;
    method: string;
  };
};

export type CommentaryItem = {
  commentator: string;
  title: string;
  dibbur: string;
  text: string;
};

export type CommentariesResponse = {
  bookId: number;
  line: number;
  lineText: string;
  commentators: string[];
  items: CommentaryItem[];
};

export type RecentDaf = {
  tractate: string;
  daf: number;
  amud: Amud;
  visitedAt: string;
};
