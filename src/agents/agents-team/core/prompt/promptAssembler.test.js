import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createPromptAssembler, PromptMode, buildReminder } from './promptAssembler.js';
import { createFragmentLoader } from './fragmentLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname = src/agents/agents-team/core/prompt
// 上 4 层到 src/，再进 resources/
const REAL_FRAGMENTS_BASE = join(__dirname, '../../../..', 'resources/prompts/agents-team/fragments');

const RUN_ID = '20260101_120000';
const AGENT_ID = 'researcher-01';
const TASK_ID = 'task-01';
const ROLE = 'researcher';

// 创建临时目录，写入 mock fragment 文件
async function makeCtx(overrides = {}) {
    const base = await mkdtemp(join(tmpdir(), 'arkanis-p10-'));
    const fragmentsBaseDir = join(base, 'fragments');
    const outputDir = join(base, 'outputs', 'agents_team');

    await mkdir(join(fragmentsBaseDir, 'platform'), { recursive: true });
    await mkdir(join(fragmentsBaseDir, 'runtime'), { recursive: true });
    await mkdir(join(fragmentsBaseDir, 'role'), { recursive: true });

    const fragments = {
        safety: 'SAFETY: 禁止越权操作，禁止泄露密钥',
        tooling: 'TOOLING: tool_call 格式要求',
        runtimeContext: 'RUNTIME_CONTEXT: run_id={{run_id}} time={{current_utc}}',
        runtimeSandbox: 'RUNTIME_SANDBOX: mode={{sandbox_mode}}',
        role: 'ROLE_RESEARCHER: 只读工具，禁止写文件',
        ...overrides.fragments,
    };

    await writeFile(join(fragmentsBaseDir, 'platform', 'safety.md'), fragments.safety, 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'platform', 'tooling.md'), fragments.tooling, 'utf-8');
    await writeFile(
        join(fragmentsBaseDir, 'runtime', 'context.md'),
        fragments.runtimeContext,
        'utf-8',
    );
    await writeFile(
        join(fragmentsBaseDir, 'runtime', 'sandbox.md'),
        fragments.runtimeSandbox,
        'utf-8',
    );
    await writeFile(join(fragmentsBaseDir, 'role', `${ROLE}.md`), fragments.role, 'utf-8');

    const assembler = createPromptAssembler({ fragmentsBaseDir, outputDir });
    return { assembler, fragmentsBaseDir, outputDir, base, fragments };
}

function baseOpts(extra = {}) {
    return {
        runId: RUN_ID,
        agentId: AGENT_ID,
        taskId: TASK_ID,
        role: ROLE,
        ...extra,
    };
}

// T1 — full 模式：system 包含全部 4 个 fragment 层
test('full 模式：system 含 safety + tooling + runtime + role', async () => {
    const { assembler, fragments } = await makeCtx();
    const { system, user } = await assembler.assemble(baseOpts({ promptMode: PromptMode.FULL }));

    assert.ok(system.includes(fragments.safety), 'safety 缺失');
    assert.ok(system.includes(fragments.tooling), 'tooling 缺失');
    assert.ok(system.includes('RUNTIME_CONTEXT:'), 'runtime context 缺失');
    assert.ok(system.includes('RUNTIME_SANDBOX:'), 'runtime sandbox 缺失');
    assert.ok(system.includes(fragments.role), 'role 缺失');
    assert.equal(typeof user, 'string');
});

// T2 — minimal 模式：system 仅含 safety + role，无 tooling / runtime
test('minimal 模式：system 仅含 safety + role，不含 tooling / runtime', async () => {
    const { assembler, fragments } = await makeCtx();
    const { system } = await assembler.assemble(baseOpts({ promptMode: PromptMode.MINIMAL }));

    assert.ok(system.includes(fragments.safety), 'safety 缺失');
    assert.ok(system.includes(fragments.role), 'role 缺失');
    assert.ok(!system.includes(fragments.tooling), 'tooling 不应出现');
    assert.ok(!system.includes('RUNTIME_CONTEXT:'), 'runtime context 不应出现');
    assert.ok(!system.includes('RUNTIME_SANDBOX:'), 'runtime sandbox 不应出现');
});

