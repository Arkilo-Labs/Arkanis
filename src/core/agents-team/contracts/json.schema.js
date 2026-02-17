import { z } from 'zod';

export const JsonValueSchema = z.lazy(() =>
    z.union([
        z.string(),
        z.number().finite(),
        z.boolean(),
        z.null(),
        z.array(JsonValueSchema),
        z.record(JsonValueSchema),
    ]),
);

