use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: i64,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    pub file_path: String,
    pub cover_path: Option<String>,
    /// JSON 定位：EPUB 为 {"cfi": "..."}，PDF 为 {"page": 12, "offsetY": 300}
    pub progress: Option<serde_json::Value>,
    /// 阅读进度 0~1（阅读时随统计周期性刷新，供书架进度条显示）
    pub percent: Option<f64>,
    pub added_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: i64,
    pub book_id: i64,
    pub locator: String,
    pub chapter_title: Option<String>,
    pub excerpt: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub book_id: i64,
    pub locator: String,
    pub chapter_title: Option<String>,
    pub quote: Option<String>,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 阅读统计（按书聚合）：总时长 / 总翻页 / 连续打卡天数
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStat {
    pub book_id: i64,
    pub total_seconds: i64,
    pub total_pages: i64,
    pub streak_days: i64,
}

/// save_note 命令入参（id 为 None 时新建）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub locator: String,
    pub chapter_title: Option<String>,
    pub quote: Option<String>,
    pub content: String,
}

/// 复习闪卡（笔记 + 间隔重复状态）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCard {
    pub note: Note,
    /// 空字符串 = 新卡（从未复习）
    pub due_at: String,
    pub interval_minutes: f64,
    pub ease: f64,
    pub reps: i64,
    pub lapses: i64,
    pub is_new: bool,
}