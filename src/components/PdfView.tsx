import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { SearchResult, TocItem } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfRelocatedInfo {
  page: number;
  /** 全书进度 0~1 */
  percent: number;
  /** 容器滚动位置（用于精确恢复） */
  scrollTop: number;
}

export interface PdfViewHandle {
  goToPage(page: number): void;
  /** dir: 1 下一屏 / -1 上一屏 */
  scrollByPage(dir: number): void;
  /** 获取当前在文本层中选中的文字（没选中返回 null） */
  getSelectionText(): string | null;
  /** 全书逐页文本搜索（流式回调，命中按页序返回） */
  search(query: string, onResult: (r: SearchResult) => void): Promise<void>;
}

/** PDF 划选信息（locator 为 {"page":n} JSON，坐标相对 PdfView 根元素） */
export interface PdfSelectionInfo {
  locator: string;
  text: string;
  x: number;
  y: number;
}

interface Props {
  filePath: string;
  initialPage?: number | null;
  zoom: number;
  /** Ctrl+滚轮缩放：正值放大 */
  onZoomDelta?: (delta: number) => void;
  onReady: (toc: TocItem[], pageCount: number) => void;
  onRelocated: (info: PdfRelocatedInfo) => void;
  /** 文本层划选完成（划线/笔记浮层用） */
  onSelected?: (info: PdfSelectionInfo) => void;
  /** 键盘翻页回调（阅读统计用） */
  onPageTurn?: () => void;
  /** false 时忽略键盘翻页（弹窗打开时防止按键穿透） */
  keysEnabled?: boolean;
}

