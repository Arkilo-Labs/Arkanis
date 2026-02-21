import { appendJsonlLine } from '../../../../core/utils/jsonlWriter.js';

/**
 * 写 skill_runs.jsonl 单行审计记录（deny 也写，ok=false）。
 *
 * @param {string} skillRunsJsonlPath  绝对路径，由 runPaths.skillRunsJsonlPath 提供
 * @param {object} record  AuditSkillRunRecord
 */
export async function writeSkillRunRecord(skillRunsJsonlPath, record) {
    await appendJsonlLine(skillRunsJsonlPath, record);
}
