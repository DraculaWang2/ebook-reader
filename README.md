# E-Book Reader（Rust + Tauri 2）

桌面电子书阅读器：**EPUB / PDF / TXT**，支持目录跳转、书签、划线、笔记、全文搜索、复习闪卡、阅读统计与进度记忆。

需求文档见 [PROMPT.md](./PROMPT.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Tauri 2（Rust 后端 + 系统 WebView） |
| 前端 | Vite + React + TypeScript |
| EPUB 渲染 | epub.js（M2） |
| PDF 渲染 | pdf.js（M5） |
| 数据 | SQLite（rusqlite bundled），位于 `%APPDATA%\ebook-reader\library.db` |

> 定位符约定：EPUB 全部用 `epubcfi`，PDF 用 `{"page":n,"y":n}` JSON —— 进度、书签、笔记、搜索共用同一套定位机制。

## 开发

前置：[Rust](https://rustup.rs)（stable）+ Node.js ≥ 18

```bash
npm install        # 已执行过可跳过
npm run tauri dev  # 开发模式
npm run tauri build  # 打包安装程序
```

改图标：替换 `scripts/icon.png` 后运行 `npm run icon`。

## 目录结构

```
src/                        # 前端（React + TS）
  pages/Shelf.tsx             书架：导入/删除/打开 + 进度条/打卡天数/累计时长
  pages/Reader.tsx            阅读器容器：工具栏/侧栏/快捷键/搜索/复习/统计采集
  components/EpubView.tsx     epub.js 封装（分页/主题/划选/高亮）
  components/PdfView.tsx      pdf.js 封装（懒渲染/文本层/缩放/搜索）
  components/TocPanel 等      目录 / 书签 / 笔记侧栏与弹窗
  components/SearchPanel.tsx  全文搜索面板（Ctrl+F）
  components/ReviewModal.tsx  复习闪卡弹窗（SM-2 lite）
  components/HelpModal.tsx    快捷键帮助（?）
  epub-search.ts              EPUB 全书流式搜索（复用 epub.js Section.search）
src-tauri/                  # Rust 后端
  src/db.rs                   SQLite 初始化与建表（books/bookmarks/notes/review_state/reading_stats）
  src/commands.rs             全部 Tauri 命令（书/书签/笔记/进度/导出/复习/统计）
  src/meta.rs                 EPUB 元数据与封面解析
  src/txt.rs                  TXT 解析（UTF-8/GBK）+ 内存合成 EPUB3
```

## 里程碑进度

- [x] M1 骨架：Tauri + React + SQLite，导入书 → 书架（封面/书名/作者），后端命令全量就绪
- [x] M2 EPUB 阅读：epub.js 分页渲染、键盘/点击翻页、目录侧栏跳转与高亮、进度百分比、字号调节
- [x] M3 进度记忆（M2 已含）+ 书签：b 键/按钮快速添加（自动抓取当前页文字摘录）、双标签侧栏、跳转、删除
- [x] M4 笔记：划选正文→浮动按钮→弹窗（引用自动带入）；n 键当前页直记；侧栏三标签管理（跳转/编辑/删除）
- [x] M5 PDF：pdf.js v6 连续滚动渲染、文本层可选文字、outline 目录、Ctrl+滚轮缩放、进度/书签/笔记按页码定位
- [x] M6 扩展：TXT 导入（UTF-8/GBK 自动识别、章节切分、自动转合成 EPUB 全功能可用）、日间/夜间/护眼三主题（含 PDF 反色滤镜）、书签+笔记导出 Markdown、EPUB 引用笔记高亮持久化
- [x] M7 学习包：全文搜索（Ctrl+F，EPUB 逐章搜索跳精确 cfi 蓝色高亮 / PDF 按页搜索跳页）、复习闪卡（有引用的笔记自动成卡，SM-2 lite：不会 10 分钟 / 模糊 ×1.2 / 会 ×ease，上限 180 天）、划线快存（划选→浮层「🖍 划线」秒存高亮，EPUB/PDF 均可）、跳转返回（目录/书签/笔记/搜索跳转后 Alt+← 一键回跳）、快捷键帮助（? 键）、阅读统计（可见时长 + 翻页数落库，书架卡片显示进度条、连续打卡天数、累计时长）
- [ ] 待做：笔记面板内搜索/按章节筛选、阅读目标（每日 N 页/N 分钟）