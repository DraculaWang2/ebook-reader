import type { Book } from "epubjs";
import type { SearchResult } from "./types";

/** epub.js Section 的运行时结构（类型文件未覆盖 search/load 的异步签名） */
interface SearchSection {
  href: string;
  load(request?: unknown): Promise<Document>;
  search(query: string, maxSeqEle?: number): Promise<{ cfi: string; excerpt: string }[]>;
  unload(): void;
}

/**
 * EPUB 全书顺序搜索（流式回调，逐节返回）
 * 复用 epub.js 内置 Section.search：跨行内标签合并匹配 + 自动生成 cfi
 */
export async function searchEpub(
  book: Book,
  query: string,
  chapterOf: (href: string) => string,
  onResult: (r: SearchResult) => void
): Promise<void> {
  const q = query.trim();
  if (!q) return;
  await book.ready;

  const sections: SearchSection[] = [];
  (book.spine as unknown as { each(cb: (s: SearchSection) => void): void }).each((s) =>
    sections.push(s)
  );

  const load = (book as unknown as { load?: unknown }).load;
  const request = typeof load === "function" ? load.bind(book) : undefined;

  for (const section of sections) {
    try {
      await section.load(request);
      const matches = await section.search(q);
      const chapter = chapterOf(section.href);
      for (const m of matches) {
        onResult({
          locator: m.cfi,
          chapter,
          excerpt: (m.excerpt ?? "").replace(/\s+/g, " ").trim(),
        });
      }
    } catch {
      // 单节失败跳过，不影响整体
    }
    section.unload();
  }
}
