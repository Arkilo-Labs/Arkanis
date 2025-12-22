export async function lockCreditStateForUpdate(client, subscriptionId) {
    const res = await client.query(
        `
          SELECT subscription_id, organization_id, anchor_day, period_start, period_end, allowance_units, used_units
          FROM subscription_ai_credit_state
          WHERE subscription_id = $1
          FOR UPDATE
        `,
        [subscriptionId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function insertCreditState(client, state) {
    const res = await client.query(
        `
          INSERT INTO subscription_ai_credit_state (
            subscription_id, organization_id, anchor_day, period_start, period_end, allowance_units, used_units
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING subscription_id, organization_id, anchor_day, period_start, period_end, allowance_units, used_units
        `,
        [
            state.subscriptionId,
            state.organizationId,
            state.anchorDay,
            state.periodStart,
            state.periodEnd,
            state.allowanceUnits,
            state.usedUnits,
        ]
    );
    return res.rows[0];
}

export async function updateCreditState(client, state) {
    const res = await client.query(
        `
          UPDATE subscription_ai_credit_state
          SET anchor_day = $2,
              period_start = $3,
              period_end = $4,
              allowance_units = $5,
              used_units = $6,
              updated_at = now()
          WHERE subscription_id = $1
          RETURNING subscription_id, organization_id, anchor_day, period_start, period_end, allowance_units, used_units
        `,
        [
            state.subscriptionId,
            state.anchorDay,
            state.periodStart,
            state.periodEnd,
            state.allowanceUnits,
            state.usedUnits,
        ]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function insertCreditLedger(client, entry) {
    const res = await client.query(
        `
          INSERT INTO ai_credit_ledger (
            organization_id, user_id, subscription_id, provider_definition_id,
            units, multiplier_x100, reason, meta
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING id, created_at
        `,
        [
            entry.organizationId,
            entry.userId,
            entry.subscriptionId,
            entry.providerDefinitionId,
            entry.units,
            entry.multiplierX100,
            entry.reason,
            entry.meta || null,
        ]
    );
    return res.rows[0];
}

