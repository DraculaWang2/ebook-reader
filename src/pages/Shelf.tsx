import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { deleteBook, importBook, listBooks, listReadingStats } from "../api";
import { fmtDuration } from "../utils";
import type { Book, ReadingStat } from "../types";

export default function Shelf({ onOpen }: { onOpen: (book: Book) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [stats, setStats] = useState<Map<number, ReadingStat>>(new Map());
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
      setError("");
    } catch (e) {
      setError(String(e));
    }
    // 统计拉取失败不影响书架展示
    try {
      const st = await listReadingStats();
      setStats(new Map(st.map((s) => [s.bookId, s])));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleImport = async () => {
    const picked = await open({
      multiple: false,
      title: "选择电子书",
      filters: [{ name: "电子书 (EPUB / PDF / TXT)", extensions: ["epub", "pdf", "txt"] }],
    });
    if (typeof picked === "string") {
      try {
        await importBook(picked);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteBook(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="shelf">
      <header className="shelf-header">
        <h1>📚 我的书架</h1>
        <div className="shelf-toolbar">
          <button className="primary" onClick={handleImport}>
            ＋ 导入图书
          </button>
        </div>
      </header>

      {error && <div className="error-bar">{error}</div>}

      <div className="shelf-grid">
        {books.length === 0 && !error && (
          <div className="empty">
            书架空空如也
            <br />
            点击右上角「导入图书」添加 EPUB / PDF
          </div>
        )}
        {books.map((b) => (
          <div className="book-card" key={b.id}>
            {b.coverPath ? (
              <img
                className="book-cover"
                src={convertFileSrc(b.coverPath)}
                alt={b.title}
              />
            ) : (
              <div className="book-cover-placeholder">{b.title.slice(0, 1)}</div>
            )}
            <div className="book-title" title={b.title}>
              {b.title}
            </div>
            <div className="book-meta">
              <span className="meta-text">{b.author ?? "未知作者"}</span>
              <span className="format-badge">{b.format.toUpperCase()}</span>
            </div>
            {(b.percent ?? 0) > 0 && (
              <div
                className="book-progress"
                title={`已读 ${Math.round((b.percent ?? 0) * 100)}%`}
              >
                <div
                  className="book-progress-bar"
                  style={{ width: `${Math.round((b.percent ?? 0) * 100)}%` }}
                />
              </div>
            )}
            {(() => {
              const s = stats.get(b.id);
              if (!s || (s.streakDays <= 0 && s.totalSeconds < 60)) return null;
              return (
                <div className="book-stat">
                  {s.streakDays > 0 && <span title="连续阅读天数">🔥 {s.streakDays} 天</span>}
                  {s.totalSeconds >= 60 && (
                    <span title={`累计翻页 ${s.totalPages}`}>⏱ {fmtDuration(s.totalSeconds)}</span>
                  )}
                </div>
              );
              })()}
            <div className="card-actions">
              <button className="primary" onClick={() => onOpen(b)}>
                阅读
              </button>
              <button className="danger" onClick={() => handleDelete(b.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}