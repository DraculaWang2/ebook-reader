use std::fs;
use std::path::PathBuf;
use std::sync::MutexGuard;

use rusqlite::{params, Connection};
use tauri::State;

use crate::db::{self, Db};
use crate::meta;
use crate::models::{Book, Bookmark, Note, NoteInput, ReadingStat, ReviewCard};
use crate::txt;

// ---------- 公共小工具 ----------

fn conn<'a>(db: &'a State<'a, Db>) -> Result<MutexGuard<'a, Connection>, String> {
    db.0.lock().map_err(|e| e.to_string())
}

const BOOK_COLS: &str =
    "id, title, author, format, file_path, cover_path, progress, added_at, last_opened_at, percent";

fn book_from_row(row: &rusqlite::Row) -> rusqlite::Result<Book> {
    let progress_raw: Option<String> = row.get(6)?;
    Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        author: row.get(2)?,
        format: row.get(3)?,
        file_path: row.get(4)?,
        cover_path: row.get(5)?,
        progress: progress_raw.and_then(|s| serde_json::from_str(&s).ok()),
        added_at: row.get(7)?,
        last_opened_at: row.get(8)?,
        percent: row.get(9)?,
    })
}

fn fetch_book(c: &Connection, id: i64) -> Result<Book, String> {
    c.query_row(
        &format!("SELECT {BOOK_COLS} FROM books WHERE id = ?1"),
        params![id],
        |r| book_from_row(r),
    )
    .map_err(|e| e.to_string())
}

// ---------- 书架 ----------

