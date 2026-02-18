import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    readProviderDefinitions,
    writeProviderDefinitionsAtomic,
} from './aiProvidersStore.js';
import { readSecrets, setProviderApiKey, writeSecretsAtomic } from './secretsStore.js';
import { readProviderConfig, setProviderRoles } from './providerConfigStore.js';
import { listProvidersWithStatus, resolveProviderForRole, resolveProviderKey } from './providerResolver.js';
import { createRedactor } from '../utils/redactSecrets.js';

async function newTempProject() {
    const projectRoot = await mkdtemp(join(tmpdir(), 'arkanis-provider-test-'));
    const dataDir = join(projectRoot, 'data');
    await mkdir(dataDir, { recursive: true });
    return { projectRoot, dataDir };
}

test('aiProvidersStore: baseUrl 规范化（去 /v1 与尾斜杠）', async () => {
    const { projectRoot, dataDir } = await newTempProject();
    const defaultPath = join(projectRoot, 'ai-providers.default.json');
    await writeFile(
        defaultPath,
        JSON.stringify(
            {
                version: 1,
                providers: [
                    {
                        id: 'p1',
                        name: 'P1',
                        type: 'openai_compatible',
                        protocol: 'chat_completions',
                        baseUrl: 'https://api.example.com/v1/',
                        modelName: 'm1',
                        apiKeyEnv: '',
                        supportsVision: false,
                        thinkingMode: 'disabled',
                    },
                ],
            },
            null,
            2,
        ),
        'utf-8',
    );

    const { providers, source } = await readProviderDefinitions({ projectRoot, dataDir });
    assert.equal(source, 'default');
    assert.equal(providers[0].baseUrl, 'https://api.example.com');
});

test('secretsStore: 明文读写 + createdAt/updatedAt', async () => {
    const { dataDir } = await newTempProject();
    await setProviderApiKey({ dataDir, providerId: 'p1', apiKey: 'sk-test-plaintext' });

    const secrets = await readSecrets({ dataDir });
    assert.equal(secrets.version, 1);
    assert.equal(secrets.providers.p1.apiKey, 'sk-test-plaintext');
    assert.ok(secrets.createdAt);
    assert.ok(secrets.updatedAt);
});