// T3 — none 模式：system 仅含 safety，user 含 taskContract
test('none 模式：system 仅含 safety，user 含 taskContract JSON', async () => {
    const { assembler, fragments } = await makeCtx();
    const taskContract = { task_id: TASK_ID, title: '核验证据', type: 'audit' };
    const { system, user } = await assembler.assemble(
        baseOpts({ promptMode: PromptMode.NONE, taskContract }),
    );

    assert.ok(system.includes(fragments.safety), 'safety 缺失');
    assert.ok(!system.includes(fragments.tooling), 'tooling 不应出现');
    assert.ok(!system.includes(fragments.role), 'role 不应出现');
    assert.ok(user.includes(TASK_ID), 'taskContract 未出现在 user');
    assert.ok(user.includes('"audit"'), 'taskContract 内容不完整');
});

// T4 — safety.md 在 minimal 模式下必须出现
test('safety.md 在 minimal 模式下必须保留', async () => {
    const { assembler, fragments } = await makeCtx();
    const { system } = await assembler.assemble(baseOpts({ promptMode: PromptMode.MINIMAL }));
    assert.ok(system.includes(fragments.safety));
});

// T5 — hash 去重：safety 与 tooling 内容相同时只出现一次
test('hash 去重：相同内容的 fragment 在 system 中只出现一次', async () => {
    const SAME_CONTENT = 'SHARED: 完全一样的内容';
    const { assembler } = await makeCtx({
        fragments: { safety: SAME_CONTENT, tooling: SAME_CONTENT },
    });
    const { system } = await assembler.assemble(baseOpts({ promptMode: PromptMode.FULL }));

    const first = system.indexOf(SAME_CONTENT);
    const second = system.indexOf(SAME_CONTENT, first + 1);
    assert.equal(second, -1, '相同内容出现了多次');
});

// T6 — token budget 截断：小 budget + 多 artifactRefs → 末尾截断
test('token budget 超出：末尾 artifactRefs 被截断，truncated_evidence_count > 0', async () => {
    const { assembler, outputDir } = await makeCtx();

    const bigContent = 'X'.repeat(400);
    const artifactRefs = [
        { artifact_id: 'art-01', content: bigContent },
        { artifact_id: 'art-02', content: bigContent },
        { artifact_id: 'art-03', content: bigContent },
    ];

    const { user } = await assembler.assemble(
        baseOpts({ promptMode: PromptMode.NONE, artifactRefs, tokenBudget: 200 }),
    );

    const assembledPath = join(
        outputDir,
        RUN_ID,
        'prompts',
        `${AGENT_ID}_${TASK_ID}_assembled.json`,
    );
    const record = JSON.parse(await readFile(assembledPath, 'utf-8'));
    assert.ok(record.truncated_evidence_count > 0, 'truncated_evidence_count 应 > 0');

    const art01 = user.includes('art-01');
    const art03 = user.includes('art-03');
    assert.ok(!(art01 && art03), '预算有限时不应包含全部 artifact');
});

// T7 — 落盘文件不含明文 system / user
test('落盘文件不含 system / user 明文字段', async () => {
    const { assembler, outputDir } = await makeCtx();

    await assembler.assemble(baseOpts({ promptMode: PromptMode.FULL }));

    const assembledPath = join(
        outputDir,
        RUN_ID,
        'prompts',
        `${AGENT_ID}_${TASK_ID}_assembled.json`,
    );
    const record = JSON.parse(await readFile(assembledPath, 'utf-8'));

    assert.ok(!('system' in record), '落盘文件不得含 system 明文');
    assert.ok(!('user' in record), '落盘文件不得含 user 明文');
    assert.ok(typeof record.system_hash === 'string' && record.system_hash.length === 64);
    assert.ok(typeof record.user_hash === 'string' && record.user_hash.length === 64);
    assert.ok(typeof record.assembled_hash === 'string' && record.assembled_hash.length === 64);
    assert.ok(Array.isArray(record.fragments_used));
    assert.ok(typeof record.token_estimate === 'number');
});

