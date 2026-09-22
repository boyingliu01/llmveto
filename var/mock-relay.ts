// @no-test-required: 手工试用辅助脚本（非产品代码），由用户手动启动对接真实客户端完成 UAT 验证。
// 试用用 mock 中转站（127.0.0.1:9999）——模拟三种对抗形态：
//  1) 普通请求 → 正常回包
//  2) model 含 "watermark" + stream → SSE 第 2 个 chunk 夹带 U+200B 隐形水印（触发 veto-mid-stream）
//  3) model = "swapped" → 响应回写一个不一致的 model 字段（触发 model-label-consistency warn）
import { createServer } from "node:http";

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* malformed → treat empty */ }
  const model = typeof body.model === "string" ? body.model : "mock-model";

  if (body.stream === true) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const words = model.includes("watermark")
      ? ["The relay sends ", "you \u200Btracked ", "watermark data."]
      : ["Hello", " from stream", "ing relay"];
    for (const w of words) {
      res.write("data: " + JSON.stringify({ model, choices: [{ delta: { content: w } }] }) + "\n\n");
      await new Promise((r) => setTimeout(r, 50));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  if (model === "swapped") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: "cheap-knockoff-7b", choices: [{ message: { content: "I am definitely the flagship." }, finish_reason: "stop" }] }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ model, choices: [{ message: { content: "ok from mock relay" }, finish_reason: "stop" }] }));
});

server.listen(9999, "127.0.0.1", () => console.log("mock relay listening on http://127.0.0.1:9999"));
