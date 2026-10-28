import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { fetchPdf } from "./otzaria";

const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
const MAX_ENTRIES = 24;
let globalsReady = false;

function ensureGlobals() {
  if (globalsReady) return;
  const target = globalThis as Record<string, unknown>;
  target.DOMMatrix = DOMMatrix;
  target.Path2D = Path2D;
  target.ImageData = ImageData;
  globalsReady = true;
}

export async function renderDafImage(
  apiName: string,
  daf: number,
  amud: "a" | "b",
  scale = 2,
): Promise<Buffer> {
  const key = `${apiName}:${daf}:${amud}@${scale}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;

  const job = (async () => {
    ensureGlobals();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = await fetchPdf(apiName, daf, amud);
    const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const buffer = canvas.toBuffer("image/jpeg", 88);
    if (cache.size >= MAX_ENTRIES) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    cache.set(key, buffer);
    return buffer;
  })();

  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
