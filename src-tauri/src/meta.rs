//! EPUB 元数据解析（书名 / 作者 / 封面）
//! EPUB = ZIP 包；META-INF/container.xml → OPF → metadata + manifest

use std::ffi::OsStr;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

pub struct EpubMeta {
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover: Option<Vec<u8>>,
}

/// 根据文件头判断图片扩展名
pub fn image_ext(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "jpg"
    } else {
        "png"
    }
}

pub fn parse_epub(path: &Path) -> Result<EpubMeta, Box<dyn std::error::Error>> {
    let mut zip = zip::ZipArchive::new(File::open(path)?)?;

    // 1. container.xml → OPF 路径
    let mut container = String::new();
    zip.by_name("META-INF/container.xml")?
        .read_to_string(&mut container)?;
    let doc = roxmltree::Document::parse(&container)?;
    let opf_path = doc
        .descendants()
        .find(|n| n.tag_name().name() == "rootfile")
        .and_then(|n| n.attribute("full-path"))
        .ok_or("container.xml 中找不到 rootfile")?
        .to_string();

    // 2. 解析 OPF：dc:title / dc:creator / manifest 封面
    let mut opf = String::new();
    zip.by_name(&opf_path)?.read_to_string(&mut opf)?;
    let doc = roxmltree::Document::parse(&opf)?;

    let mut title: Option<String> = None;
    let mut author: Option<String> = None;
    let mut cover_href: Option<String> = None;
    let mut cover_meta_id: Option<String> = None;
    let mut images: Vec<(String, String)> = Vec::new(); // (id, href)

    for n in doc.descendants() {
        match n.tag_name().name() {
            // local name 忽略命名空间前缀：dc:title → "title"
            "title" if title.is_none() => {
                title = n
                    .text()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
            }
            "creator" if author.is_none() => {
                author = n
                    .text()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
            }
            "meta" => {
                // EPUB2: <meta name="cover" content="cover-id" />
                if n.attribute("name") == Some("cover") {
                    cover_meta_id = n.attribute("content").map(str::to_string);
                }
            }
            "item" => {
                let id = n.attribute("id");
                let href = n.attribute("href");
                let media = n.attribute("media-type");
                if let (Some(id), Some(href), Some(media)) = (id, href, media) {
                    if media.starts_with("image/") {
                        images.push((id.to_string(), href.to_string()));
                    }
                    // EPUB3: <item properties="cover-image" />
                    if n.attribute("properties") == Some("cover-image") {
                        cover_href = Some(href.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    // 封面优先级：EPUB3 cover-image > EPUB2 meta cover > 第一张图
    let cover_href = cover_href
        .or_else(|| {
            cover_meta_id
                .as_deref()
                .and_then(|cid| images.iter().find(|(id, _)| id == cid).map(|(_, h)| h.clone()))
        })
        .or_else(|| images.first().map(|(_, h)| h.clone()));

    // 3. 读取封面（href 相对 OPF 所在目录，zip 内路径用 / 分隔）
    let cover = if let Some(href) = cover_href {
        let base = Path::new(&opf_path).parent().unwrap_or(Path::new(""));
        let full = normalize_zip_path(base, &href);
        read_zip_entry(&mut zip, &full).ok()
    } else {
        None
    };

    Ok(EpubMeta {
        title,
        author,
        cover,
    })
}

/// 拼接并规整 zip 内路径：处理 "../" 与 Windows 反斜杠
fn normalize_zip_path(base: &Path, href: &str) -> String {
    let joined = if base.as_os_str().is_empty() {
        PathBuf::from(href)
    } else {
        base.join(href)
    };
    let mut parts: Vec<&OsStr> = Vec::new();
    for c in joined.iter() {
        if c == OsStr::new("..") {
            parts.pop();
        } else if c != OsStr::new(".") {
            parts.push(c);
        }
    }
    let mut out = PathBuf::new();
    for p in parts {
        out.push(p);
    }
    out.to_string_lossy().replace('\\', "/")
}

fn read_zip_entry<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>, std::io::Error> {
    let mut f = zip
        .by_name(name)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    Ok(buf)
}
