import { readFile, readdir } from 'node:fs/promises';

import { createRunPaths } from '../../outputs/runPaths.js';
import { MessageSchema, MessageDeliveryStatusSchema } from '../../contracts/message.schema.js';
import { ErrorCode } from '../../contracts/errors.js';
import { atomicWriteJson } from '../atomicWrite.js';
import { makeError } from '../errors.util.js';

/**
 * @param {{ outputDir?: string, cwd?: string }} [opts]
 * @returns {{ readMessage, writeMessage, listMessages }}
 */
export function createMailboxStore({ outputDir, cwd } = {}) {
    function runPaths(runId) {
        return createRunPaths({ outputDir, runId, cwd });
    }

    async function readMessage(runId, msgId) {
        const rp = runPaths(runId);
        const filePath = rp.messagePath(msgId);
        let raw;
        try {
            raw = await readFile(filePath, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') {
                throw makeError(ErrorCode.ERR_MESSAGE_NOT_FOUND, `消息不存在: ${msgId}`, {
                    runId,
                    msgId,
                });
            }
            throw err;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                `消息文件 JSON 解析失败: ${msgId}`,
                { runId, msgId, filePath },
            );
        }

        // 合并 ack 状态（P7 写入 .ack.json，保持消息体不可变）
        const ackPath = rp.messageAckPath(msgId);
        try {
            const ackRaw = await readFile(ackPath, 'utf-8');
            const ack = JSON.parse(ackRaw);
            if (ack.delivery_status !== undefined) {
                parsed.delivery_status = ack.delivery_status;
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw makeError(
                    ErrorCode.ERR_INVALID_ARGUMENT,
                    `ack 文件损坏: ${msgId}`,
                    { runId, msgId, ackPath },
                );
            }
        }

        const result = MessageSchema.safeParse(parsed);
        if (!result.success) {
            throw makeError(ErrorCode.ERR_INVALID_ARGUMENT, `消息 schema 校验失败: ${msgId}`, {
                runId,
                msgId,
                filePath,
                issues: result.error.issues,
            });
        }
        return result.data;
    }

    async function writeMessage(runId, msg) {
        const result = MessageSchema.safeParse(msg);
        if (!result.success) {
            throw makeError(ErrorCode.ERR_INVALID_ARGUMENT, '消息数据 schema 校验失败', {
                issues: result.error.issues,
            });
        }
        const rp = runPaths(runId);
        await atomicWriteJson(rp.messagePath(result.data.msg_id), result.data);
    }

    /**
     * @param {string} runId
     * @param {{ type?: string, from_agent?: string, task_refs?: string[] }} [filter]
     */
    async function listMessages(runId, filter = {}) {
        const rp = runPaths(runId);
        let entries;
        try {
            entries = await readdir(rp.mailboxDir);
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }

        // 只读主消息文件，排除 .ack.json 和含 .tmp 的临时文件
        const jsonFiles = entries.filter(
            (f) => f.endsWith('.json') && !f.endsWith('.ack.json') && !f.includes('.tmp'),
        );

        const messages = [];
        for (const file of jsonFiles) {
            const msgId = file.slice(0, -5);
            let msg;
            try {
                msg = await readMessage(runId, msgId);
            } catch (err) {
                if (err.code === ErrorCode.ERR_MESSAGE_NOT_FOUND) continue;
                throw err;
            }
            if (filter.type !== undefined && msg.type !== filter.type) continue;
            if (filter.from_agent !== undefined && msg.from_agent !== filter.from_agent) continue;
            if (
                filter.task_refs !== undefined &&
                !filter.task_refs.some((ref) => msg.task_refs.includes(ref))
            )
                continue;
            messages.push(msg);
        }
        return messages;
    }

    /**
     * @param {string} runId
     * @param {string} msgId
     * @param {{ delivery_status: string, acknowledged_by?: string }} opts
     */
    async function writeAck(runId, msgId, { delivery_status, acknowledged_by }) {
        const parseResult = MessageDeliveryStatusSchema.safeParse(delivery_status);
        if (!parseResult.success) {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                `delivery_status 无效: ${delivery_status}`,
                { runId, msgId },
            );
        }
        const rp = runPaths(runId);
        const ackData = { delivery_status: parseResult.data };
        if (acknowledged_by !== undefined) ackData.acknowledged_by = acknowledged_by;
        await atomicWriteJson(rp.messageAckPath(msgId), ackData);
    }

    return { readMessage, writeMessage, listMessages, writeAck };
}
