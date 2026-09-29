import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { Book as EpubJsBook, Rendition } from "epubjs";
import EpubView, { type RelocatedInfo, type SelectionInfo } from "../components/EpubView";
import PdfView, {
  type PdfRelocatedInfo,
  type PdfSelectionInfo,
  type PdfViewHandle,
} from "../components/PdfView";
import TocPanel from "../components/TocPanel";
import BookmarkPanel from "../components/BookmarkPanel";
import NotePanel from "../components/NotePanel";
import NoteModal, { type NoteDraft } from "../components/NoteModal";
import ReviewModal from "../components/ReviewModal";
import SearchPanel from "../components/SearchPanel";
import HelpModal from "../components/HelpModal";
import { searchEpub } from "../epub-search";
import {
  addBookmark,
  deleteBookmark,
  deleteNote,
  exportBookMd,
  getBook,
  listBookmarks,
  listNotes,
  listReviewCards,
  recordReading,
  reviewNote,
  saveNote,
  saveProgress,
} from "../api";
import { isDue, matchTocLabel } from "../utils";
import type { Book, Bookmark, Note, ReviewCard, SearchResult, TocItem } from "../types";

type Panel = null | "toc" | "bookmarks" | "notes" | "search";type Theme = "light" | "dark" | "sepia";

/** PDF 定位符：{"page":n,"y":n}；书签/笔记/进度共用 */
const pdfLocator = (page: number, y = 0) => JSON.stringify({ page, y });
const parsePdfLocator = (locator: string): { page?: number; y?: number } | null => {
  try {
    return JSON.parse(locator) as { page?: number; y?: number };
  } catch {
    return null;
  }
};

