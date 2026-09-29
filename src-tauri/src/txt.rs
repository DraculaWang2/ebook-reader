//! TXT 支持：解析章节 + 转成合成 EPUB
//! 转成 EPUB 后，目录/书签/笔记/进度全部复用现有能力

use std::fs;
use std::io::{Cursor, Write};
use std::path::Path;

use regex::Regex;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

pub struct TxtBook {
    pub title: String,
    /// (章节标题, 章节 XHTML 正文)
    pub chapters: Vec<(String, String)>,
}

/// 读取 TXT：优先 UTF-8，失败按 GBK 解码（中文小说常见编码）
fn read_text(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    if std::str::from_utf8(&bytes).is_ok() {
        return Ok(String::from_utf8(bytes)?);
    }
    let (cow, _, _) = encoding_rs::GBK.decode(&bytes);
    Ok(cow.into_owned())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// 每行一段
fn paras(lines: &[String]) -> String {
    lines
        .iter()
        .map(|l| format!("<p>{}</p>\n", esc(l)))
        .collect()
}

/// 简单 FNV 哈希，用作 EPUB identifier
fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn parse_txt(path: &Path) -> Result<TxtBook, Box<dyn std::error::Error>> {
    let text = read_text(path)?;
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名")
        .to_string();

    // 章节标题：第X章/节/卷/回…、序章/楔子/番外/后记、Chapter N
    let re = Regex::new(
        r"^[\s]{0,6}(第[0-9零〇一二三四五六七八九十百千万两]+[章节卷回部集篇]|序章?|楔子|引子|前序|自序|后记|尾声|终章|番外|Chapter\s*\d+).*$",
    )?;

    let mut chapters: Vec<(String, String)> = Vec::new();
    let mut cur_title: Option<String> = None;
    let mut buf: Vec<String> = Vec::new();
    let mut all: Vec<String> = Vec::new();

    for line in text.lines() {
        let t = line.trim();
        all.push(t.to_string());
        if !t.is_empty() && t.chars().count() <= 40 && re.is_match(t) {
            match cur_title.take() {
                Some(prev) => chapters.push((prev, paras(&buf))),
                None if !buf.is_empty() => chapters.push(("开头".to_string(), paras(&buf))),
                None => {}
            }
            buf.clear();
            cur_title = Some(t.to_string());
        } else if !t.is_empty() {
            buf.push(t.to_string());
        }
    }
    if let Some(prev) = cur_title.take() {
        chapters.push((prev, paras(&buf)));
    }

    // 完全没有匹配到章节标题 → 整本作为单章
    if chapters.is_empty() {
        let body: Vec<String> = all.into_iter().filter(|l| !l.is_empty()).collect();
        chapters.push((title.clone(), paras(&body)));
    }

    Ok(TxtBook { title, chapters })
}

/// 生成最小 EPUB3 文件（zip 内存构建）
pub fn build_epub(
    title: &str,
    chapters: &[(String, String)],
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // EPUB 规范：mimetype 必须是第一个文件且不压缩
    w.start_file("mimetype", stored)?;
    w.write_all(b"application/epub+zip")?;

    w.start_file("META-INF/container.xml", deflate)?;
    write!(
        w,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#
    )?;

    // 目录（EPUB3 nav）
    let mut nav = String::from(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\">\n<head><meta charset=\"utf-8\"/><title>",
    );
    nav.push_str(&esc(title));
    nav.push_str("</title></head>\n<body>\n<nav epub:type=\"toc\"><h1>目录</h1>\n<ol>\n");
    for (i, (t, _)) in chapters.iter().enumerate() {
        nav.push_str(&format!(
            "<li><a href=\"ch{}.xhtml\">{}</a></li>\n",
            i + 1,
            esc(t)
        ));
    }
    nav.push_str("</ol>\n</nav>\n</body>\n</html>");
    w.start_file("OEBPS/nav.xhtml", deflate)?;
    w.write_all(nav.as_bytes())?;

    // 章节
    for (i, (t, body)) in chapters.iter().enumerate() {
        let mut x = String::from(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head><meta charset=\"utf-8\"/><title>",
        );
        x.push_str(&esc(t));
        x.push_str("</title></head>\n<body>\n<h2>");
        x.push_str(&esc(t));
        x.push_str("</h2>\n");
        x.push_str(body);
        x.push_str("</body>\n</html>");
        w.start_file(&format!("OEBPS/ch{}.xhtml", i + 1), deflate)?;
        w.write_all(x.as_bytes())?;
    }

    // OPF
    let mut opf = String::from(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"bid\">\n<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n",
    );
    opf.push_str(&format!(
        "<dc:identifier id=\"bid\">urn:ebook-reader:txt:{:x}</dc:identifier>\n",
        fnv(title)
    ));
    opf.push_str(&format!("<dc:title>{}</dc:title>\n", esc(title)));
    opf.push_str("<dc:language>zh</dc:language>\n");
    opf.push_str("<meta property=\"dcterms:modified\">2025-01-01T00:00:00Z</meta>\n");
    opf.push_str("</metadata>\n<manifest>\n");
    opf.push_str("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n");
    for i in 1..=chapters.len() {
        opf.push_str(&format!(
            "<item id=\"ch{i}\" href=\"ch{i}.xhtml\" media-type=\"application/xhtml+xml\"/>\n"
        ));
    }
    opf.push_str("</manifest>\n<spine>\n");
    for i in 1..=chapters.len() {
        opf.push_str(&format!("<itemref idref=\"ch{i}\"/>\n"));
    }
    opf.push_str("</spine>\n</package>");
    w.start_file("OEBPS/content.opf", deflate)?;
    w.write_all(opf.as_bytes())?;

    Ok(w.finish()?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn txt_to_epub_roundtrip() {
        let dir = std::env::temp_dir().join("ebook-reader-test");
        std::fs::create_dir_all(&dir).unwrap();
        let txt = dir.join("测试小说.txt");
        std::fs::write(
            &txt,
            "书名开头文字。\n\n第一章 起点\n\n正文一。\n\n第二章 转折\n\n正文二。\n",
        )
        .unwrap();

        let tb = parse_txt(&txt).unwrap();
        assert_eq!(tb.title, "测试小说");
        // 开头 + 两章
        assert_eq!(tb.chapters.len(), 3);
        assert_eq!(tb.chapters[1].0, "第一章 起点");

        // 生成 EPUB 后再用 meta 解析，验证闭环
        let bytes = build_epub(&tb.title, &tb.chapters).unwrap();
        assert!(!bytes.is_empty());
        let epub = dir.join("测试小说.epub");
        std::fs::write(&epub, &bytes).unwrap();
        let m = crate::meta::parse_epub(&epub).unwrap();
        assert_eq!(m.title.as_deref(), Some("测试小说"));
    }

    #[test]
    fn gbk_txt() {
        let dir = std::env::temp_dir().join("ebook-reader-test");
        std::fs::create_dir_all(&dir).unwrap();
        let (gbk, _, _) = encoding_rs::GBK.encode("第一章 编码测试\n\n中文内容。");
        let txt = dir.join("gbk小说.txt");
        std::fs::write(&txt, gbk.as_ref()).unwrap();
        let tb = parse_txt(&txt).unwrap();
        assert_eq!(tb.chapters.len(), 1);
        assert_eq!(tb.chapters[0].0, "第一章 编码测试");
    }
}
