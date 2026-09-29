// 与 Rust 侧 models.rs（serde camelCase）保持一致
export interface Book {
  id: number;
  title: string;
  author: string | null;
  format: "epub" | "pdf" | string;
  filePath: string;
  coverPath: string | null;
  progress: unknown;
  /** 阅读进度 0~1（随阅读统计周期性刷新，书架进度条用） */
  percent: number | null;
  addedAt: string;
  lastOpenedAt: string;
}

export interface Bookmark {
  id: number;
  bookId: number;
  locator: string;
  chapterTitle: string | null;
  excerpt: string | null;
  createdAt: string;
}

export interface Note {
  id: number;
  bookId: number;
  locator: string;
  chapterTitle: string | null;
  quote: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** 目录条目（树形扁平化后的列表，depth 用于缩进层级） */
export interface TocItem {
  label: string;
  href: string;
  depth: number;
}

/** 全文搜索结果 */
export interface SearchResult {
  locator: string;
  chapter: string;
  excerpt: string;
}

/** 复习闪卡（笔记 + SM-2 lite 状态） */
export interface ReviewCard {
  note: Note;
  /** 空字符串 = 新卡 */
  dueAt: string;
  intervalMinutes: number;
  ease: number;
  reps: number;
  lapses: number;
  isNew: boolean;
}

/** 阅读统计（按书聚合）：总时长/总翻页/连续打卡天数 */
export interface ReadingStat {
  bookId: number;
  totalSeconds: number;
  totalPages: number;
  streakDays: number;
}

/** 添加/编辑笔记的入参（id 为空 = 新建） */
export interface NoteInput {
  id?: number;
  bookId: number;
  locator: string;
  chapterTitle?: string | null;
  quote?: string | null;
  content: string;
}