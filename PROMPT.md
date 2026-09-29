# 电子书阅读器（Rust + Tauri 桌面 GUI）— 项目提示词 / 需求规格

## 一、项目定位

- **桌面客户端 GUI**（非 TUI / 非终端程序）
- Rust 生态的 "Electron"：**Tauri 2** —— Rust 后端 + 系统 WebView 前端
- 前端用 TypeScript（Vite + React），读写逻辑在 Rust 侧
- 支持 **EPUB + PDF**（TXT 作为可选扩展）
- 数据持久化：**SQLite**（rusqlite，bundled 免依赖）

## 二、为什么选 Tauri（而不是其他）

| 方案 | 说明 |
|---|---|
| ✅ **Tauri 2** | Electron 的 Rust 对应物：前端仍是 HTML/CSS/TS，后端换 Rust。Windows 用系统自带 WebView2，安装包 ~10MB、内存占用低。EPUB 本质是 XHTML，WebView 原生渲染排版最好；PDF 用 pdf.js（Firefox 同款引擎） |
| ❌ egui / iced / slint | 纯 Rust 原生 GUI，但 PDF 渲染（要绑 pdfium）、富文本排版、文字选择都要自己造轮子，做阅读器性价比低 |

## 三、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 应用框架 | Tauri 2 | 窗口、菜单、前后端 IPC（commands） |
| 前端 | Vite + TypeScript + React | 阅读界面、书架、侧栏面板 |
| EPUB 渲染 | epub.js | 分页排版、目录、**epubcfi** 精确定位（书签/笔记锚点） |
| PDF 渲染 | pdf.js | 页面 canvas 渲染、outline 目录、文本层（可选中文本做笔记引用） |
| Rust 后端 | tauri v2 commands | 文件读取、元数据解析、所有数据库操作 |
| 数据库 | rusqlite（feature = "bundled"） | 自带 SQLite，无需用户安装 |
| 数据目录 | `dirs` crate | Windows: `%APPDATA%\ebook-reader\`，库文件 `library.db` |

## 四、功能需求

### 4.1 书架（首页）
- 打开/导入书（.epub / .pdf），显示封面、书名、作者、阅读进度
- 最近阅读排序；删除条目（可选：保留笔记或一并删除）

### 4.2 阅读器
- **EPUB**：分页排版、字号/主题（日间/夜间/护眼）、上下章切换
- **PDF**：整页渲染、缩放（Ctrl+滚轮）、连续滚动
- 顶部栏：书名、当前章节、进度百分比；侧栏开关按钮

### 4.3 目录跳转
- 左侧目录面板：EPUB 取 nav/NCX，PDF 取 outline（书签树）
- 点击条目直接跳转；当前章节高亮

### 4.4 书签
- 一键在当前位置加书签（EPUB 存 epubcfi；PDF 存 页码+视口偏移）
- 书签面板：列表（章节名 + 摘要 + 时间）、点击跳转、删除

### 4.5 笔记
- 选中文本 → 弹出"添加笔记"，自动保存选中内容为引用
- 笔记面板：列表（引用 + 我的笔记 + 时间）、点击跳转、编辑、删除
- 附加：书内所有划线/高亮显示（可选）；导出 Markdown（可选）

### 4.6 进度记忆
- 翻页/关闭窗口时自动保存（EPUB: cfi；PDF: 页码）
- 重新打开同一本书恢复位置

## 五、SQLite 数据模型

```sql
CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  format TEXT NOT NULL,            -- 'epub' | 'pdf'
  file_path TEXT NOT NULL UNIQUE,
  cover_path TEXT,                 -- 封面缓存
  progress TEXT,                   -- JSON: {"cfi": "..."} 或 {"page": 12, "offsetY": 300}
  added_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL
);

CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locator TEXT NOT NULL,           -- epubcfi 或 {"page":12,"offsetY":300}
  chapter_title TEXT,
  excerpt TEXT,                    -- 位置附近文字摘要
  created_at TEXT NOT NULL
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locator TEXT NOT NULL,
  chapter_title TEXT,
  quote TEXT,                      -- 选中的原文引用（可空）
  content TEXT NOT NULL,           -- 笔记内容
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 六、架构设计

```
ebook-reader/
├── package.json / vite.config.ts / tsconfig.json
├── src/                          # 前端
│   ├── main.tsx
│   ├── App.tsx                   # 路由：书架 / 阅读器
│   ├── api.ts                    # 封装 invoke() 调用 Rust 命令
│   ├── store.ts                  # 前端状态（当前书、面板开关）
│   ├── pages/
│   │   ├── Shelf.tsx             # 书架
│   │   └── Reader.tsx            # 阅读器容器
│   └── components/
│       ├── EpubView.tsx          # epub.js 封装
│       ├── PdfView.tsx           # pdf.js 封装
│       ├── TocPanel.tsx          # 目录面板
│       ├── BookmarkPanel.tsx     # 书签面板
│       └── NotePanel.tsx         # 笔记面板 + 编辑弹窗
└── src-tauri/                    # Rust 后端
    ├── Cargo.toml
    └── src/
        ├── main.rs               # tauri 启动、注册 commands
        ├── db.rs                 # SQLite 初始化 + 迁移
        ├── models.rs             # Book / Bookmark / Note 结构体（serde）
        ├── commands.rs           # 命令：add_book / list_books / open_book
        │                         #       save_progress / get_progress
        │                         #       add_bookmark / list_bookmarks / delete_bookmark
        │                         #       save_note / list_notes / delete_note
        └── meta.rs               # EPUB 元数据解析（zip+quick-xml）、PDF 页数/outline（lopdf 或 pdf）
```

**职责边界**：渲染在前端（epub.js / pdf.js），数据与文件全部走 Rust commands + SQLite，前端不直接碰 fs。

## 七、里程碑（每步可运行）

- **M1 骨架**：Tauri + Vite + React 项目跑通；SQLite 建库；导入书 → 书架显示元数据
- **M2 EPUB 阅读**：epub.js 渲染、翻页、章节切换、目录面板跳转
- **M3 进度 + 书签**：自动保存/恢复进度；书签增删查跳
- **M4 笔记**：选中文本引用、笔记面板、编辑/删除/跳转
- **M5 PDF**：pdf.js 渲染、缩放、outline 目录、进度/书签/笔记适配 PDF 定位
- **M6 扩展（可选）**：TXT、主题切换、导出 Markdown、全文搜索、高亮持久化

## 八、验收标准

1. `npm run tauri dev` 启动桌面应用，能导入 .epub 并分页阅读
2. 点击目录条目正确跳转，当前章节高亮
3. 加书签 → 重启应用 → 书签仍在，可跳转可删除
4. 选中文本写笔记 → 重启 → 笔记仍在，可编辑/删除/跳转到原文位置
5. 导入 .pdf 可阅读，outline 目录跳转、书签/笔记按页码定位
6. 关闭重开任意书，恢复上次阅读位置
7. 数据库单文件 `library.db`，损坏文件/不支持格式给出友好错误，不崩溃

## 九、非目标（明确不做）

- MOBI / AZW / DRM 加密格式
- 在线书城、账号同步
- PDF 表单填写、批注绘图（只做文本书签/笔记）

## 十、环境前置条件

- Rust 工具链（rustup + stable）
- Node.js ≥ 18（构建前端）
- Windows：WebView2 运行时（Win10/11 系统自带）
- Tauri CLI：`npm i -D @tauri-apps/cli`
