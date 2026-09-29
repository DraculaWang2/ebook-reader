import { useEffect, useRef, useState } from "react";
import type { Note } from "../types";

/** 待保存的笔记草稿（editing 有值 = 编辑已有笔记） */
export interface NoteDraft {
  editing?: Note;
  locator: string;
  chapterTitle: string | null;
  quote: string | null;
}

interface Props {
  draft: NoteDraft;
  onClose: () => void;
  onSave: (content: string) => void;
}

export default function NoteModal({ draft, onClose, onSave }: Props) {
  const [content, setContent] = useState(draft.editing?.content ?? "");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = content.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-title">{draft.editing ? "✎ 编辑笔记" : "✍️ 添加笔记"}</div>
        {draft.chapterTitle && <div className="modal-chapter">{draft.chapterTitle}</div>}
        {draft.quote && (
          <blockquote className="modal-quote" title={draft.quote}>
            “{draft.quote}”
          </blockquote>
        )}
        <textarea
          ref={taRef}
          className="modal-textarea"
          value={content}
          placeholder="写下你的想法…（Ctrl+Enter 保存，Esc 取消）"
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={submit} disabled={!content.trim()}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
