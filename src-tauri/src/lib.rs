mod commands;
mod db;
mod meta;
mod models;
mod txt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            db::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_book,
            commands::list_books,
            commands::get_book,
            commands::delete_book,
            commands::save_progress,
            commands::add_bookmark,
            commands::list_bookmarks,
            commands::delete_bookmark,
            commands::save_note,
            commands::list_notes,
            commands::delete_note,
            commands::export_book_md,
            commands::list_review_cards,
            commands::review_note,
            commands::record_reading,
            commands::list_reading_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}