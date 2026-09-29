import type { Note } from "../types";

interface Props {
  notes: Note[];
  /** 在当前位置新建笔记（无引用） */
  onAdd: () => void;
  /** 导出书签与笔记为 Markdown */
  onExport: () => void;
  onNavigate: (locator: string) => void;
  onEdit: (note: Note) => void;
  onDelete: (id: number) => void;
}

export default function NotePanel({ notes, onAdd, onExport, onNavigate, onEdit, onDelete }: Props) {
  return (
    <div className="panel-body">
      <div className="panel-actions">
        <button className="primary bm-add" onClick={onAdd} title="快捷键：n">
          ＋ 在当前位置写笔记
        </button>
        <button className="bm-export" onClick={onExport} title="导出书签与笔记为 Markdown">
          ⬇ 导出
        </button>
      </div>
      <div className="bm-list">
        {notes.length === 0 && (
          <div className="toc-empty">
            还没有笔记。
            <br />
            选中正文文字后点「添加笔记」，<br />
            或点上方按钮直接记录。
          </div>
        )}
        {notes.map((n) => (
          <div key={n.id} className="note-item" onClick={() => onNavigate(n.locator)}>
            {n.quote && <blockquote className="note-quote">“{n.quote}”</blockquote>}
            {n.content ? (
              <div className="note-content">{n.content}</div>
            ) : (
              <div className="note-hl-tag">🖍 划线</div>
            )}
            <div className="note-foot">
              <span className="bm-time">
                {n.updatedAt.replace("T", " ").slice(0, 16)}
                {n.chapterTitle ? ` · ${n.chapterTitle}` : ""}
              </span>
              <span className="note-ops">
                <button
                  className="bm-del"
                  title="编辑"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(n);
                  }}
                >
                  ✎
                </button>
                <button
                  className="bm-del"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(n.id);
                  }}
                >
                  ✕
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
