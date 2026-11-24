// @no-test-required: 测试在 tests/unit/gateway/protocols/registry.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { chatProtocol } from "./chat.ts";
import { anthropicMessagesProtocol } from "./anthropic.ts";
import { responsesProtocol } from "./responses.ts";
import type { WireFormat, WireProtocol } from "./types.ts";

/**
 * 已实装投影器的协议表。
 *
 * 为什么独立成模块：它一度写在 registry.ts 里，而 registry 又被 scan-unit 引用、
 * scan-unit 又被 core 引用，形成 `registry → chat → scan-unit → registry` 的环。
 * 环本身不报错，但**运行期解析到的是空表**——识别成功、查表失败，
 * 于是每条正常请求都被判成"没有投影器"而阻断。把它拆出来后依赖变成单向：
 * table → 各协议 → (types)，registry → table。
 */
export const PROTOCOL_TABLE: ReadonlyMap<WireFormat, WireProtocol> = new Map<WireFormat, WireProtocol>([
  ["chat", chatProtocol],
  ["anthropic-messages", anthropicMessagesProtocol],
  ["openai-responses", responsesProtocol],
]);

/** 取某个线格式的协议实现；未实装返回 undefined。 */
export function protocolFor(format: WireFormat): WireProtocol | undefined {
  return PROTOCOL_TABLE.get(format);
}