export default function Reader({ book, onBack }: { book: Book; onBack: () => void }) {
  const [current, setCurrent] = useState<Book>(book);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [percent, setPercent] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    const v = Number(localStorage.getItem("epubFontSize"));
    return v >= 75 && v <= 220 ? v : 100;
  });
  const [zoom, setZoom] = useState(() => {
    const v = Number(localStorage.getItem("pdfZoom"));
    return v >= 0.5 && v <= 3 ? v : 1;
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "sepia" ? v : "dark";
  });
  const [toast, setToast] = useState("");

  // ---- M7 学习包 ----
  const [reviewCards, setReviewCards] = useState<ReviewCard[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);

  // 应用主题到整个应用（阅读器 chrome + PDF 滤镜 + EPUB 正文）
  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const cycleTheme = () =>
    setTheme((t) => (t === "dark" ? "light" : t === "light" ? "sepia" : "dark"));

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2000);
  };

  // 导出书签与笔记为 Markdown
  const handleExportMd = async () => {
    try {
      const path = await save({
        title: "导出书签与笔记",
        defaultPath: `${current.title}-笔记.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (typeof path === "string") {
        await exportBookMd(book.id, path);
        showToast("已导出 Markdown");
      }
    } catch (e) {
      console.error("导出失败", e);
      showToast("导出失败");
    }
  };

  const isPdf = current.format === "pdf";

  const renditionRef = useRef<Rendition | null>(null);
  const pdfRef = useRef<PdfViewHandle | null>(null);
  const lastCfiRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pdfPageRef = useRef(1);
  const pdfScrollRef = useRef(0);
  const pdfCountRef = useRef(0);
  // 供键盘快捷键调用，避免过期闭包
  const addBookmarkRef = useRef<() => void>(() => {});
  const addNoteRef = useRef<() => void>(() => {});
  const goBackRef = useRef<() => void>(() => {});
  // epub.js Book 实例（全文搜索用）
  const epubBookRef = useRef<EpubJsBook | null>(null);
  // 搜索命中临时高亮的 cfi
  const searchHlRef = useRef<string | null>(null);
  const searchEpochRef = useRef(0);
  // 跳转历史（Alt+← 返回跳转前位置）
  const historyRef = useRef<string[]>([]);
  // 弹窗打开时禁用阅读区快捷键，防止按键穿透
  const modalOpenRef = useRef(false);
  modalOpenRef.current = reviewOpen || noteDraft !== null || helpOpen;
  // 阅读统计缓冲
  const statSecondsRef = useRef(0);
  const statPagesRef = useRef(0);
  const lastPercentRef = useRef(0);

  // ---------- M7 学习包 ----------

  // 可复习卡片池：笔记变化后自动刷新
  const refreshReview = useCallback(() => {
    listReviewCards(book.id).then(setReviewCards).catch(() => {});
  }, [book.id]);

  useEffect(() => {
    refreshReview();
  }, [refreshReview, notes]);

  // 到期待复习数量（工具栏 🔁 徽标）
  const dueCount = reviewCards.filter((c) => isDue(c.dueAt, c.isNew)).length;

  const handleReviewed = async (noteId: number, result: 0 | 1 | 2) => {
    try {
      await reviewNote(noteId, result);
    } catch (e) {
      console.error("复习评分失败", e);
    }
  };

  // ---------- 阅读统计：可见时长 + 翻页数，30s 批量落库 ----------
  useEffect(() => {
    const flush = () => {
      const s = statSecondsRef.current;
      const p = statPagesRef.current;
      if (s <= 0 && p <= 0) return;
      statSecondsRef.current = 0;
      statPagesRef.current = 0;
      void recordReading(
        book.id,
        s,
        p,
        lastPercentRef.current > 0 ? lastPercentRef.current : null
      ).catch(() => {});
    };
    // 每 15s：可见才累计，攒满 30s 落库一次
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      statSecondsRef.current += 15;
      if (statSecondsRef.current >= 30) flush();
    }, 15000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [book.id]);

  const countPageTurn = () => {
    statPagesRef.current += 1;
  };

  // ---------- 全文搜索 ----------

  const runSearch = async () => {
    const q = searchQuery.trim();
    if (!q || searching) return;
    const epoch = ++searchEpochRef.current;
    setSearchResults([]);
    setSearching(true);
    setSearchDone(false);
    const onResult = (r: SearchResult) => {
      if (searchEpochRef.current !== epoch) return; // 过期搜索结果丢弃
      setSearchResults((prev) => (prev.length >= 500 ? prev : [...prev, r]));
    };
    try {
      if (isPdf) {
        await pdfRef.current?.search(q, onResult);
      } else if (epubBookRef.current) {
        await searchEpub(epubBookRef.current, q, (href) => matchTocLabel(toc, href) ?? "", onResult);
      }
    } finally {
      if (searchEpochRef.current === epoch) {
        setSearching(false);
        setSearchDone(true);
      }
    }
  };

  // 清除上一次搜索命中高亮
  const clearSearchHighlight = () => {
    const r = renditionRef.current;
    const cfi = searchHlRef.current;
    if (!r || !cfi) return;
    searchHlRef.current = null;
    try {
      (
        r.annotations as unknown as { remove(cfi: string, type: string, cls: string): void }
      ).remove(cfi, "highlight", "search-hl");
    } catch {
      // 移除失败不影响跳转
    }
  };

  const navigateSearchResult = (locator: string) => {
    pushHistory();
    if (isPdf) {
      const l = parsePdfLocator(locator);
      if (l?.page) pdfRef.current?.goToPage(l.page);
      return;
    }
    const r = renditionRef.current;
    if (!r) return;
    clearSearchHighlight();
    void r
      .display(locator)
      .then(() => {
        try {
          r.annotations.highlight(
            locator,
            {},
            undefined,
            "search-hl",
            { fill: "rgba(96, 165, 250, 0.3)", "fill-opacity": "0.3" }
          );
          searchHlRef.current = locator;
        } catch {
          // 高亮失败不影响跳转
        }
      })
      .catch(() => {});
  };

  // ---------- 跳转历史（Alt+← 返回跳转前位置） ----------

  const currentLocator = (): string => {
    if (book.format === "pdf") return pdfLocator(pdfPageRef.current, pdfScrollRef.current);
    return lastCfiRef.current ?? "";
  };

  const pushHistory = () => {
    const loc = currentLocator();
    if (!loc) return;
    const h = historyRef.current;
    if (h[h.length - 1] === loc) return;
    h.push(loc);
    if (h.length > 100) h.shift();
  };

  const goBack = () => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    if (book.format === "pdf") {
      const l = parsePdfLocator(prev);
      if (l?.page) pdfRef.current?.goToPage(l.page);
    } else {
      void renditionRef.current?.display(prev);
    }
  };
  goBackRef.current = goBack;

  // ---------- 划线快存（引用即高亮，不写内容） ----------

  const handleQuickHighlight = async () => {
    if (!selection) return;
    try {
      const saved = await saveNote({
        bookId: book.id,
        locator: selection.cfi,
        chapterTitle: chapterTitle || null,
        quote: excerptOf(selection.text, 300),
        content: "",
      });
      setNotes((prev) => [saved, ...prev.filter((n) => n.id !== saved.id)]);
      setSelection(null);
      showToast("已划线");
    } catch (e) {
      console.error("划线失败", e);
    }
  };

  // PDF 划选（空文本 = 清除选区）
  const handlePdfSelected = (info: PdfSelectionInfo) => {
    if (!info.text) {
      setSelection(null);
      return;
    }
    setSelection({ cfi: info.locator, text: info.text, x: info.x, y: info.y });
  };

  // 打开书：刷新数据 + 更新最近阅读时间
  useEffect(() => {
    getBook(book.id).then(setCurrent).catch(() => {});
  }, [book.id]);

  // 载入书签与笔记
  useEffect(() => {
    listBookmarks(book.id).then(setBookmarks).catch(() => {});
    listNotes(book.id).then(setNotes).catch(() => {});
  }, [book.id]);

  // 卸载兜底：立即保存最后位置（两引擎的 relocated 已做节流保存）
  useEffect(() => {
    return () => {
      if (book.format === "pdf") {
        if (pdfPageRef.current > 0) {
          void saveProgress(book.id, { page: pdfPageRef.current, y: pdfScrollRef.current });
        }
      } else {
        const cfi = lastCfiRef.current;
        if (cfi) void saveProgress(book.id, { cfi });
      }
    };
  }, [book.id, book.format]);

  // Esc 关闭弹层/侧栏；b 书签；n 笔记；Ctrl+F 搜索；? 帮助；Alt+← 跳转返回
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpenRef.current) return; // 弹窗自己处理按键（含 Esc）
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        setPanel(null);
        setSelection(null);
        setHelpOpen(false);
      } else if (e.ctrlKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setPanel("search");
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBackRef.current();
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        addBookmarkRef.current();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        addNoteRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- 位置变化（EPUB） ----------

  const handleRelocated = (info: RelocatedInfo) => {
    lastCfiRef.current = info.cfi;
    setCurrentHref(info.href);
    setChapterTitle(info.chapterTitle ?? matchTocLabel(toc, info.href) ?? "");
    setPercent(info.percent);
    lastPercentRef.current = info.percent;
    setSelection(null); // 翻页后选区失效
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveProgress(book.id, { cfi: info.cfi });
    }, 800);
  };

  // ---------- 位置变化（PDF） ----------

  const handlePdfRelocated = (info: PdfRelocatedInfo) => {
    pdfPageRef.current = info.page;
    pdfScrollRef.current = info.scrollTop;
    setCurrentHref(`p:${info.page}`);
    setChapterTitle(`第 ${info.page} / ${pdfCountRef.current || "?"} 页`);
    setPercent(info.percent);
    lastPercentRef.current = info.percent;
    setSelection(null); // 滚动后选区失效
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveProgress(book.id, { page: info.page, y: info.scrollTop });
    }, 800);
  };

  // ---------- 书签 ----------

  const excerptOf = (text: string | null, max = 60) =>
    text ? (text.length > max ? `${text.slice(0, max)}…` : text) : null;

  const handleAddBookmark = async () => {
    if (isPdf) {
      const page = pdfPageRef.current;
      try {
        const bm = await addBookmark(
          book.id,
          pdfLocator(page, pdfScrollRef.current),
          `第 ${page} 页`,
          excerptOf(pdfRef.current?.getSelectionText() ?? null)
        );
        setBookmarks((prev) => [bm, ...prev]);
        setPanel("bookmarks");
      } catch (e) {
        console.error("添加书签失败", e);
      }
      return;
    }
    const rendition = renditionRef.current;
    const cfi = lastCfiRef.current;
    if (!rendition || !cfi) return;
    let excerpt: string | null = null;
    try {
      const range = rendition.getRange(cfi);
      const text = range?.toString().replace(/\s+/g, " ").trim();
      excerpt = excerptOf(text);
    } catch {
      // 取不到摘录就只存位置
    }
    try {
      const bm = await addBookmark(book.id, cfi, chapterTitle || null, excerpt);
      setBookmarks((prev) => [bm, ...prev]);
      setPanel("bookmarks");
    } catch (e) {
      console.error("添加书签失败", e);
    }
  };
  addBookmarkRef.current = () => void handleAddBookmark();

  const handleDeleteBookmark = (id: number) => {
    deleteBookmark(id)
      .then(() => setBookmarks((prev) => prev.filter((b) => b.id !== id)))
      .catch((e) => console.error("删除书签失败", e));
  };

  // ---------- 笔记 ----------

  // EPUB：划选完成，等待点浮层按钮
  const handleSelected = (s: SelectionInfo) => {
    setSelection(s);
  };

  // EPUB：划选 → 添加笔记弹窗（引用 = 选中文本）
  const openNoteFromSelection = () => {
    if (!selection) return;
    setNoteDraft({
      locator: selection.cfi,
      chapterTitle: chapterTitle || null,
      quote: excerptOf(selection.text, 300),
    });
    setSelection(null);
  };

  // 当前页直接写笔记（两种格式通用）
  const openNoteAtPage = () => {
    if (isPdf) {
      const page = pdfPageRef.current;
      setNoteDraft({
        locator: pdfLocator(page),
        chapterTitle: `第 ${page} 页`,
        quote: excerptOf(pdfRef.current?.getSelectionText() ?? null, 300),
      });
      return;
    }
    const cfi = lastCfiRef.current;
    if (!cfi) return;
    setNoteDraft({ locator: cfi, chapterTitle: chapterTitle || null, quote: null });
  };
  addNoteRef.current = openNoteAtPage;

  const handleSaveNote = async (content: string) => {
    if (!noteDraft) return;
    try {
      const saved = await saveNote({
        id: noteDraft.editing?.id,
        bookId: book.id,
        locator: noteDraft.locator,
        chapterTitle: noteDraft.chapterTitle,
        quote: noteDraft.quote,
        content,
      });
      setNotes((prev) => [saved, ...prev.filter((n) => n.id !== saved.id)]);
      setNoteDraft(null);
      setPanel("notes");
    } catch (e) {
      console.error("保存笔记失败", e);
    }
  };

  const handleDeleteNote = (id: number) => {
    deleteNote(id)
      .then(() => setNotes((prev) => prev.filter((n) => n.id !== id)))
      .catch((e) => console.error("删除笔记失败", e));
  };

  // ---------- 跳转 ----------

  const jumpToLocator = (locator: string) => {
    pushHistory();
    if (isPdf) {
      const l = parsePdfLocator(locator);
      if (l?.page) pdfRef.current?.goToPage(l.page);
    } else {
      void renditionRef.current?.display(locator);
    }
  };

  const handleNavigateToc = (href: string) => {
    pushHistory();
    if (href.startsWith("p:")) {
      const p = Number(href.slice(2));
      if (p > 0) pdfRef.current?.goToPage(p);
    } else {
      void renditionRef.current?.display(href);
    }
  };

  const goPrev = () => {
    countPageTurn();
    if (isPdf) pdfRef.current?.scrollByPage(-1);
    else void renditionRef.current?.prev();
  };
  const goNext = () => {
    countPageTurn();
    if (isPdf) pdfRef.current?.scrollByPage(1);
    else void renditionRef.current?.next();
  };

  // ---------- 显示参数 ----------

  const changeFont = (delta: number) => {
    setFontSize((s) => {
      const next = Math.min(220, Math.max(75, s + delta));
      localStorage.setItem("epubFontSize", String(next));
      return next;
    });
  };
  const changeZoom = (delta: number) => {
    setZoom((z) => {
      const next = Math.min(3, Math.max(0.5, Math.round((z + delta) * 10) / 10));
      localStorage.setItem("pdfZoom", String(next));
      return next;
    });
  };

  const initialCfi = (book.progress as { cfi?: string } | null | undefined)?.cfi ?? null;
  const initialPage = (book.progress as { page?: number } | null | undefined)?.page ?? null;
  // 引用型笔记 → EPUB 高亮（EpubView 内部幂等去重）
  const noteHighlights = notes.filter((n) => n.quote).map((n) => n.locator);

  return (
    <div className="reader">
      <header className="reader-header">
        <button onClick={onBack} title="返回书架">
          ← 书架
        </button>
        <div className="reader-title">
          <h2>{current.title}</h2>
          <span className="chapter-name" title={chapterTitle}>
            {chapterTitle || current.author || ""}
          </span>
        </div>
        <div className="reader-toolbar">
          {isPdf ? (
            <>
              <button onClick={() => changeZoom(-0.1)} title="缩小（Ctrl+滚轮）">
                −
              </button>
              <span className="percent-text">{Math.round(zoom * 100)}%</span>
              <button onClick={() => changeZoom(0.1)} title="放大（Ctrl+滚轮）">
                ＋
              </button>
            </>
          ) : (
            <>
              <button onClick={() => changeFont(-10)} title="减小字号">
                A−
              </button>
              <button onClick={() => changeFont(10)} title="增大字号">
                A＋
              </button>
            </>
          )}
          <button
            onClick={cycleTheme}
            title={`主题：${theme === "dark" ? "夜间" : theme === "light" ? "日间" : "护眼"}（点击切换）`}
          >
            {theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "📜"}
          </button>
          <button onClick={goPrev} title="上一页（←）">
            ‹
          </button>
          <span className="percent-text">{Math.round(percent * 100)}%</span>
          <button onClick={goNext} title="下一页（→）">
            ›
          </button>
          <button
            className={panel === "toc" ? "primary" : ""}
            onClick={() => setPanel((p) => (p === "toc" ? null : "toc"))}
            title="目录（Esc 关闭）"
          >
            ☰ 目录
          </button>
          <button
            className={panel === "bookmarks" ? "primary" : ""}
            onClick={() => setPanel((p) => (p === "bookmarks" ? null : "bookmarks"))}
            title="书签（b 在当前位置添加）"
          >
            🔖 书签{bookmarks.length > 0 ? ` ${bookmarks.length}` : ""}
          </button>
          <button
            className={panel === "notes" ? "primary" : ""}
            onClick={() => setPanel((p) => (p === "notes" ? null : "notes"))}
            title="笔记（n 在当前位置写笔记）"
          >
            📝 笔记{notes.length > 0 ? ` ${notes.length}` : ""}
          </button>
          <button
            className={panel === "search" ? "primary" : ""}
            onClick={() => setPanel((p) => (p === "search" ? null : "search"))}
            title="全文搜索（Ctrl+F）"
          >
            🔍
          </button>
          <button
            onClick={() => setReviewOpen(true)}
            title="复习闪卡（有引用的笔记自动变成卡片）"
          >
            🔁{dueCount > 0 ? ` ${dueCount}` : ""}
          </button>
          <button onClick={() => setHelpOpen(true)} title="快捷键帮助（?）">
            ❓
          </button>
        </div>
      </header>

      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${percent * 100}%` }} />
      </div>

      <div className="reader-content">
        {panel && (
          <aside className="side-panel">
            <div className="panel-tabs">
              <button
                className={panel === "toc" ? "active" : ""}
                onClick={() => setPanel("toc")}
              >
                目录
              </button>
              <button
                className={panel === "bookmarks" ? "active" : ""}
                onClick={() => setPanel("bookmarks")}
              >
                书签{bookmarks.length > 0 ? ` (${bookmarks.length})` : ""}
              </button>
              <button
                className={panel === "notes" ? "active" : ""}
                onClick={() => setPanel("notes")}
              >
                笔记{notes.length > 0 ? ` (${notes.length})` : ""}
              </button>
              <button
                className={panel === "search" ? "active" : ""}
                onClick={() => setPanel("search")}
              >
                搜索
              </button>
            </div>
            {panel === "toc" && (
              <TocPanel toc={toc} currentHref={currentHref} onNavigate={handleNavigateToc} />
            )}
            {panel === "bookmarks" && (
              <BookmarkPanel
                bookmarks={bookmarks}
                onAdd={() => addBookmarkRef.current()}
                onNavigate={jumpToLocator}
                onDelete={handleDeleteBookmark}
              />
            )}
            {panel === "notes" && (
              <NotePanel
                notes={notes}
                onAdd={() => addNoteRef.current()}
                onExport={() => void handleExportMd()}
                onNavigate={jumpToLocator}
                onEdit={(n) =>
                  setNoteDraft({
                    editing: n,
                    locator: n.locator,
                    chapterTitle: n.chapterTitle,
                    quote: n.quote,
                  })
                }
                onDelete={handleDeleteNote}
              />
            )}
            {panel === "search" && (
              <SearchPanel
                query={searchQuery}
                onQueryChange={setSearchQuery}
                results={searchResults}
                searching={searching}
                done={searchDone}
                isPdf={isPdf}
                onSearch={() => void runSearch()}
                onNavigate={navigateSearchResult}
              />
            )}
          </aside>
        )}
        <div className="epub-wrap">
          {isPdf ? (
            <PdfView
              ref={pdfRef}
              key={current.filePath}
              filePath={current.filePath}
              initialPage={initialPage}
              zoom={zoom}
              onZoomDelta={changeZoom}
              onReady={(tocItems, count) => {
                setToc(tocItems);
                pdfCountRef.current = count;
              }}
              onRelocated={handlePdfRelocated}
              onSelected={handlePdfSelected}
              onPageTurn={countPageTurn}
              keysEnabled={!modalOpenRef.current}
            />
          ) : (
            <EpubView
              key={current.filePath}
              filePath={current.filePath}
              initialCfi={initialCfi}
              fontSize={fontSize}
              theme={theme}
              highlights={noteHighlights}
              onReady={(r, b) => {
                renditionRef.current = r;
                epubBookRef.current = b;
              }}
              onToc={setToc}
              onRelocated={handleRelocated}
              onSelected={handleSelected}
              onPageTurn={countPageTurn}
              keysEnabled={!modalOpenRef.current}
            />
          )}
          <div className="click-zone left" onClick={goPrev} title="上一页" />
          <div className="click-zone right" onClick={goNext} title="下一页" />
          {selection && !noteDraft && (
            <div className="sel-fab-group" style={{ left: selection.x, top: selection.y }}>
              <button
                className="sel-fab"
                onClick={() => void handleQuickHighlight()}
                title="划线：保存为高亮，不用写内容"
              >
                🖍 划线
              </button>
              <button
                className="sel-fab"
                onClick={openNoteFromSelection}
                title="保存选中文本为笔记引用"
              >
                ✍️ 添加笔记
              </button>
            </div>
          )}
        </div>
      </div>

      {noteDraft && (
        <NoteModal draft={noteDraft} onClose={() => setNoteDraft(null)} onSave={handleSaveNote} />
      )}

      {reviewOpen && (
        <ReviewModal
          cards={reviewCards}
          onClose={() => {
            setReviewOpen(false);
            refreshReview();
          }}
          onReviewed={handleReviewed}
        />
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}