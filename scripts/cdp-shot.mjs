// CDP 截图：自动摆好界面姿势，连续拍摄产品效果图
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
mkdirSync(OUT, { recursive: true });

const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? "";
};
await send("Page.enable");

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
  console.log("📸 已保存", name);
};

// ---- 1. 书架 ----
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('书架')); if (b) b.click(); return 1; })()`);
await sleep(1800);
await shot("01-书架.png");

// ---- 2. 阅读器（PDF 正文）----
await evaluate(`(() => { const cards = [...document.querySelectorAll('.book-card')]; const pdf = cards.find(c => c.textContent.toUpperCase().includes('PDF')); if (pdf) pdf.querySelector('.primary').click(); return 1; })()`);
await sleep(6000);
// 滚到一处有内容的位置再拍
await evaluate(`document.querySelector('.pdf-scroll')?.scrollBy({ top: 200 })`);
await sleep(2500);
await shot("02-阅读器.png");

// ---- 3. 加书签 + 打开书签侧栏 ----
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))`);
await sleep(1200);
await evaluate(`(() => { const b = [...document.querySelectorAll('.reader-toolbar button')].find(x => x.textContent.includes('书签')); if (b) b.click(); return 1; })()`);
await sleep(1000);
await shot("03-书签侧栏.png");

ws.close();
process.exit(0);
