use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

/// 全局共享的 SQLite 连接（单线程锁保护）
pub struct Db(pub Mutex<Connection>);

pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ebook-reader")
}

pub fn books_dir() -> PathBuf {
    data_dir().join("books")
}

pub fn covers_dir() -> PathBuf {
    data_dir().join("covers")
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(books_dir())?;
    fs::create_dir_all(covers_dir())?;

    let conn = Connection::open(data_dir().join("library.db"))?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS books (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT NOT NULL,
            author          TEXT,
            format          TEXT NOT NULL,          -- 'epub' | 'pdf'
            file_path       TEXT NOT NULL,
            cover_path      TEXT,
            progress        TEXT,                   -- JSON 定位信息
            added_at        TEXT NOT NULL,
            last_opened_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id       INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            locator       TEXT NOT NULL,            -- epubcfi 或页码 JSON
            chapter_title TEXT,
            excerpt       TEXT,
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id       INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            locator       TEXT NOT NULL,
            chapter_title TEXT,
            quote         TEXT,                     -- 选中的原文引用
            content       TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
        CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id);

        -- M7 阅读统计：按 书 × 本地日期 聚合（时长秒数 + 翻页数）
        CREATE TABLE IF NOT EXISTS reading_stats (
            book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            day      TEXT NOT NULL,             -- 'YYYY-MM-DD'（本地时区）
            seconds  INTEGER NOT NULL DEFAULT 0,
            pages    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (book_id, day)
        );

        CREATE TABLE IF NOT EXISTS review_state (
            note_id          INTEGER PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
            due_at           TEXT NOT NULL,          -- 到期时间（SQLite datetime）
            interval_minutes REAL NOT NULL DEFAULT 0,
            ease             REAL NOT NULL DEFAULT 2.5,
            reps             INTEGER NOT NULL DEFAULT 0,
            lapses           INTEGER NOT NULL DEFAULT 0
        );
        ",
    )?;

    // 早期版本无 percent 列：缺列时补上（已存在则忽略 duplicate 错误）
    if let Err(e) = conn.execute("ALTER TABLE books ADD COLUMN percent REAL", []) {
        if !e.to_string().contains("duplicate column name") {
            return Err(e.into());
        }
    }

    app.manage(Db(Mutex::new(conn)));
    Ok(())
}