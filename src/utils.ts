import type { TocItem } from "./types";

/** 去掉 href 中的 #fragment，便于章节路径比对 */
export const stripHash = (href: string): string => href.split("#")[0];

/** 按 href 在目录里找章节名（epub.js 未提供 ancestorTitles 时的兜底） */
export function matchTocLabel(toc: TocItem[], href: string | null): string | null {
  if (!href) return null;
  const target = stripHash(href);
  for (const item of toc) {
    const th = stripHash(item.href);
    if (th === target || target.endsWith("/" + th)) return item.label;
  }
  return null;
}

/** 与 Rust review_note 的 SM-2 lite 一致（用于评分按钮的间隔预览） */
export function previewIntervalMinutes(
  card: { intervalMinutes: number; ease: number },
  grade: 0 | 1 | 2
): number {
  if (grade === 0) return 10;
  if (grade === 1) return Math.min(43200, Math.max(card.intervalMinutes, 60) * 1.2);
  const ease = Math.min(3.0, card.ease + 0.1);
  return card.intervalMinutes < 60 ? 1440 : Math.min(259200, card.intervalMinutes * ease);
}

export function fmtInterval(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`;
  return `${Math.round(minutes / 1440)} 天`;
}

/** SQLite datetime("YYYY-MM-DD HH:MM:SS"，UTC) → 是否已到期 */
export function isDue(dueAt: string, isNew: boolean): boolean {
  if (isNew || !dueAt) return true;
  return new Date(dueAt.replace(" ", "T") + "Z").getTime() <= Date.now();
}

/** 秒数 → 人性化时长（书架统计展示用） */
export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h} 小时 ${rest} 分` : `${h} 小时`;
}