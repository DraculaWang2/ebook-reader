// 生成 1024x1024 应用图标 PNG（纯 Node，无依赖）
// 之后用 `tauri icon scripts/icon.png` 生成全平台图标
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024; // 尺寸
const u = S / 512; // 坐标按 512 设计稿缩放
const px = Buffer.alloc(S * S * 4);

const set = (x, y, [r, g, b], a = 255) => {
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
};

// 背景：靛蓝 → 紫渐变
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const t = (x + y) / (S * 2);
    set(x, y, [
      Math.round(79 + 45 * t),
      Math.round(70 - 12 * t),
      Math.round(229 + 8 * t),
    ]);
  }
}

function roundedRect(x, y, x2, y2, rad, col) {
  x *= u; y *= u; x2 *= u; y2 *= u; rad *= u;
  for (let yy = Math.floor(y); yy < y2; yy++) {
    for (let xx = Math.floor(x); xx < x2; xx++) {
      const dx = xx < x + rad ? x + rad - xx : xx > x2 - rad ? xx - (x2 - rad) : 0;
      const dy = yy < y + rad ? y + rad - yy : yy > y2 - rad ? yy - (y2 - rad) : 0;
      if (dx * dx + dy * dy <= rad * rad) set(xx, yy, col);
    }
  }
}

// 打开的书（白色）
roundedRect(140, 156, 372, 356, 18, [255, 255, 255]);
// 书脊
roundedRect(253, 170, 259, 342, 3, [99, 86, 231]);
// 琥珀色书签
roundedRect(296, 118, 324, 196, 8, [245, 158, 11]);
roundedRect(296, 180, 324, 196, 8, [217, 119, 6]);
// 左右两页的文字行
for (const y of [206, 234, 262, 290]) {
  roundedRect(162, y, 242, y + 10, 5, [203, 205, 230]);
  roundedRect(270, y, 350, y + 10, 5, [203, 205, 230]);
}

// ---- PNG 编码（RGBA8，filter 0） ----
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
  return Buffer.concat([len, typeB, data, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const stride = S * 4 + 1;
const raw = Buffer.alloc(stride * S);
for (let y = 0; y < S; y++) {
  raw[y * stride] = 0; // filter: none
  px.copy(raw, y * stride + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("./icon.png", import.meta.url), png);
console.log(`icon.png 已生成 (${S}x${S}, ${png.length} bytes)`);
