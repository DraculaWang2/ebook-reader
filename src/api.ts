import { invoke } from "@tauri-apps/api/core";
import type { Book, Bookmark, Note, NoteInput, ReadingStat, ReviewCard } from "./types";

// ---- 书架 ----
export const listBooks = () => invoke<Book[]>("list_books");
export const importBook = (path: string) => invoke<Book>("import_book", { path });
export const getBook = (id: number) => invoke<Book>("get_book", { id });
export const deleteBook = (id: number) => invoke<void>("delete_book", { id });

// ---- 进度 ----
export const saveProgress = (bookId: number, progress: unknown) =>
  invoke<void>("save_progress", { bookId, progress });

// ---- 书签 ----
export const addBookmark = (
  bookId: number,
  locator: string,
  chapterTitle?: string | null,
  excerpt?: string | null
) => invoke<Bookmark>("add_bookmark", { bookId, locator, chapterTitle, excerpt });
export const listBookmarks = (bookId: number) =>
  invoke<Bookmark[]>("list_bookmarks", { bookId });
export const deleteBookmark = (id: number) =>
  invoke<void>("delete_bookmark", { id });

// ---- 笔记 ----
export const saveNote = (note: NoteInput) => invoke<Note>("save_note", { note });
export const listNotes = (bookId: number) => invoke<Note[]>("list_notes", { bookId });
export const deleteNote = (id: number) => invoke<void>("delete_note", { id });

// ---- 导出 ----
export const exportBookMd = (bookId: number, path: string) =>
  invoke<void>("export_book_md", { bookId, path });

// ---- 复习闪卡 ----
export const listReviewCards = (bookId: number) =>
  invoke<ReviewCard[]>("list_review_cards", { bookId });
export const reviewNote = (noteId: number, result: 0 | 1 | 2) =>
  invoke<void>("review_note", { noteId, result });

// ---- 阅读统计 ----
/** 记录一段阅读（秒数/翻页数聚合到当天），percent 顺带刷新书架进度条 */
export const recordReading = (
  bookId: number,
  seconds: number,
  pages: number,
  percent?: number | null
) => invoke<void>("record_reading", { bookId, seconds, pages, percent: percent ?? null });
export const listReadingStats = () => invoke<ReadingStat[]>("list_reading_stats");