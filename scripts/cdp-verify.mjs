// CDP 终验：canvas 像素采样 + 文本层状态
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  return r.result?.result?.value ?? `⚠️ ${r.result?.exceptionDetails?.exception?.description?.slice(0,200) ?? "err"}`;
};
await send("Runtime.enable");

console.log("== Canvas 内容采样 ==");
console.log(await evaluate(`(() => {
  const c = document.querySelector('.pdf-canvas');
  if (!c) return '无 canvas';
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let dark = 0, total = 0;
  for (let i = 0; i < d.length; i += 400) {
    total++;
    const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    if (lum < 200) dark++;
  }
  return 'canvas ' + c.width + 'x' + c.height + '，抽样 ' + total + ' 点，非白像素 ' + (dark / total * 100).toFixed(1) + '%';
})()`));

console.log("\n== 文本层 ==");
console.log(await evaluate(`(() => {
  const tl = document.querySelector('.textLayer');
  if (!tl) return '无文本层';
  const span = tl.querySelector('span');
  const fs = span ? getComputedStyle(span).fontSize : '无span';
  return 'span数=' + tl.querySelectorAll('span').length +
    ' 容器w/h=' + getComputedStyle(tl).width + '/' + getComputedStyle(tl).height +
    ' 首span字号=' + fs;
})()`));

console.log("\n== 页面可见性 ==");
console.log(await evaluate(`(() => {
  const c = document.querySelector('.pdf-canvas');
  if (!c) return '无';
  const r = c.getBoundingClientRect();
  const s = document.querySelector('.pdf-scroll').getBoundingClientRect();
  return 'canvas位置 top=' + Math.round(r.top) + ' 视口 top=' + Math.round(s.top) + '，在可视区域内=' + (r.bottom > s.top && r.top < s.bottom);
})()`));

ws.close();
process.exit(0);
