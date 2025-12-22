export async function tryInsertStripeWebhookEvent(client, { eventId, type }) {
    const res = await client.query(
        `
          INSERT INTO stripe_webhook_events (event_id, type)
          VALUES ($1, $2)
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id
        `,
        [eventId, type]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function markStripeWebhookEventProcessed(client, { eventId, error = null }) {
    await client.query(
        `
          UPDATE stripe_webhook_events
          SET processed_at = now(),
              last_error = $2
          WHERE event_id = $1
        `,
        [eventId, error]
    );
}

