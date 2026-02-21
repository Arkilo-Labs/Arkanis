import { z } from 'zod';

export const DenyReason = Object.freeze({
    NETWORK_DISABLED: 'NETWORK_DISABLED',
    WORKSPACE_WRITE_FORBIDDEN: 'WORKSPACE_WRITE_FORBIDDEN',
    HOST_EXEC_FORBIDDEN: 'HOST_EXEC_FORBIDDEN',
    SECRETS_FORBIDDEN: 'SECRETS_FORBIDDEN',
    SKILL_NOT_WHITELISTED: 'SKILL_NOT_WHITELISTED',
});

export const DenyReasonSchema = z.enum(Object.values(DenyReason));

