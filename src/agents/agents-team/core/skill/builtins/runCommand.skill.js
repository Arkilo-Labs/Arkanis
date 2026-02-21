import { ErrorCode } from '../../contracts/errors.js';

// stdout/stderr 超过此字节数时截断，避免过大 artifact
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

/**
 * run_command builtin 实现。
 *
 * 若未提供 sandbox_id，自动管理 sandbox 生命周期（create → exec → destroy）。
 * 若提供 sandbox_id，仅 exec，不 destroy。
 *
 * stdout/stderr 落为 artifact，结果中通过 artifact_id 回指，不直接回显全文。
 *
 * @param {import('../../runtime/runContext.js').RunContext} ctx
 * @param {object} inputs
 * @param {object} meta
 * @returns {Promise<object>} outputs
 */
export async function runCommand(ctx, inputs, { correlationId, runId }) {
    const { toolGateway } = ctx;
    const {
        sandbox_id: inputSandboxId,
        cmd,
        args = [],
        cwd,
        timeout_ms,
    } = inputs;

    const autoSandbox = !inputSandboxId;
    let sandboxId = inputSandboxId;
    const toolCorrelationIds = [];

    // 1. 按需创建 sandbox
    if (autoSandbox) {
        const cid = `${correlationId}_create`;
        const r = await toolGateway.call(
            'sandbox.create',
            { network: 'off' },
            ctx,
            { run_id: runId, correlation_id: cid, parent_correlation_id: correlationId },
        );
        toolCorrelationIds.push(cid);
        if (!r.ok) {
            const e = new Error(r.error?.message ?? 'sandbox.create 失败');
            e.code = r.error?.code ?? ErrorCode.ERR_SANDBOX_START_FAILED;
            throw e;
        }
        sandboxId = r.data.sandbox_id;
    }

    // 2. 执行命令
    const execArgs = {
        sandbox_id: sandboxId,
        cmd,
        args,
        ...(cwd != null ? { cwd } : {}),
        ...(timeout_ms != null ? { timeout_ms } : {}),
    };

    const execCid = `${correlationId}_exec`;
    const execResult = await toolGateway.call('sandbox.exec', execArgs, ctx, {
        run_id: runId,
        correlation_id: execCid,
        parent_correlation_id: correlationId,
    });
    toolCorrelationIds.push(execCid);

    // 3. 按需销毁 sandbox（无论 exec 成败都清理，避免泄漏）
    if (autoSandbox) {
        const destroyCid = `${correlationId}_destroy`;
        await toolGateway.call(
            'sandbox.destroy',
            { sandbox_id: sandboxId },
            ctx,
            { run_id: runId, correlation_id: destroyCid, parent_correlation_id: correlationId },
        );
        toolCorrelationIds.push(destroyCid);
    }

    // 4. exec 失败则提前返回（sandbox 已清理）
    if (!execResult.ok) {
        const e = new Error(execResult.error?.message ?? 'sandbox.exec 失败');
        e.code = execResult.error?.code ?? ErrorCode.ERR_SANDBOX_EXEC_FAILED;
        throw e;
    }

    // 5. 截断后写 artifact
    const stdoutRaw = execResult.data.stdout_preview ?? '';
    const stderrRaw = execResult.data.stderr_preview ?? '';
    const stdoutContent = truncateUtf8(stdoutRaw, MAX_OUTPUT_BYTES);
    const stderrContent = truncateUtf8(stderrRaw, MAX_OUTPUT_BYTES);

    const stdoutCid = `${correlationId}_stdout`;
    const stdoutArt = await toolGateway.call(
        'artifact.write_text',
        {
            content: stdoutContent,
            type: 'stdout',
            filename: 'stdout.txt',
            provenance: `skill:run_command:${correlationId}`,
        },
        ctx,
        { run_id: runId, correlation_id: stdoutCid, parent_correlation_id: correlationId },
    );
    toolCorrelationIds.push(stdoutCid);

    const stderrCid = `${correlationId}_stderr`;
    const stderrArt = await toolGateway.call(
        'artifact.write_text',
        {
            content: stderrContent,
            type: 'stderr',
            filename: 'stderr.txt',
            provenance: `skill:run_command:${correlationId}`,
        },
        ctx,
        { run_id: runId, correlation_id: stderrCid, parent_correlation_id: correlationId },
    );
    toolCorrelationIds.push(stderrCid);

    const exitCode = execResult.ok ? (execResult.data.exit_code ?? null) : null;
    const stdoutArtifactId = stdoutArt.ok ? stdoutArt.data.artifact_id : null;
    const stderrArtifactId = stderrArt.ok ? stderrArt.data.artifact_id : null;

    const artifactRefs = [];
    if (stdoutArtifactId) artifactRefs.push({ artifact_id: stdoutArtifactId, type: 'stdout' });
    if (stderrArtifactId) artifactRefs.push({ artifact_id: stderrArtifactId, type: 'stderr' });

    return {
        exit_code: exitCode,
        stdout_artifact_id: stdoutArtifactId,
        stderr_artifact_id: stderrArtifactId,
        artifact_refs: artifactRefs,
        _tool_correlation_ids: toolCorrelationIds,
    };
}

function truncateUtf8(str, maxBytes) {
    const buf = Buffer.from(str, 'utf-8');
    if (buf.byteLength <= maxBytes) return str;
    return buf.subarray(0, maxBytes).toString('utf-8');
}
