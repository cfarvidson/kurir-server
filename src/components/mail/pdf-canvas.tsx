"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * The pdfjs viewport scale to render a page at. `containerWidth / pageWidth`
 * fits the page to the available width (enlarging narrow pages, shrinking wide
 * ones); multiplying by `dpr` renders into a high-resolution backing store so
 * text stays crisp on retina/mobile screens (the canvas is then scaled back
 * down to 100% width via CSS). Falls back to device pixel ratio alone when the
 * container hasn't been laid out yet.
 */
export function computeRenderScale(
  containerWidth: number,
  pageWidth: number,
  dpr: number,
): number {
  const fit =
    containerWidth > 0 && pageWidth > 0 ? containerWidth / pageWidth : 1;
  return fit * (dpr > 0 ? dpr : 1);
}

/**
 * Renders a PDF inline by drawing each page to a stacked <canvas> using pdfjs.
 *
 * This exists because iOS Safari/WebKit refuses to render PDFs inside an
 * <iframe>/<object> (see AttachmentViewer), so the only way to preview a PDF
 * inline on iOS is to rasterise it client-side. pdfjs is loaded lazily via a
 * dynamic import so its (large) bundle and worker are only fetched when a PDF
 * is actually previewed — never on desktop or at startup. Rendering stays
 * entirely client-side and same-origin, so private attachments are never sent
 * to a third-party viewer.
 *
 * On failure (worker won't load, corrupt PDF, etc.) it calls `onError` so the
 * parent can fall back to the open/share affordance.
 */
export function PdfCanvas({
  url,
  onError,
}: {
  url: string;
  onError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  // Keep onError in a ref so an inline parent callback doesn't re-trigger the
  // render effect (which should only re-run when the PDF url changes).
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    // Destroying the loading task tears down the document and its worker; the
    // PDFDocumentProxy itself has no destroy() in pdfjs v6.
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    const container = containerRef.current;

    async function render() {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Set once — the URL is deterministic, so guard against redundant
        // writes when multiple previews mount.
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).toString();
        }

        const task = pdfjs.getDocument({ url });
        loadingTask = task;
        const doc = await task.promise;
        if (cancelled) return;

        if (!container) return;
        container.replaceChildren();

        // Cap at 2x: 3x retina gains are imperceptible in a preview but triple
        // the per-page canvas memory on high-DPI phones (the iOS target here).
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const containerWidth = container.clientWidth;

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          if (cancelled) return;
          const page = await doc.getPage(pageNum);
          const base = page.getViewport({ scale: 1 });
          const scale = computeRenderScale(containerWidth, base.width, dpr);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.className = "mb-2 bg-white shadow-sm last:mb-0";
          container.appendChild(canvas);

          await page.render({ canvas, viewport }).promise;
        }

        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("PDF inline render failed", err);
        setStatus("error");
        onErrorRef.current?.();
      }
    }

    render();

    return () => {
      cancelled = true;
      loadingTask?.destroy().catch(() => {});
    };
  }, [url]);

  return (
    <div className="h-full w-full overflow-auto p-2 sm:p-4">
      {status === "loading" && (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <div ref={containerRef} className="mx-auto max-w-3xl" />
    </div>
  );
}