test('secretsStore: 加密落盘可读；缺少 encKey 时拒绝读取', async () => {
    const { dataDir } = await newTempProject();
    const secrets = {
        version: 1,
        providers: { p1: { apiKey: 'sk-test-encrypted' } },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    await writeSecretsAtomic({ dataDir, encKey: 'enc-key-1', secrets });

    const loaded = await readSecrets({ dataDir, encKey: 'enc-key-1' });
    assert.equal(loaded.providers.p1.apiKey, 'sk-test-encrypted');

    await assert.rejects(() => readSecrets({ dataDir, encKey: '' }), /未设置 SECRETS_ENC_KEY/);
});

test('providerResolver: ENV > secrets > none', async () => {
    const envName = 'TEST_PROVIDER_KEY';
    const original = process.env[envName];
    try {
        const secrets = { version: 1, providers: { p1: { apiKey: 'sk-from-secrets' } }, createdAt: null, updatedAt: null };

        process.env[envName] = 'sk-from-env';
        assert.deepEqual(resolveProviderKey({ providerId: 'p1', apiKeyEnv: envName, secrets }), {
            apiKey: 'sk-from-env',
            source: 'env',
        });

        delete process.env[envName];
        assert.deepEqual(resolveProviderKey({ providerId: 'p1', apiKeyEnv: envName, secrets }), {
            apiKey: 'sk-from-secrets',
            source: 'secrets',
        });

        assert.deepEqual(resolveProviderKey({ providerId: 'p2', apiKeyEnv: '', secrets }), {
            apiKey: null,
            source: 'none',
        });
    } finally {
        if (original === undefined) delete process.env[envName];
        else process.env[envName] = original;
    }
});

test('providerResolver: listProvidersWithStatus 输出 keySource/locked/hasKey', async () => {
    const { projectRoot, dataDir } = await newTempProject();

    await writeProviderDefinitionsAtomic({
        projectRoot,
        dataDir,
        providers: [
            {
                id: 'p_env',
                name: 'P ENV',
                type: 'openai_compatible',
                protocol: 'chat_completions',
                baseUrl: 'https://api.example.com',
                modelName: 'm',
                apiKeyEnv: 'P_ENV_KEY',
                supportsVision: false,
                thinkingMode: 'disabled',
            },
            {
                id: 'p_secrets',
                name: 'P Secrets',
                type: 'openai_compatible',
                protocol: 'chat_completions',
                baseUrl: 'https://api.example.com',
                modelName: 'm',
                apiKeyEnv: '',
                supportsVision: false,
                thinkingMode: 'disabled',
            },
            {
                id: 'p_none',
                name: 'P None',
                type: 'openai_compatible',
                protocol: 'chat_completions',
                baseUrl: 'https://api.example.com',
                modelName: 'm',
                apiKeyEnv: '',
                supportsVision: false,
                thinkingMode: 'disabled',
            },
        ],
    });

    const original = process.env.P_ENV_KEY;
    process.env.P_ENV_KEY = 'sk-env';
    try {
        await setProviderApiKey({ dataDir, providerId: 'p_secrets', apiKey: 'sk-secrets' });

        const providers = await listProvidersWithStatus({ projectRoot, dataDir });
        const byId = Object.fromEntries(providers.map((p) => [p.id, p]));

        assert.equal(byId.p_env.hasKey, true);
        assert.equal(byId.p_env.keySource, 'env');
        assert.equal(byId.p_env.locked, true);

        assert.equal(byId.p_secrets.hasKey, true);
        assert.equal(byId.p_secrets.keySource, 'secrets');
        assert.equal(byId.p_secrets.locked, false);

        assert.equal(byId.p_none.hasKey, false);
        assert.equal(byId.p_none.keySource, 'none');
        assert.equal(byId.p_none.locked, false);
    } finally {
        if (original === undefined) delete process.env.P_ENV_KEY;
        else process.env.P_ENV_KEY = original;
    }
});

test('providerConfigStore: role 校验；resolveProviderForRole 能拿到密钥', async () => {
    const { projectRoot, dataDir } = await newTempProject();

    await writeProviderDefinitionsAtomic({
        projectRoot,
        dataDir,
        providers: [
            {
                id: 'p1',
                name: 'P1',
                type: 'openai_compatible',
                protocol: 'chat_completions',
                baseUrl: 'https://api.example.com',
                modelName: 'm1',
                apiKeyEnv: '',
                supportsVision: false,
                thinkingMode: 'disabled',
            },
        ],
    });

                await assert.rejects(
                    () =>
                        setProviderRoles({
                            dataDir,
                            roles: { lens: 'p_missing', newser: null, researcher: null, auditor: null },
                            knownProviderIds: ['p1'],
                        }),
                    /不存在的 provider/,
                );

        await setProviderApiKey({ dataDir, providerId: 'p1', apiKey: 'sk-role-key' });
        await setProviderRoles({
            dataDir,
            roles: { lens: 'p1', newser: null, researcher: null, auditor: null },
            knownProviderIds: ['p1'],
        });

        const cfg = await readProviderConfig({ dataDir });
        assert.equal(cfg.roles.lens, 'p1');

        const resolved = await resolveProviderForRole({ projectRoot, dataDir, role: 'lens' });
        assert.equal(resolved.provider.id, 'p1');
        assert.equal(resolved.apiKey, 'sk-role-key');
        assert.equal(resolved.keySource, 'secrets');
});

test('redactSecrets: 精确替换 + 常见前缀兜底', () => {
    const redactor = createRedactor({ secretValues: ['sk-EXACT-1234567890'] });
    assert.equal(redactor('token=sk-EXACT-1234567890'), 'token=[REDACTED]');
    assert.equal(redactor('Authorization: Bearer abcdefghijklmnop'), 'Authorization: Bearer [REDACTED]');
    assert.equal(redactor('{"apiKey":"sk-ANY-1234567890"}'), '{"apiKey":"[REDACTED]"}');
});
