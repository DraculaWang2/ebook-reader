import { useRef } from "react";
import type { SearchResult } from "../types";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchResult[];
  searching: boolean;
  done: boolean;
  isPdf: boolean;
  onSearch: () => void;
  onNavigate: (locator: string) => void;
}

function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

export default function SearchPanel({
  query,
  onQueryChange,
  results,
  searching,
  done,
  isPdf,
  onSearch,
  onNavigate,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="panel-body">
      <div className="search-box">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          placeholder="搜索全书内容…"
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearch();
          }}
        />
        <button className="primary" onClick={onSearch} disabled={searching || !query.trim()}>
          搜
        </button>
      </div>
      <div className="search-status">
        {searching
          ? `搜索中… 已找到 ${results.length} 处`
          : done
            ? `完成，共 ${results.length} 处`
            : "输入关键词后回车，全书搜索"}
      </div>
      <div className="bm-list">
        {done && results.length === 0 && (
          <div className="toc-empty">
            {isPdf ? "没有结果。扫描版 PDF 没有文字层，无法搜索。" : "没有找到匹配内容"}
          </div>
        )}
        {results.map((r, i) => (
          <div key={i} className="search-item" onClick={() => onNavigate(r.locator)}>
            <div className="bm-chapter" title={r.chapter}>
              {r.chapter || "未知章节"}
            </div>
            <div className="search-excerpt">
              <Highlighted text={r.excerpt} term={query.trim()} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