// T8 — template 变量替换：{{run_id}} 被替换为实际 run_id
test('template 变量替换：{{run_id}} 替换为传入的 run_id', async () => {
    const { assembler } = await makeCtx();
    const { system } = await assembler.assemble(
        baseOpts({
            promptMode: PromptMode.FULL,
            runConfig: { run_id: RUN_ID },
        }),
    );

    assert.ok(system.includes(RUN_ID), `system 中未找到 run_id: ${RUN_ID}`);
    assert.ok(!system.includes('{{run_id}}'), '{{run_id}} 未被替换');
});

// --- P11 测试：真实 fragment 文件 ---

// T9 — FragmentLoader 能加载 platform/safety.md
test('P11: FragmentLoader 加载 platform/safety.md 返回非空内容', async () => {
    const loader = createFragmentLoader();
    const frag = await loader.load(join(REAL_FRAGMENTS_BASE, 'platform', 'safety.md'));
    assert.ok(typeof frag.content === 'string' && frag.content.length > 0, 'safety.md 内容为空');
    assert.ok(typeof frag.hash === 'string' && frag.hash.length === 64, 'hash 格式不正确');
});

// T10 — FragmentLoader 能加载 platform/tooling.md
test('P11: FragmentLoader 加载 platform/tooling.md 返回非空内容', async () => {
    const loader = createFragmentLoader();
    const frag = await loader.load(join(REAL_FRAGMENTS_BASE, 'platform', 'tooling.md'));
    assert.ok(typeof frag.content === 'string' && frag.content.length > 0, 'tooling.md 内容为空');
    assert.ok(typeof frag.hash === 'string' && frag.hash.length === 64);
});

// T11 — FragmentLoader 能加载 runtime/context.md
test('P11: FragmentLoader 加载 runtime/context.md 返回非空内容', async () => {
    const loader = createFragmentLoader();
    const frag = await loader.load(join(REAL_FRAGMENTS_BASE, 'runtime', 'context.md'));
    assert.ok(typeof frag.content === 'string' && frag.content.length > 0, 'context.md 内容为空');
    assert.ok(typeof frag.hash === 'string' && frag.hash.length === 64);
});

// T12 — FragmentLoader 能加载 runtime/sandbox.md
test('P11: FragmentLoader 加载 runtime/sandbox.md 返回非空内容', async () => {
    const loader = createFragmentLoader();
    const frag = await loader.load(join(REAL_FRAGMENTS_BASE, 'runtime', 'sandbox.md'));
    assert.ok(typeof frag.content === 'string' && frag.content.length > 0, 'sandbox.md 内容为空');
    assert.ok(typeof frag.hash === 'string' && frag.hash.length === 64);
});

// T13 — PromptAssembler 使用真实 fragments 时模板变量被正确替换
test('P11: 真实 runtime/context.md 中的 {{run_id}} 和 {{current_utc}} 被替换', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'arkanis-p11-'));
    const assembler = createPromptAssembler({
        fragmentsBaseDir: REAL_FRAGMENTS_BASE,
        outputDir,
    });

    const TEST_RUN_ID = '20260101_120001';
    const { system } = await assembler.assemble({
        runId: TEST_RUN_ID,
        agentId: 'lead-01',
        taskId: 'task-plan',
        role: 'lead',
        promptMode: PromptMode.FULL,
        runConfig: { run_id: TEST_RUN_ID },
    });

    assert.ok(system.includes(TEST_RUN_ID), `system 中未找到 run_id: ${TEST_RUN_ID}`);
    assert.ok(!system.includes('{{run_id}}'), 'context.md 中 {{run_id}} 未被替换');
    assert.ok(!system.includes('{{current_utc}}'), 'context.md 中 {{current_utc}} 未被替换');
    assert.ok(!system.includes('{{sandbox_mode}}'), 'sandbox.md 中 {{sandbox_mode}} 未被替换');
});

