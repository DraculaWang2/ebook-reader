import { useEffect, useState } from "react";
import type { ReviewCard } from "../types";
import { fmtInterval, isDue, previewIntervalMinutes } from "../utils";

interface Props {
  cards: ReviewCard[];
  onClose: () => void;
  onReviewed: (noteId: number, result: 0 | 1 | 2) => Promise<void>;
}

export default function ReviewModal({ cards, onClose, onReviewed }: Props) {
  // 快照本轮待复习队列（评分后卡片数据会变，队列不跟着变）
  const [queue] = useState<ReviewCard[]>(() => cards.filter((c) => isDue(c.dueAt, c.isNew)));
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);

  const future = cards.length - queue.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (done || idx >= queue.length) return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped(true);
      } else if (flipped && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        void grade((Number(e.key) - 1) as 0 | 1 | 2);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, idx, done, queue, onClose]);

  const grade = async (result: 0 | 1 | 2) => {
    const card = queue[idx];
    setFlipped(false);
    await onReviewed(card.note.id, result);
    if (idx + 1 >= queue.length) setDone(true);
    else setIdx((i) => i + 1);
  };

  const card = queue[idx];

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal rv-modal">
        {cards.length === 0 ? (
          <>
            <div className="modal-title">🔁 复习</div>
            <div className="rv-empty">
              还没有可复习的卡片。
              <br />
              划选正文写笔记（会自动带上引用），
              <br />
              有引用的笔记会自动变成闪卡；划线内容可在笔记面板查看。
            </div>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                知道了
              </button>
            </div>
          </>
        ) : done || !card ? (
          <>
            <div className="modal-title">🎉 本轮复习完成</div>
            <div className="rv-empty">
              共复习 {queue.length} 张卡片
              {future > 0 && <>，还有 {future} 张未到期</>}
              <br />
              到期的卡片会在工具栏 🔁 上显示数量
            </div>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                继续阅读 📖
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rv-progress">
              复习 · 第 {idx + 1} / {queue.length} 张
              {future > 0 && <span className="rv-future">（{future} 张未到期）</span>}
              {card.reps > 0 && (
                <span className="rv-future">
                  　已复习 {card.reps} 次{card.lapses > 0 ? ` · 忘过 ${card.lapses} 次` : ""}
                </span>
              )}
            </div>
            <div className="rv-card" onClick={() => setFlipped(true)} title="点击或按空格翻面">
              <div className="rv-chapter">
                {card.note.chapterTitle ?? "未命名章节"}
              </div>
              <div className="rv-quote">“{card.note.quote}”</div>
              {flipped ? (
                <div className="rv-answer">{card.note.content}</div>
              ) : (
                <div className="rv-hint">回忆一下… 点击卡片或按 空格 看答案</div>
              )}
            </div>
            {flipped ? (
              <div className="rv-actions">
                <button className="rv-btn-fail" onClick={() => void grade(0)}>
                  不会
                  <small>{fmtInterval(previewIntervalMinutes(card, 0))}</small>
                </button>
                <button className="rv-btn-fuzzy" onClick={() => void grade(1)}>
                  模糊
                  <small>{fmtInterval(previewIntervalMinutes(card, 1))}</small>
                </button>
                <button className="rv-btn-good" onClick={() => void grade(2)}>
                  会了
                  <small>{fmtInterval(previewIntervalMinutes(card, 2))}</small>
                </button>
              </div>
            ) : (
              <div className="rv-hint2">翻面后按 1 / 2 / 3 评分，Esc 退出</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}