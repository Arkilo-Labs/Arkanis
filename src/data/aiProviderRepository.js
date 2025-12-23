const remarkSupportCache = { value: null, checkedAt: 0 };
const REMARK_CACHE_TTL_MS = 60_000;

async function supportsProviderRemarkColumn(client) {
    const now = Date.now();
    if (remarkSupportCache.value !== null && now - remarkSupportCache.checkedAt < REMARK_CACHE_TTL_MS) {
        return remarkSupportCache.value;
    }

    try {
        const res = await client.query(
            `
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'ai_provider_definitions'
                AND column_name = 'remark'
              LIMIT 1
            `
        );
        remarkSupportCache.value = res.rowCount > 0;
        remarkSupportCache.checkedAt = now;
        return remarkSupportCache.value;
    } catch {
        remarkSupportCache.value = false;
        remarkSupportCache.checkedAt = now;
        return false;
    }
}

function providerDefinitionSelectFields({ withRemark }) {
    return [
        'id',
        'code',
        'display_name',
        withRemark ? 'remark' : 'NULL::text AS remark',
        'base_url',
        'model_name',
        'thinking_mode',
        'max_tokens',
        'temperature_x100',
        'multiplier_x100',
        'is_active',
        'created_at',
        'updated_at',
    ].join(', ');
}

export async function listActiveProviderDefinitions(client) {
    const withRemark = await supportsProviderRemarkColumn(client);
    const res = await client.query(
        `
          SELECT ${providerDefinitionSelectFields({ withRemark })}
          FROM ai_provider_definitions
          WHERE is_active = true
          ORDER BY created_at DESC
        `
    );
    return res.rows;
}

export async function listAllProviderDefinitions(client, { limit = 100, offset = 0 } = {}) {
    const withRemark = await supportsProviderRemarkColumn(client);
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const res = await client.query(
        `
          SELECT ${providerDefinitionSelectFields({ withRemark })}
          FROM ai_provider_definitions
          ORDER BY created_at DESC
          LIMIT $1 OFFSET $2
        `,
        [safeLimit, safeOffset]
    );
    return res.rows;
}

export async function insertProviderDefinition(
    client,
    { code, displayName, remark, baseUrl, modelName, thinkingMode, maxTokens, temperatureX100, multiplierX100, isActive }
) {
    const withRemark = await supportsProviderRemarkColumn(client);
    const fields = withRemark
        ? 'code, display_name, remark, base_url, model_name, thinking_mode, max_tokens, temperature_x100, multiplier_x100, is_active'
        : 'code, display_name, base_url, model_name, thinking_mode, max_tokens, temperature_x100, multiplier_x100, is_active';
    const values = withRemark
        ? '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
        : '($1,$2,$3,$4,$5,$6,$7,$8,$9)';
    const params = withRemark
        ? [code, displayName, remark || null, baseUrl, modelName, thinkingMode, maxTokens, temperatureX100, multiplierX100, isActive]
        : [code, displayName, baseUrl, modelName, thinkingMode, maxTokens, temperatureX100, multiplierX100, isActive];

    const res = await client.query(
        `
          INSERT INTO ai_provider_definitions (${fields})
          VALUES ${values}
          RETURNING ${providerDefinitionSelectFields({ withRemark })}
        `,
        params
    );
    return res.rows[0];
}

export async function updateProviderDefinitionById(
    client,
    { id, displayName, remark, baseUrl, modelName, thinkingMode, maxTokens, temperatureX100, multiplierX100, isActive }
) {
    const withRemark = await supportsProviderRemarkColumn(client);
    const res = await client.query(
        withRemark
            ? `
              UPDATE ai_provider_definitions
              SET display_name = $2,
                  remark = $3,
                  base_url = $4,
                  model_name = $5,
                  thinking_mode = $6,
                  max_tokens = $7,
                  temperature_x100 = $8,
                  multiplier_x100 = $9,
                  is_active = $10,
                  updated_at = now()
              WHERE id = $1
              RETURNING ${providerDefinitionSelectFields({ withRemark })}
            `
            : `
              UPDATE ai_provider_definitions
              SET display_name = $2,
                  base_url = $3,
                  model_name = $4,
                  thinking_mode = $5,
                  max_tokens = $6,
                  temperature_x100 = $7,
                  multiplier_x100 = $8,
                  is_active = $9,
                  updated_at = now()
              WHERE id = $1
              RETURNING ${providerDefinitionSelectFields({ withRemark })}
            `,
        withRemark
            ? [id, displayName, remark || null, baseUrl, modelName, thinkingMode, maxTokens, temperatureX100, multiplierX100, isActive]
            : [id, displayName, baseUrl, modelName, thinkingMode, maxTokens, temperatureX100, multiplierX100, isActive]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function getProviderDefinitionById(client, id) {
    const withRemark = await supportsProviderRemarkColumn(client);
    const res = await client.query(
        `
          SELECT ${providerDefinitionSelectFields({ withRemark })}
          FROM ai_provider_definitions
          WHERE id = $1
          LIMIT 1
        `,
        [id]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function upsertOrganizationProviderSecretEncrypted(client, { organizationId, providerDefinitionId, apiKeyEnc }) {
    await client.query(
        `
          INSERT INTO organization_ai_provider_secrets (organization_id, provider_definition_id, api_key_enc)
          VALUES ($1, $2, $3)
          ON CONFLICT (organization_id, provider_definition_id)
          DO UPDATE SET api_key_enc = EXCLUDED.api_key_enc, updated_at = now()
        `,
        [organizationId, providerDefinitionId, apiKeyEnc]
    );
}

export async function hasOrganizationProviderSecret(client, { organizationId, providerDefinitionId }) {
    const res = await client.query(
        `
          SELECT 1
          FROM organization_ai_provider_secrets
          WHERE organization_id = $1 AND provider_definition_id = $2
          LIMIT 1
        `,
        [organizationId, providerDefinitionId]
    );
    return res.rowCount > 0;
}

export async function getOrganizationProviderSecretEncrypted(client, { organizationId, providerDefinitionId }) {
    const res = await client.query(
        `
          SELECT api_key_enc
          FROM organization_ai_provider_secrets
          WHERE organization_id = $1 AND provider_definition_id = $2
          LIMIT 1
        `,
        [organizationId, providerDefinitionId]
    );
    return res.rowCount ? res.rows[0].api_key_enc : null;
}

export async function getOrganizationSelectedProviderId(client, organizationId) {
    const res = await client.query(
        `
          SELECT provider_definition_id
          FROM organization_ai_provider_selection
          WHERE organization_id = $1
          LIMIT 1
        `,
        [organizationId]
    );
    return res.rowCount ? res.rows[0].provider_definition_id : null;
}

export async function upsertOrganizationSelectedProvider(client, { organizationId, providerDefinitionId }) {
    await client.query(
        `
          INSERT INTO organization_ai_provider_selection (organization_id, provider_definition_id)
          VALUES ($1, $2)
          ON CONFLICT (organization_id)
          DO UPDATE SET provider_definition_id = EXCLUDED.provider_definition_id, updated_at = now()
        `,
        [organizationId, providerDefinitionId]
    );
}
