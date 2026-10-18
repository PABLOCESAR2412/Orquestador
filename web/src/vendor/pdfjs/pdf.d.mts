export type PDFDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getViewport(options: { scale: number }): { width: number; height: number };
    render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; canvas: HTMLCanvasElement; transform?: number[] }): { promise: Promise<void>; cancel(): void };
  }>;
};

export const GlobalWorkerOptions: { workerSrc: string };
export function getDocument(options: { data: Uint8Array }): {
  promise: Promise<PDFDocumentProxy>;
  destroy(): Promise<void>;
};
