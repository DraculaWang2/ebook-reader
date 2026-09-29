import { useEffect } from "react";

const ROWS: [string, string][] = [
  ["← / → / 空格 / PgUp·PgDn", "翻页"],
  ["点击屏幕左右两侧", "翻页"],
  ["b", "在当前位置加书签"],
  ["n", "在当前位置写笔记"],
  ["Ctrl + F", "全文搜索"],
  ["Alt + ←", "返回跳转前的位置"],
  ["Esc", "关闭面板 / 弹窗"],
  ["Ctrl + 滚轮", "PDF 缩放"],
  ["A− / A＋", "EPUB 字号"],
  ["空格", "复习卡片翻面（1/2/3 评分）"],
  ["?", "本帮助"],
];

export default function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal help-modal">
        <div className="modal-title">⌨️ 快捷键</div>
        <div className="help-list">
          {ROWS.map(([k, v]) => (
            <div className="help-row" key={k}>
              <span className="help-desc">{v}</span>
              <kbd>{k}</kbd>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