// T14 — PromptAssembler 使用真实 fragments 时 safety.md 在 minimal 模式下保留
test('P11: 真实 fragments 下 minimal 模式仍保留 safety.md 关键内容', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'arkanis-p11b-'));
    const assembler = createPromptAssembler({
        fragmentsBaseDir: REAL_FRAGMENTS_BASE,
        outputDir,
    });

    const { system } = await assembler.assemble({
        runId: '20260101_120002',
        agentId: 'auditor-01',
        taskId: 'task-audit',
        role: 'auditor',
        promptMode: PromptMode.MINIMAL,
    });

    // safety.md 的核心标识性内容必须存在
    assert.ok(system.includes('越权禁止'), 'safety.md "越权禁止" 段落缺失');
    assert.ok(system.includes('注入防线'), 'safety.md "注入防线" 段落缺失');
    assert.ok(system.includes('敏感信息禁止输出'), 'safety.md "敏感信息禁止输出" 段落缺失');
    // minimal 模式不含 tooling / runtime
    assert.ok(!system.includes('ToolGateway 调用协议'), 'tooling.md 不应出现在 minimal 模式');
    assert.ok(!system.includes('{{'), '存在未替换的模板变量');
});

// --- P12 测试：角色 fragment 选取 + buildReminder ---

// T15 — role=researcher 时 system 包含 researcher 内容，不包含 executor 内容
test('P12: role=researcher 时包含 researcher fragment，不包含 executor fragment', async () => {
    const base = await mkdtemp(join(tmpdir(), 'arkanis-p12-'));
    const fragmentsBaseDir = join(base, 'fragments');
    const outputDir = join(base, 'outputs', 'agents_team');

    await mkdir(join(fragmentsBaseDir, 'platform'), { recursive: true });
    await mkdir(join(fragmentsBaseDir, 'runtime'), { recursive: true });
    await mkdir(join(fragmentsBaseDir, 'role'), { recursive: true });

    await writeFile(join(fragmentsBaseDir, 'platform', 'safety.md'), 'SAFETY', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'platform', 'tooling.md'), 'TOOLING', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'runtime', 'context.md'), 'CONTEXT', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'runtime', 'sandbox.md'), 'SANDBOX', 'utf-8');
    await writeFile(
        join(fragmentsBaseDir, 'role', 'researcher.md'),
        'ROLE_RESEARCHER: 只读工具，禁止写文件',
        'utf-8',
    );
    await writeFile(
        join(fragmentsBaseDir, 'role', 'executor.md'),
        'ROLE_EXECUTOR: 认领任务格式，执行 skill',
        'utf-8',
    );

    const assembler = createPromptAssembler({ fragmentsBaseDir, outputDir });
    const { system } = await assembler.assemble({
        runId: '20260122_120000',
        agentId: 'researcher-01',
        taskId: 'task-p12',
        role: 'researcher',
        promptMode: PromptMode.FULL,
    });

    assert.ok(system.includes('ROLE_RESEARCHER'), 'researcher fragment 缺失');
    assert.ok(!system.includes('ROLE_EXECUTOR'), 'executor fragment 不应出现');
});

// T16 — buildReminder 三档触发类型均返回非空且各不相同的字符串
test('P12: buildReminder 三档触发类型返回非空且互不相同的文本', () => {
    const r1 = buildReminder('tool_return');
    const r2 = buildReminder('strong_claim_no_evidence');
    const r3 = buildReminder('leak_attempt');

    assert.ok(typeof r1 === 'string' && r1.length > 0, 'tool_return 提醒为空');
    assert.ok(typeof r2 === 'string' && r2.length > 0, 'strong_claim_no_evidence 提醒为空');
    assert.ok(typeof r3 === 'string' && r3.length > 0, 'leak_attempt 提醒为空');
    assert.notEqual(r1, r2, 'tool_return 与 strong_claim_no_evidence 不应相同');
    assert.notEqual(r2, r3, 'strong_claim_no_evidence 与 leak_attempt 不应相同');
    assert.notEqual(r1, r3, 'tool_return 与 leak_attempt 不应相同');
});

// T17 — buildReminder 传入未知 triggerType 抛出错误
test('P12: buildReminder 传入未知 triggerType 抛出错误', () => {
    assert.throws(
        () => buildReminder('unknown_trigger'),
        /未知 triggerType/,
        '应抛出含"未知 triggerType"的错误',
    );
});
