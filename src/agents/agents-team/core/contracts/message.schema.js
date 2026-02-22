import { z } from 'zod';

import { ArtifactRefSchema, RunIdSchema, SafeSegmentSchema } from './audit.schema.js';

export const MessageType = Object.freeze({
    UPDATE: 'update',
    ARTIFACT: 'artifact',
    QUESTION: 'question',
    CONFLICT: 'conflict',
    DECISION: 'decision',
    RISK: 'risk',
});

export const MessageTypeSchema = z.enum(Object.values(MessageType));

export const MessageDeliveryStatus = Object.freeze({
    SENT: 'sent',
    DELIVERED: 'delivered',
    ACKNOWLEDGED: 'acknowledged',
});

export const MessageDeliveryStatusSchema = z.enum(Object.values(MessageDeliveryStatus));

// 单个声明条目，evidence 为工件路径或 artifact_id#Lxx 格式
export const ClaimSchema = z
    .object({
        claim: z.string().min(1),
        evidence: z.array(z.string().min(1)),
    })
    .strict();

export const MessageSchema = z
    .object({
        msg_id: SafeSegmentSchema,
        run_id: RunIdSchema,
        task_refs: z.array(z.string().min(1)).min(1),
        type: MessageTypeSchema,
        from_agent: z.string().min(1),
        to_agent: z.string().min(1).optional(),
        content: z.string().min(1),
        claims: z.array(ClaimSchema).optional(),
        artifact_refs: z.array(ArtifactRefSchema).optional(),
        delivery_status: MessageDeliveryStatusSchema,
        escalation: z.boolean().optional(),
        created_at: z.string().datetime(),
    })
    .strict();
