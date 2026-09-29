import { useEffect, useRef } from "react";
import { stripHash } from "../utils";
import type { TocItem } from "../types";

interface Props {
  toc: TocItem[];
  /** 当前章节 href（含 fragment 也可），用于高亮 */
  currentHref: string | null;
  onNavigate: (href: string) => void;
}

export default function TocPanel({ toc, currentHref, onNavigate }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // 跳转后让当前章节滚动到可视区域
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, [currentHref]);

  const isActive = (href: string) => {
    if (!currentHref) return false;
    const t = stripHash(href);
    const c = stripHash(currentHref);
    return t === c || c.endsWith("/" + t);
  };

  return (
    <div className="panel-body">
      <div className="toc-list">
        {toc.length === 0 && <div className="toc-empty">本书没有目录信息</div>}
        {toc.map((t, i) => {
          const active = isActive(t.href);
          return (
            <button
              key={`${t.href}-${i}`}
              ref={active ? activeRef : undefined}
              className={"toc-item" + (active ? " active" : "")}
              style={{ paddingLeft: 14 + t.depth * 16 }}
              title={t.label}
              onClick={() => onNavigate(t.href)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