/// 导入书：解析元数据 → 入库 → 复制文件到书库目录 → 提取封面
#[tauri::command]
pub fn import_book(path: String, db: State<Db>) -> Result<Book, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("文件不存在: {path}"));
    }

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let format = match ext.as_str() {
        "epub" | "txt" => "epub", // TXT 导入时转换为合成 EPUB
        "pdf" => "pdf",
        other => return Err(format!("不支持的格式 .{other}（仅支持 EPUB / PDF / TXT）")),
    };

    let fallback_title = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名")
        .to_string();

    // generated：TXT 转换出的 EPUB 字节（直接写入书库，不再复制原文件）
    let (title, author, cover, generated) = if ext == "txt" {
        let tb = txt::parse_txt(&src).map_err(|e| format!("解析 TXT 失败: {e}"))?;
        let bytes =
            txt::build_epub(&tb.title, &tb.chapters).map_err(|e| format!("生成 EPUB 失败: {e}"))?;
        (tb.title, None, None, Some(bytes))
    } else if format == "epub" {
        let m = meta::parse_epub(&src).map_err(|e| format!("解析 EPUB 失败: {e}"))?;
        (m.title.unwrap_or(fallback_title), m.author, m.cover, None)
    } else {
        // PDF 元数据解析后续版本补充，先用文件名
        (fallback_title, None, None, None)
    };

    let c = conn(&db)?;
    c.execute(
        "INSERT INTO books (title, author, format, file_path, added_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))",
        params![title, author, format, path],
    )
    .map_err(|e| e.to_string())?;
    let id = c.last_insert_rowid();

    // 写入书库目录，应用自包含、原文件可随意移动（TXT 已是内存中的合成 EPUB）
    let dest = db::books_dir().join(format!("{id}.{format}"));
    if let Some(bytes) = &generated {
        fs::write(&dest, bytes).map_err(|e| format!("写入书库失败: {e}"))?;
    } else {
        fs::copy(&src, &dest).map_err(|e| format!("复制书籍到书库失败: {e}"))?;
    }
    c.execute(
        "UPDATE books SET file_path = ?1 WHERE id = ?2",
        params![dest.to_string_lossy(), id],
    )
    .map_err(|e| e.to_string())?;

    if let Some(bytes) = &cover {
        let cover_file = db::covers_dir().join(format!("{id}.{}", meta::image_ext(bytes)));
        if fs::write(&cover_file, bytes).is_ok() {
            c.execute(
                "UPDATE books SET cover_path = ?1 WHERE id = ?2",
                params![cover_file.to_string_lossy(), id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    fetch_book(&c, id)
}

#[tauri::command]
pub fn list_books(db: State<Db>) -> Result<Vec<Book>, String> {
    let c = conn(&db)?;
    let mut stmt = c
        .prepare(&format!(
            "SELECT {BOOK_COLS} FROM books ORDER BY datetime(last_opened_at) DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| book_from_row(r))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 打开书：更新最近阅读时间并返回最新数据（含进度）
#[tauri::command]
pub fn get_book(id: i64, db: State<Db>) -> Result<Book, String> {
    let c = conn(&db)?;
    c.execute(
        "UPDATE books SET last_opened_at = datetime('now') WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    fetch_book(&c, id)
}

#[tauri::command]
pub fn delete_book(id: i64, db: State<Db>) -> Result<(), String> {
    let c = conn(&db)?;
    let (file_path, cover_path): (Option<String>, Option<String>) = c
        .query_row(
            "SELECT file_path, cover_path FROM books WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // 外键级联删除书签与笔记
    c.execute("DELETE FROM books WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    // 只清理书库目录内的文件，避免误删用户原文件
    let root = db::data_dir();
    for p in [file_path, cover_path].into_iter().flatten() {
        let pb = PathBuf::from(&p);
        if pb.starts_with(&root) {
            let _ = fs::remove_file(pb);
        }
    }
    Ok(())
}

// ---------- 进度 ----------

#[tauri::command]
pub fn save_progress(book_id: i64, progress: serde_json::Value, db: State<Db>) -> Result<(), String> {
    let c = conn(&db)?;
    c.execute(
        "UPDATE books SET progress = ?1, last_opened_at = datetime('now') WHERE id = ?2",
        params![progress.to_string(), book_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 书签 ----------

fn bookmark_from_row(row: &rusqlite::Row) -> rusqlite::Result<Bookmark> {
    Ok(Bookmark {
        id: row.get(0)?,
        book_id: row.get(1)?,
        locator: row.get(2)?,
        chapter_title: row.get(3)?,
        excerpt: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn fetch_bookmark(c: &Connection, id: i64) -> Result<Bookmark, String> {
    c.query_row(
        "SELECT id, book_id, locator, chapter_title, excerpt, created_at FROM bookmarks WHERE id = ?1",
        params![id],
        |r| bookmark_from_row(r),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_bookmark(
    book_id: i64,
    locator: String,
    chapter_title: Option<String>,
    excerpt: Option<String>,
    db: State<Db>,
) -> Result<Bookmark, String> {
    let c = conn(&db)?;
    c.execute(
        "INSERT INTO bookmarks (book_id, locator, chapter_title, excerpt, created_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        params![book_id, locator, chapter_title, excerpt],
    )
    .map_err(|e| e.to_string())?;
    fetch_bookmark(&c, c.last_insert_rowid())
}

#[tauri::command]
pub fn list_bookmarks(book_id: i64, db: State<Db>) -> Result<Vec<Bookmark>, String> {
    let c = conn(&db)?;
    fetch_bookmarks(&c, book_id)
}

#[tauri::command]
pub fn delete_bookmark(id: i64, db: State<Db>) -> Result<(), String> {
    let c = conn(&db)?;
    c.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 笔记 ----------

fn note_from_row(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        book_id: row.get(1)?,
        locator: row.get(2)?,
        chapter_title: row.get(3)?,
        quote: row.get(4)?,
        content: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn fetch_note(c: &Connection, id: i64) -> Result<Note, String> {
    c.query_row(
        "SELECT id, book_id, locator, chapter_title, quote, content, created_at, updated_at
         FROM notes WHERE id = ?1",
        params![id],
        |r| note_from_row(r),
    )
    .map_err(|e| e.to_string())
}

/// 新建（id 为 null）或更新笔记
#[tauri::command]
pub fn save_note(note: NoteInput, db: State<Db>) -> Result<Note, String> {
    let c = conn(&db)?;
    let id = match note.id {
        Some(id) => {
            c.execute(
                "UPDATE notes SET locator = ?1, chapter_title = ?2, quote = ?3, content = ?4,
                 updated_at = datetime('now') WHERE id = ?5 AND book_id = ?6",
                params![note.locator, note.chapter_title, note.quote, note.content, id, note.book_id],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            c.execute(
                "INSERT INTO notes (book_id, locator, chapter_title, quote, content, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))",
                params![note.book_id, note.locator, note.chapter_title, note.quote, note.content],
            )
            .map_err(|e| e.to_string())?;
            c.last_insert_rowid()
        }
    };
    fetch_note(&c, id)
}

#[tauri::command]
pub fn list_notes(book_id: i64, db: State<Db>) -> Result<Vec<Note>, String> {
    let c = conn(&db)?;
    fetch_notes(&c, book_id)
}

#[tauri::command]
pub fn delete_note(id: i64, db: State<Db>) -> Result<(), String> {
    let c = conn(&db)?;
    c.execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn fetch_bookmarks(c: &Connection, book_id: i64) -> Result<Vec<Bookmark>, String> {
    let mut stmt = c
        .prepare(
            "SELECT id, book_id, locator, chapter_title, excerpt, created_at
             FROM bookmarks WHERE book_id = ?1 ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |r| bookmark_from_row(r))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn fetch_notes(c: &Connection, book_id: i64) -> Result<Vec<Note>, String> {
    let mut stmt = c
        .prepare(
            "SELECT id, book_id, locator, chapter_title, quote, content, created_at, updated_at
             FROM notes WHERE book_id = ?1 ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |r| note_from_row(r))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 导出书籍的全部书签与笔记为 Markdown 文件
#[tauri::command]
pub fn export_book_md(book_id: i64, path: String, db: State<Db>) -> Result<(), String> {
    let c = conn(&db)?;
    let book = fetch_book(&c, book_id)?;
    let bookmarks = fetch_bookmarks(&c, book_id)?;
    let notes = fetch_notes(&c, book_id)?;
    let now: String = c
        .query_row("SELECT datetime('now')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let mut md = format!("# {}\n\n", book.title);
    if let Some(a) = &book.author {
        md.push_str(&format!("**作者**：{a}\n\n"));
    }
    md.push_str(&format!("**导出时间**：{now}\n\n"));

    if !bookmarks.is_empty() {
        md.push_str("## 书签\n\n");
        for b in &bookmarks {
            md.push_str(&format!(
                "- **{}**　{}\n",
                b.chapter_title.as_deref().unwrap_or("未命名位置"),
                b.excerpt.as_deref().unwrap_or("")
            ));
            md.push_str(&format!("  *{}*\n", b.created_at));
        }
        md.push('\n');
    }

    if !notes.is_empty() {
        md.push_str("## 笔记\n\n");
        for n in &notes {
            md.push_str(&format!(
                "### {}\n\n",
                n.chapter_title.as_deref().unwrap_or("未命名章节")
            ));
            if let Some(q) = &n.quote {
                md.push_str(&format!("> {}\n\n", q));
            }
            md.push_str(&format!("{}\n\n", n.content));
            md.push_str(&format!("*{}*\n\n", n.updated_at));
        }
    }

    if bookmarks.is_empty() && notes.is_empty() {
        md.push_str("（本书还没有书签和笔记）\n");
    }

    fs::write(&path, md.as_bytes()).map_err(|e| format!("写入文件失败: {e}"))
}

// ---------- 阅读统计 ----------

/// 记录一段阅读：聚合到当天（本地时区），同时刷新书架进度百分比
#[tauri::command]
pub fn record_reading(
    book_id: i64,
    seconds: i64,
    pages: i64,
    percent: Option<f64>,
    db: State<Db>,
) -> Result<(), String> {
    let c = conn(&db)?;
    c.execute(
        "INSERT INTO reading_stats (book_id, day, seconds, pages)
         VALUES (?1, date('now', 'localtime'), ?2, ?3)
         ON CONFLICT(book_id, day) DO UPDATE SET
            seconds = seconds + excluded.seconds,
            pages = pages + excluded.pages",
        params![book_id, seconds.max(0), pages.max(0)],
    )
    .map_err(|e| e.to_string())?;
    if let Some(p) = percent {
        c.execute(
            "UPDATE books SET percent = ?1 WHERE id = ?2",
            params![p.clamp(0.0, 1.0), book_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 书架用：每本书的累计时长/翻页/连续打卡天数
#[tauri::command]
pub fn list_reading_stats(db: State<Db>) -> Result<Vec<ReadingStat>, String> {
    let c = conn(&db)?;
    let (today, yesterday): (String, String) = c
        .query_row(
            "SELECT date('now','localtime'), date('now','localtime','-1 day')",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = c
        .prepare(
            "SELECT book_id, COALESCE(SUM(seconds),0), COALESCE(SUM(pages),0)
             FROM reading_stats GROUP BY book_id",
        )
        .map_err(|e| e.to_string())?;
    let totals: Vec<(i64, i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    // 每本书有阅读记录的日期（倒序），用于连续打卡计算
    let mut stmt = c
        .prepare(
            "SELECT book_id, day FROM reading_stats WHERE seconds > 0 ORDER BY book_id, day DESC",
        )
        .map_err(|e| e.to_string())?;
    let pairs: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let mut days_by_book: std::collections::HashMap<i64, Vec<String>> =
        std::collections::HashMap::new();
    for (book_id, day) in pairs {
        days_by_book.entry(book_id).or_default().push(day);
    }

    Ok(totals
        .into_iter()
        .map(|(book_id, total_seconds, total_pages)| ReadingStat {
            book_id,
            total_seconds,
            total_pages,
            streak_days: days_by_book
                .get(&book_id)
                .map(|d| streak_of(d, &today, &yesterday))
                .unwrap_or(0),
        })
        .collect())
}

/// 连续打卡：从今天（今天还没读则从昨天）往前数连续有阅读的天数
fn streak_of(days_desc: &[String], today: &str, yesterday: &str) -> i64 {
    let first = days_desc.first().map(String::as_str);
    let mut anchor: String = if first == Some(today) {
        today.to_string()
    } else if first == Some(yesterday) {
        yesterday.to_string()
    } else {
        return 0;
    };
    let mut count = 0i64;
    for d in days_desc {
        if d == &anchor {
            count += 1;
            anchor = prev_day(&anchor);
        } else if d.as_str() < anchor.as_str() {
            break; // 出现断档
        }
    }
    count
}

/// 'YYYY-MM-DD' 的前一天（避免引入 chrono 的简化历法换算）
fn prev_day(day: &str) -> String {
    let mut it = day.split('-');
    let y = it.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(1970);
    let m = it.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(1);
    if d > 1 {
        let d = d - 1;
        return format!("{y:04}-{m:02}-{d:02}");
    }
    let (py, pm) = if m == 1 { (y - 1, 12) } else { (y, m - 1) };
    let last = match pm {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            let leap = (py % 4 == 0 && py % 100 != 0) || py % 400 == 0;
            if leap {
                29
            } else {
                28
            }
        }
    };
    format!("{py:04}-{pm:02}-{last:02}")
}

// ---------- 复习闪卡（SM-2 lite） ----------

fn review_card_from_row(row: &rusqlite::Row) -> rusqlite::Result<ReviewCard> {
    let due_at: String = row.get(8)?;
    Ok(ReviewCard {
        note: note_from_row(row)?,
        is_new: due_at.is_empty(),
        due_at,
        interval_minutes: row.get(9)?,
        ease: row.get(10)?,
        reps: row.get(11)?,
        lapses: row.get(12)?,
    })
}

/// 列出可复习的卡片（有引用且有笔记内容的笔记）；到期在前，新卡在后
#[tauri::command]
pub fn list_review_cards(book_id: i64, db: State<Db>) -> Result<Vec<ReviewCard>, String> {
    let c = conn(&db)?;
    let mut stmt = c
        .prepare(
            "SELECT n.id, n.book_id, n.locator, n.chapter_title, n.quote, n.content, n.created_at, n.updated_at,
                    COALESCE(r.due_at, ''), COALESCE(r.interval_minutes, 0.0), COALESCE(r.ease, 2.5),
                    COALESCE(r.reps, 0), COALESCE(r.lapses, 0)
             FROM notes n LEFT JOIN review_state r ON r.note_id = n.id
             WHERE n.book_id = ?1 AND n.quote IS NOT NULL AND n.quote != '' AND n.content != ''
             ORDER BY (r.note_id IS NULL) ASC, r.due_at ASC, n.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |r| review_card_from_row(r))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 复习评分：0=不会 / 1=模糊 / 2=会，更新间隔重复状态
#[tauri::command]
pub fn review_note(note_id: i64, result: u8, db: State<Db>) -> Result<(), String> {
    if result > 2 {
        return Err("result 必须是 0(不会)/1(模糊)/2(会)".into());
    }
    let c = conn(&db)?;
    let (_due, interval, mut ease, mut reps, mut lapses): (String, f64, f64, i64, i64) = c
        .query_row(
            "SELECT COALESCE(r.due_at, ''), COALESCE(r.interval_minutes, 0.0), COALESCE(r.ease, 2.5),
                    COALESCE(r.reps, 0), COALESCE(r.lapses, 0)
             FROM notes n LEFT JOIN review_state r ON r.note_id = n.id WHERE n.id = ?1",
            params![note_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| e.to_string())?;

    // SM-2 lite：不会→10分钟后重现；模糊→间隔*1.2；会→间隔*ease（首次 1 天），上限 180 天
    let new_interval = match result {
        0 => {
            ease = (ease - 0.2).max(1.3);
            lapses += 1;
            reps = 0;
            10.0
        }
        1 => {
            ease = (ease - 0.15).max(1.3);
            reps += 1;
            (interval.max(60.0) * 1.2).min(43_200.0)
        }
        _ => {
            ease = (ease + 0.1).min(3.0);
            reps += 1;
            if interval < 60.0 {
                1440.0
            } else {
                (interval * ease).min(259_200.0)
            }
        }
    };

    c.execute(
        "INSERT INTO review_state (note_id, due_at, interval_minutes, ease, reps, lapses)
         VALUES (?1, datetime('now', '+' || CAST(?2 AS INTEGER) || ' minutes'), ?2, ?3, ?4, ?5)
         ON CONFLICT(note_id) DO UPDATE SET
            due_at = excluded.due_at, interval_minutes = excluded.interval_minutes,
            ease = excluded.ease, reps = excluded.reps, lapses = excluded.lapses",
        params![note_id, new_interval, ease, reps, lapses],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}