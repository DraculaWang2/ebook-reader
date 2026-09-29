import type { Bookmark } from "../types";

interface Props {
  bookmarks: Bookmark[];
  onAdd: () => void;
  onNavigate: (locator: string) => void;
  onDelete: (id: number) => void;
}

export default function BookmarkPanel({ bookmarks, onAdd, onNavigate, onDelete }: Props) {
  return (
    <div className="panel-body">
      <button className="primary bm-add" onClick={onAdd} title="快捷键：b">
        ＋ 在当前位置添加书签
      </button>
      <div className="bm-list">
        {bookmarks.length === 0 && (
          <div className="toc-empty">还没有书签，阅读时按 b 或点上方按钮添加</div>
        )}
        {bookmarks.map((b) => (
          <div key={b.id} className="bm-item" onClick={() => onNavigate(b.locator)}>
            <div className="bm-head">
              <span className="bm-chapter" title={b.chapterTitle ?? ""}>
                {b.chapterTitle ?? "未知章节"}
              </span>
              <button
                className="bm-del"
                title="删除书签"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(b.id);
                }}
              >
                ✕
              </button>
            </div>
            {b.excerpt && <div className="bm-excerpt">“{b.excerpt}”</div>}
            <div className="bm-time">{b.createdAt.replace("T", " ").slice(0, 16)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
