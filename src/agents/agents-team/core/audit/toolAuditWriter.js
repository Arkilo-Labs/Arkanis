import { appendJsonlLine } from '../../../../core/utils/jsonlWriter.js';

/**
 * 写 tool_calls.jsonl 单行审计记录（deny 也写，ok=false）。
 *
 * @param {string} toolCallsJsonlPath  绝对路径，由 runPaths.toolCallsJsonlPath 提供
 * @param {object} record  AuditToolCallRecord
 */
export async function writeToolCallRecord(toolCallsJsonlPath, record) {
    await appendJsonlLine(toolCallsJsonlPath, record);
}
