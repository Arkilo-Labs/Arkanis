export async function getBillingCustomerByOrgAndProvider(client, { organizationId, provider }) {
    const res = await client.query(
        `
          SELECT id, organization_id, provider, provider_customer_id, created_at
          FROM billing_customers
          WHERE organization_id = $1 AND provider = $2
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [organizationId, provider]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function insertBillingCustomer(client, { organizationId, provider, providerCustomerId }) {
    const res = await client.query(
        `
          INSERT INTO billing_customers (organization_id, provider, provider_customer_id)
          VALUES ($1, $2, $3)
          RETURNING id, organization_id, provider, provider_customer_id, created_at
        `,
        [organizationId, provider, providerCustomerId]
    );
    return res.rows[0];
}

