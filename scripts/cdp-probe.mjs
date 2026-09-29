// CDP 探针 v2：完整复现 书架→阅读 循环，验证 PDF 渲染
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page");
if (!page) {
  console.log("未找到页面 target");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.consoleAPICalled") {
    const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (!args.includes("[vite]") && !args.includes("React DevTools")) logs.push(`[${msg.params.type}] ${args}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${d.text} ${d.exception?.description ?? ""}`);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return `⚠️ ${r.result.exceptionDetails.exception?.description?.slice(0, 300) ?? r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};

await send("Runtime.enable");
logs.length = 0;

const state = async () => ({
  pages: await evaluate(`document.querySelectorAll('.pdf-page').length`),
  canvases: await evaluate(`document.querySelectorAll('.pdf-canvas').length`),
  firstCanvasSize: await evaluate(`(() => { const c = document.querySelector('.pdf-canvas'); return c ? c.width + 'x' + c.height : '无'; })()`),
});

console.log("== 当前状态（HMR 修复后）==");
console.log(await state());

console.log("\n== 返回书架，重新进入阅读（复现首次挂载）==");
console.log(await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('书架')); if (!b) return '没找到返回按钮'; b.click(); return '已返回书架'; })()`));
await sleep(1500);
console.log(await evaluate(`(() => { const cards = [...document.querySelectorAll('.book-card')]; const pdf = cards.find(c => c.textContent.toUpperCase().includes('PDF')); if (!pdf) return 'PDF卡片未找到 cards=' + cards.length; pdf.querySelector('.primary').click(); return '已点击阅读'; })()`));
await sleep(8000);

console.log("\n== 重新进入后的状态 ==");
console.log(await state());
console.log("章节:", await evaluate(`document.querySelector('.chapter-name')?.textContent ?? '无'`));

await sleep(1000);
console.log("\n== 本轮 Console（过滤 vite/React）==");
logs.slice(-25).forEach((l) => console.log(l));

ws.close();
process.exit(0);
