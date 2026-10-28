declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(src: {
    data: Uint8Array;
    disableWorker?: boolean;
  }): { promise: Promise<PdfjsDocument> };
}

declare module "pdfjs-dist" {
  export const version: string;
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(src: {
    data: Uint8Array;
    disableWorker?: boolean;
  }): { promise: Promise<PdfjsDocument> };
}

type PdfjsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfjsPage>;
};

type PdfjsViewport = {
  width: number;
  height: number;
  rotation: number;
  convertToViewportPoint: (x: number, y: number) => [number, number];
};

type PdfjsPage = {
  getViewport: (options: { scale: number }) => PdfjsViewport;
  getTextContent: () => Promise<{ items: PdfjsTextItem[] }>;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfjsViewport;
  }) => { promise: Promise<void> };
};

type PdfjsTextItem = {
  str?: string;
  transform: number[];
  width?: number;
  height?: number;
};
