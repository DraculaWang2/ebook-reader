// 阻止 Windows release 构建时额外弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ebook_reader_lib::run()
}
