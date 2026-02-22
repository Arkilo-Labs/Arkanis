import { randomUUID } from 'node:crypto';

import { createMailboxStore } from './mailboxStore.js';
import { MessageType, MessageDeliveryStatus } from '../../contracts/message.schema.js';
import { ErrorCode } from '../../contracts/errors.js';
import { makeError } from '../errors.util.js';

const MAX_ESCALATIONS = 3;
// 升级消息 summary 最多摘录最近 N 条 conflict，防止 content 无限膨胀
const SUMMARY_LIMIT = 3;
const MAILBOX_SYSTEM_AGENT = 'mailbox_system';
const LEAD_AGENT = 'lead';

function enforceBusinessRules(msg) {
    if (msg.type === MessageType.ARTIFACT) {
        if (!msg.artifact_refs || msg.artifact_refs.length === 0) {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                'artifact 类型消息必须包含非空 artifact_refs',
                { type: msg.type },
            );
        }
    }
    if (msg.type === MessageType.CONFLICT) {
        if (!msg.claims || msg.claims.length === 0) {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                'conflict 类型消息必须包含非空 claims',
                { type: msg.type },
            );
        }
    }
}

/**
 * @param {{ outputDir?: string, cwd?: string, now?: () => Date }} [opts]
 */
export function createMailbox({ outputDir, cwd, now = () => new Date() } = {}) {
    const store = createMailboxStore({ outputDir, cwd });

    function buildEscalationMsg(runId, taskId, allConflicts) {
        const allClaims = allConflicts.flatMap((m) => m.claims ?? []);
        const recent = allConflicts.slice(-SUMMARY_LIMIT);
        const omitted = allConflicts.length - recent.length;
        const parts = recent.map((m) => `[${m.msg_id}] ${m.content.slice(0, 60)}`);
        if (omitted > 0) parts.unshift(`(${omitted} 条更早省略)`);
        const summary = parts.join('; ');

        const msg = {
            msg_id: randomUUID(),
            run_id: runId,
            task_refs: [taskId],
            type: MessageType.QUESTION,
            from_agent: MAILBOX_SYSTEM_AGENT,
            to_agent: LEAD_AGENT,
            content: `冲突升级: task ${taskId} 已出现 ${allConflicts.length} 次 conflict 且无新证据。${summary}`,
            delivery_status: MessageDeliveryStatus.SENT,
            escalation: true,
            created_at: now().toISOString(),
        };
        if (allClaims.length > 0) msg.claims = allClaims;
        return msg;
    }

    // postMessage 写入 conflict 后触发：判断是否需要向 Lead 升级
    async function checkAndEscalate(runId, conflictMsg) {
        for (const taskId of conflictMsg.task_refs) {
            const allConflicts = await store.listMessages(runId, {
                type: MessageType.CONFLICT,
                task_refs: [taskId],
            });
            if (allConflicts.length < 2) continue;

            // 当前 conflict 是否引入历史并集之外的新 artifact
            const priorConflicts = allConflicts.filter((m) => m.msg_id !== conflictMsg.msg_id);
            const priorArtifactIds = new Set(
                priorConflicts.flatMap((m) => (m.artifact_refs ?? []).map((r) => r.artifact_id)),
            );
            const hasNewEvidence = (conflictMsg.artifact_refs ?? []).some(
                (r) => !priorArtifactIds.has(r.artifact_id),
            );
            if (hasNewEvidence) continue;

            // 升级次数上限
            const allQuestions = await store.listMessages(runId, {
                type: MessageType.QUESTION,
                task_refs: [taskId],
            });
            const escalationCount = allQuestions.filter((m) => m.escalation === true).length;
            if (escalationCount >= MAX_ESCALATIONS) continue;

            const escalationMsg = buildEscalationMsg(runId, taskId, allConflicts);
            await store.writeMessage(runId, escalationMsg);
        }
    }

    /**
     * 投递消息。自动生成 msg_id / run_id / delivery_status / created_at。
     * artifact 类型要求非空 artifact_refs；conflict 类型要求非空 claims。
     *
     * @param {string} runId
     * @param {{ task_refs: string[], type: string, from_agent: string, content: string, to_agent?: string, claims?: object[], artifact_refs?: object[], escalation?: boolean }} msgInput
     * @returns {Promise<string>} msg_id
     */
    async function postMessage(runId, msgInput) {
        const msg = {
            ...msgInput,
            msg_id: randomUUID(),
            run_id: runId,
            delivery_status: MessageDeliveryStatus.SENT,
            created_at: now().toISOString(),
        };

        enforceBusinessRules(msg);
        await store.writeMessage(runId, msg);

        if (msg.type === MessageType.CONFLICT) {
            await checkAndEscalate(runId, msg);
        }

        return msg.msg_id;
    }

    /**
     * 查询消息列表，支持按 type / from_agent / task_refs 过滤。
     *
     * @param {string} runId
     * @param {{ type?: string, from_agent?: string, task_refs?: string[] }} [filter]
     */
    async function getMessages(runId, filter = {}) {
        return store.listMessages(runId, filter);
    }

    /**
     * 确认消息已读（delivery_status → acknowledged）。
     * ack 单独写入 .ack.json，原始消息体不可变。
     *
     * @param {string} runId
     * @param {string} msgId
     * @param {string} agentId
     */
    async function acknowledgeMessage(runId, msgId, agentId) {
        await store.readMessage(runId, msgId);
        await store.writeAck(runId, msgId, {
            delivery_status: MessageDeliveryStatus.ACKNOWLEDGED,
            acknowledged_by: agentId,
        });
    }

    return { postMessage, getMessages, acknowledgeMessage };
}