interface PageHolder {
  el: HTMLDivElement;
  /** 渲染时的 epoch，缩放变更后失效需重绘 */
  epoch: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const PdfView = forwardRef<PdfViewHandle, Props>(function PdfView(
  { filePath, initialPage, zoom, onZoomDelta, onReady, onRelocated, onSelected, onPageTurn, keysEnabled },
  ref
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pagesRef = useRef<Map<number, PageHolder>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const tasksRef = useRef<Set<pdfjsLib.RenderTask>>(new Set());
  const epochRef = useRef(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pageCountRef = useRef(0);
  const topPageRef = useRef(1);
  const scrollTopRef = useRef(0);
  const scrollTimerRef = useRef<number | null>(null);
  const initialDoneRef = useRef(false);

  const onRelocatedRef = useRef(onRelocated);
  onRelocatedRef.current = onRelocated;
  const onZoomDeltaRef = useRef(onZoomDelta);
  onZoomDeltaRef.current = onZoomDelta;
  const onSelectedRef = useRef(onSelected);
  onSelectedRef.current = onSelected;
  const onPageTurnRef = useRef(onPageTurn);
  onPageTurnRef.current = onPageTurn;
  const keysEnabledRef = useRef(keysEnabled ?? true);
  keysEnabledRef.current = keysEnabled ?? true;
  const wrapRef = useRef<HTMLDivElement>(null);

  // ---------- 页面渲染 ----------

  const reportLocation = () => {
    const container = containerRef.current;
    if (!container) return;
    scrollTopRef.current = container.scrollTop;
    const ctop = container.getBoundingClientRect().top;
    let topPage = 1;
    for (const [num, h] of pagesRef.current) {
      if (h.el.getBoundingClientRect().bottom > ctop + 30) {
        topPage = num;
        break;
      }
    }
    topPageRef.current = topPage;
    const total = pageCountRef.current || 1;
    onRelocatedRef.current({
      page: topPage,
      percent: Math.min(1, (topPage - 0.5) / total),
      scrollTop: container.scrollTop,
    });
  };

  const renderPage = async (num: number) => {
    const pdf = pdfRef.current;
    const container = containerRef.current;
    const holder = pagesRef.current.get(num);
    if (!pdf || !container || !holder) return;
    if (holder.epoch === epochRef.current) return; // 当前缩放下已渲染
    // 快照当前 epoch：渲染期间缩放变更则丢弃本次结果
    const startEpoch = epochRef.current;

    try {
      const page = await pdf.getPage(num);
      const unscaled = page.getViewport({ scale: 1 });
      const base = container.clientWidth / unscaled.width;
      const viewport = page.getViewport({ scale: base * zoomRef.current });

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const task = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      tasksRef.current.add(task);
      try {
        await task.promise;
      } finally {
        tasksRef.current.delete(task);
      }
      if (startEpoch !== epochRef.current || !pdfRef.current) return; // 渲染期间缩放变了

      holder.epoch = epochRef.current;
      holder.el.innerHTML = "";
      holder.el.style.aspectRatio = "auto";
      holder.el.style.width = `${viewport.width}px`;
      holder.el.style.height = `${viewport.height}px`;
      canvas.style.width = "100%";
      holder.el.appendChild(canvas);

      // 文本层：让文字可选中（笔记引用依赖）
      try {
        const textContent = await page.getTextContent();
        const layer = document.createElement("div");
        layer.className = "textLayer";
        // v6 文本层依赖的 CSS 变量（内部用它们计算宽高与字号）
        layer.style.setProperty("--total-scale-factor", String(viewport.scale));
        layer.style.setProperty("--scale-round-x", "1px");
        layer.style.setProperty("--scale-round-y", "1px");
        holder.el.appendChild(layer);
        await new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: layer,
          viewport,
        }).render();
      } catch (e) {
        console.error(`第 ${num} 页文本层失败`, e);
      }
    } catch (e) {
      if (!String(e).includes("cancel")) console.error(`第 ${num} 页渲染失败`, e);
    }
  };

  const attachObserver = () => {
    const container = containerRef.current;
    if (!container) return;
    observerRef.current?.disconnect();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            const num = Number((en.target as HTMLElement).dataset.page);
            if (num > 0) void renderPage(num);
          }
        }
      },
      { root: container, rootMargin: "600px 0px" }
    );
    pagesRef.current.forEach((h) => obs.observe(h.el));
    observerRef.current = obs;
  };

  // ---------- 文档加载 ----------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setLoading(true);
    setError("");
    initialDoneRef.current = false;
    pagesRef.current.clear();
    container.innerHTML = "";

    // cMapUrl/standardFontDataUrl：中文等 CID 字体 PDF 解码文本必需（缺省时 getTextContent 返回空、文字无法选中）
    // 资源由 public/pdfjs 提供（dev 由 Vite 静态服务，打包时随 dist 一起分发）
    const task = pdfjsLib.getDocument({
      url: convertFileSrc(filePath),
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
    });
    let cancelled = false;

    task.promise
      .then(async (pdf) => {
        if (cancelled) return;
        pdfRef.current = pdf;
        pageCountRef.current = pdf.numPages;

        // outline → 目录（解析目标页码）
        const toc: TocItem[] = [];
        try {
          const outline = await pdf.getOutline();
          const walk = async (items: typeof outline, depth: number) => {
            for (const it of items ?? []) {
              let page = 0;
              try {
                if (it.dest) {
                  const dest =
                    typeof it.dest === "string" ? await pdf.getDestination(it.dest) : it.dest;
                  if (dest && dest[0]) {
                    page = (await pdf.getPageIndex(dest[0])) + 1;
                  }
                }
              } catch {
                // 解析失败跳过页码
              }
              toc.push({ label: it.title?.trim() || "(无标题)", href: `p:${page}`, depth });
              if (it.items?.length) await walk(it.items as typeof outline, depth + 1);
            }
          };
          await walk(outline, 0);
        } catch {
          // 无目录不影响阅读
        }

        // 构建占位页（用第 1 页真实比例，避免恢复位置时累积漂移）
        let placeholderRatio = "210 / 297";
        try {
          const first = await pdf.getPage(1);
          const v1 = first.getViewport({ scale: 1 });
          if (v1.width > 0 && v1.height > 0) {
            placeholderRatio = `${v1.width} / ${v1.height}`;
          }
        } catch {
          // 取不到就用 A4 默认
        }
        for (let i = 1; i <= pdf.numPages; i++) {
          const el = document.createElement("div");
          el.className = "pdf-page";
          el.dataset.page = String(i);
          el.style.aspectRatio = placeholderRatio;
          pagesRef.current.set(i, { el, epoch: -1 });
          container.appendChild(el);
        }
        attachObserver();

        // 恢复上次阅读位置
        if (initialPage && initialPage > 1) {
          const target = clamp(initialPage, 1, pdf.numPages);
          const el = pagesRef.current.get(target)?.el;
          if (el) container.scrollTop = el.offsetTop - 8;
        }
        initialDoneRef.current = true;
        setLoading(false);
        onReady(toc, pdf.numPages);
        reportLocation();
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });

    // 文本层划选完成 → 上报选区（划线/笔记浮层用）；空选区视为清除
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // 点击浮层按钮本身：不参与选区判定，避免点击前选区被清除导致按钮失效
      const tgt = e.target as HTMLElement | null;
      if (tgt && typeof tgt.closest === "function" && tgt.closest(".sel-fab-group")) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (!sel || sel.isCollapsed || !text) {
        onSelectedRef.current?.({ locator: "", text: "", x: 0, y: 0 });
        return;
      }
      const layer = sel.anchorNode?.parentElement?.closest(".textLayer") ?? null;
      if (!layer) return;
      const pageEl = layer.closest(".pdf-page") as HTMLElement | null;
      const page = Number(pageEl?.dataset.page) || topPageRef.current;
      let x = 0;
      let y = 0;
      try {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        x = rect.left - wr.left + rect.width / 2;
        y = rect.bottom - wr.top;
      } catch {
        return;
      }
      x = clamp(x, 60, Math.max(120, wrap.clientWidth - 60));
      onSelectedRef.current?.({ locator: JSON.stringify({ page, y: 0 }), text, x, y });
    };
    window.addEventListener("mouseup", onMouseUp);

    // 滚动 → 节流上报位置
    const onScroll = () => {
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(reportLocation, 250);
    };
    container.addEventListener("scroll", onScroll);

    // Ctrl+滚轮缩放
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      onZoomDeltaRef.current?.(e.deltaY < 0 ? 0.1 : -0.1);
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    // 键盘翻页
    const onKey = (e: KeyboardEvent) => {
      if (!keysEnabledRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        container.scrollBy({ top: container.clientHeight * 0.85, behavior: "smooth" });
        onPageTurnRef.current?.();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        container.scrollBy({ top: -container.clientHeight * 0.85, behavior: "smooth" });
        onPageTurnRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelled = true;
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      observerRef.current?.disconnect();
      tasksRef.current.forEach((t) => t.cancel());
      tasksRef.current.clear();
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
      task.destroy();
      pdfRef.current = null;
      container.innerHTML = "";
    };
    // initialPage 仅首次挂载使用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // ---------- 缩放变更：清空画布重绘 ----------

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfRef.current) return;
    const top = topPageRef.current;
    epochRef.current += 1;
    tasksRef.current.forEach((t) => t.cancel());
    tasksRef.current.clear();
    pagesRef.current.forEach((h) => {
      h.el.innerHTML = "";
      h.el.style.height = "";
      h.el.style.width = "";
      h.el.style.aspectRatio = "";
      h.epoch = -1;
    });
    attachObserver();
    if (top > 1) {
      const el = pagesRef.current.get(top)?.el;
      if (el) container.scrollTop = el.offsetTop - 8;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // ---------- 对外接口 ----------

  useImperativeHandle(
    ref,
    () => ({
      goToPage(page: number) {
        const container = containerRef.current;
        const total = pageCountRef.current;
        const target = clamp(page, 1, Math.max(1, total));
        const el = pagesRef.current.get(target)?.el;
        if (container && el) container.scrollTop = el.offsetTop - 8;
      },
      scrollByPage(dir: number) {
        const container = containerRef.current;
        if (container) {
          container.scrollBy({ top: dir * container.clientHeight * 0.85, behavior: "smooth" });
        }
      },
      getSelectionText() {
        const container = containerRef.current;
        const sel = window.getSelection();
        if (!container || !sel || sel.isCollapsed || !sel.rangeCount) return null;
        const text = sel.toString().trim();
        if (!text) return null;
        const node = sel.anchorNode;
        const host = node?.parentElement?.closest(".textLayer") ?? null;
        return host ? text : null;
      },

      // 全书逐页提取文本搜索（流式回调；顺序按页码，上限 300 条防刷屏）
      async search(query, onResult) {
        const pdf = pdfRef.current;
        const q = query.trim().toLowerCase();
        if (!pdf || !q) return;
        let hits = 0;
        for (let n = 1; n <= pageCountRef.current && hits < 300; n++) {
          try {
            const page = await pdf.getPage(n);
            const tc = await page.getTextContent();
            let full = "";
            for (const item of tc.items) {
              if ("str" in item) full += item.str;
            }
            const lower = full.toLowerCase();
            let idx = lower.indexOf(q);
            while (idx !== -1 && hits < 300) {
              const start = Math.max(0, idx - 18);
              const excerpt = full
                .slice(start, Math.min(full.length, idx + q.length + 30))
                .replace(/\s+/g, " ")
                .trim();
              onResult({
                locator: JSON.stringify({ page: n, y: 0 }),
                chapter: `第 ${n} 页`,
                excerpt,
              });
              hits++;
              idx = lower.indexOf(q, idx + q.length);
            }
          } catch {
            // 该页提取失败跳过，不影响整体
          }
        }
      },
    }),
    []
  );

  return (
    <div ref={wrapRef} className="pdf-scroll-wrap">
      <div ref={containerRef} className="pdf-scroll" />
      {loading && <div className="pdf-status">PDF 加载中…</div>}
      {error && <div className="pdf-status error-bar">{error}</div>}
    </div>
  );
});

export default PdfView;