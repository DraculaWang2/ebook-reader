import { useEffect, useRef } from "react";
import ePub from "epubjs";
import type { Book, Location, NavItem, Rendition } from "epubjs";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { TocItem } from "../types";

export interface RelocatedInfo {
  /** 页面起始 cfi，用于书签定位与进度恢复 */
  cfi: string;
  /** 当前章节资源路径（用于目录高亮） */
  href: string;
  chapterTitle: string | null;
  /** 全书进度 0~1（按 spine 序号 + 章内页数估算） */
  percent: number;
}

/** 划选文字信息（含浮层按钮坐标，相对于 EpubView 容器） */
export interface SelectionInfo {
  cfi: string;
  text: string;
  x: number;
  y: number;
}

interface Props {
  filePath: string;
  initialCfi?: string | null;
  /** 字号百分比（75~220） */
  fontSize: number;
  /** 阅读主题：正文配色 */
  theme?: "light" | "dark" | "sepia";
  /** 需要高亮的 cfi 列表（引用型笔记的 locator） */
  highlights?: string[];
  onReady: (rendition: Rendition, book: Book) => void;
  onToc: (items: TocItem[]) => void;
  onRelocated: (info: RelocatedInfo) => void;
  onSelected?: (s: SelectionInfo) => void;
  /** 键盘翻页回调（阅读统计用） */
  onPageTurn?: () => void;
  /** false 时忽略键盘翻页（弹窗打开时防止按键穿透） */
  keysEnabled?: boolean;
}

/** relocated 里未收录进官方类型的字段 */
type LocStart = Location["start"] & { ancestorTitles?: string[] };

/** epub.js selected 事件回传的 Contents（只取用到的部分） */
interface SelectedEventContents {
  window(): Window | null;
}

type ThemesApi = {
  register(name: string, obj: object): void;
  select(name: string): void;
  fontSize(size: string): void;
};

const themesOf = (r: Rendition | null): ThemesApi | null =>
  (r as unknown as { themes?: ThemesApi } | null)?.themes ?? null;

export default function EpubView({
  filePath,
  initialCfi,
  fontSize,
  theme,
  highlights,
  onReady,
  onToc,
  onRelocated,
  onSelected,
  onPageTurn,
  keysEnabled,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const onRelocatedRef = useRef(onRelocated);
  onRelocatedRef.current = onRelocated;
  const onSelectedRef = useRef<Props["onSelected"]>(onSelected);
  onSelectedRef.current = onSelected;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const onPageTurnRef = useRef(onPageTurn);
  onPageTurnRef.current = onPageTurn;
  const keysEnabledRef = useRef(keysEnabled ?? true);
  keysEnabledRef.current = keysEnabled ?? true;
  const addedHlRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const book: Book = ePub(convertFileSrc(filePath));
    const rendition = book.renderTo(host, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: "none",
    });
    renditionRef.current = rendition;
    onReady(rendition, book);

    // 注册并应用阅读主题
    const themes = themesOf(rendition);
    if (themes) {
      themes.register("light", {
        body: { color: "#23263a !important", background: "#ffffff !important" },
      });
      themes.register("dark", {
        body: { color: "#d6d9e8 !important", background: "#1e1f29 !important" },
      });
      themes.register("sepia", {
        body: { color: "#5b4636 !important", background: "#f4ecd8 !important" },
      });
      themes.select(themeRef.current ?? "dark");
    }

    // 目录：nav.toc 树 → 扁平化列表（depth 用于缩进）
    book.ready
      .then(() => book.loaded.navigation)
      .then((nav) => {
        const items: TocItem[] = [];
        const walk = (list: NavItem[] | undefined, depth: number) => {
          for (const item of list ?? []) {
            if (item.href) {
              items.push({ label: item.label?.trim() || "(无标题)", href: item.href, depth });
            }
            if (item.subitems?.length) walk(item.subitems, depth + 1);
          }
        };
        walk(nav.toc, 0);
        onToc(items);
      })
      .catch(() => onToc([]));

    // 翻页/跳转后上报位置
    rendition.on("relocated", (location: Location) => {
      const start = location.start as LocStart;
      // Spine.items 运行时存在但类型未暴露
      const spineLen = (book as unknown as { spine?: { items?: unknown[] } }).spine?.items?.length ?? 1;
      const denom = Math.max(1, spineLen - 1);
      const page = start.displayed;
      const within = page.total > 1 ? (page.page - 1) / page.total : 0;
      const percent = Math.min(1, Math.max(0, (start.index + within) / denom));
      onRelocatedRef.current({
        cfi: start.cfi,
        href: start.href,
        chapterTitle: start.ancestorTitles?.slice(-1)[0] ?? null,
        percent,
      });
    });

    // 划选文字 → 上报选区（cfi + 文本 + 浮层坐标）
    rendition.on("selected", (cfiRange: string, contents: SelectedEventContents | undefined) => {
      const win = contents?.window?.() ?? null;
      const text = (win?.getSelection()?.toString() ?? "").trim();
      if (!text) return;
      // 兜底：选区矩形拿不到时放容器中上部
      let x = host.clientWidth / 2;
      let y = host.clientHeight * 0.4;
      try {
        const rect = win!.getSelection()!.getRangeAt(0).getBoundingClientRect();
        const frame = win!.frameElement as HTMLElement | null;
        if (frame) {
          const fr = frame.getBoundingClientRect();
          const hr = host.getBoundingClientRect();
          x = fr.left - hr.left + rect.left + rect.width / 2;
          y = fr.top - hr.top + rect.bottom;
        }
      } catch {
        // 保留兜底坐标
      }
      x = Math.min(Math.max(x, 80), Math.max(160, host.clientWidth - 80));
      onSelectedRef.current?.({ cfi: cfiRange, text, x, y });
    });

    // 初始位置：上次进度 cfi；失效则回到开头
    rendition
      .display(initialCfi ?? undefined)
      .catch(() => void rendition.display());

    // 容器尺寸变化（如开合目录侧栏）时重排
    const ro = new ResizeObserver(() => rendition.resize(host.clientWidth, host.clientHeight));
    ro.observe(host);

    // 键盘翻页（焦点在输入框时忽略）
    const onKey = (e: KeyboardEvent) => {
      if (!keysEnabledRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        void rendition.next();
        onPageTurnRef.current?.();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        void rendition.prev();
        onPageTurnRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      rendition.destroy();
      book.destroy();
    };
    // initialCfi 只在首次挂载使用，刻意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // 主题 / 字号调整（select 会重置注入样式，需同时重设字号）
  useEffect(() => {
    const themes = themesOf(renditionRef.current);
    if (!themes) return;
    themes.select(theme ?? "dark");
    themes.fontSize(`${fontSize}%`);
  }, [theme, fontSize]);

  // 引用型笔记高亮（幂等：已添加的跳过）
  useEffect(() => {
    const r = renditionRef.current;
    if (!r || !Array.isArray(highlights)) return;
    for (const cfi of highlights) {
      if (addedHlRef.current.has(cfi)) continue;
      addedHlRef.current.add(cfi);
      try {
        r.annotations.highlight(
          cfi,
          {},
          undefined,
          "note-hl",
          { fill: "rgba(250, 204, 21, 0.35)", "fill-opacity": "0.35" }
        );
      } catch {
        addedHlRef.current.delete(cfi);
      }
    }
  }, [highlights]);

  return <div ref={hostRef} className="epub-view" />;
}