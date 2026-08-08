import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import yaml from "js-yaml";
import { atomicWrite, atomicWriteJson, readJson } from "./fs.js";
import type {
  ExecutionMode,
  ParsedPlanV2,
  PhaseReport,
  PlanLifecycle,
  PlanMetadataV2,
  PlanPhaseV2,
  ReviewVerdict,
} from "./types.js";

const PHASE_LINE = /^- \[([ xX])\]\s+(P\d+)\s+[—-]\s+(.+)$/;

type RawMetadata = Partial<PlanMetadataV2> & Record<string, unknown>;

export interface PlanValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  plan?: ParsedPlanV2;
}

function splitFrontmatter(raw: string): { metadata: RawMetadata; body: string } {
  if (!raw.startsWith("---\n")) return { metadata: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return { metadata: {}, body: raw };
  const parsed = yaml.load(raw.slice(4, end)) as RawMetadata | null;
  return { metadata: parsed || {}, body: raw.slice(end + 5) };
}

function normalizeMode(value: unknown): ExecutionMode {
  return value === "batch" ? "batch" : "strict";
}

function normalizeMetadata(raw: RawMetadata, planPath: string): PlanMetadataV2 {
  const task = String(raw.task || path.basename(planPath, ".md"));
  const workspace = String(raw.workspace || path.resolve(path.dirname(planPath), "../.."));
  const statusValues: PlanLifecycle[] = [
    "draft",
    "approved",
    "running",
    "paused",
    "completed",
    "cancelled",
  ];
  const status = statusValues.includes(raw.status as PlanLifecycle)
    ? (raw.status as PlanLifecycle)
    : "draft";
  const batch = Number(raw.batchSize || 1);
  return {
    schemaVersion: 2,
    planId: String(raw.planId || ""),
    task,
    workspace: path.resolve(workspace),
    status,
    executionMode: normalizeMode(raw.executionMode),
    batchSize: Number.isInteger(batch) && batch > 0 ? batch : 1,
    approvedAt: raw.approvedAt ? String(raw.approvedAt) : null,
    specHash: raw.specHash ? String(raw.specHash) : null,
  };
}

function section(body: string, heading: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function bullets(value: string): string[] {
  return value
    .split("\n")
    .map((line) =>
      line.match(/^\s*(?:[-*]|\d+\.)\s+(?!\[[ xX]\])(.*)$/)?.[1]?.trim(),
    )
    .filter((item): item is string => Boolean(item));
}

function fieldLines(block: string, label: string): string[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = block.match(new RegExp(`^\\s*-\\s*${escaped}：(.+)$`, "m"));
  if (!direct) return [];
  return direct[1]
    .split(/[，,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseReport(block: string, id: string): PhaseReport {
  const pattern = new RegExp(
    `<!-- OPENCODE REPORT ${id} START -->([\\s\\S]*?)<!-- OPENCODE REPORT ${id} END -->`,
  );
  const content = block.match(pattern)?.[1] || "";
  const status = content.match(/^[ \t]*status:[ \t]*(.*)$/m)?.[1]?.trim() || "pending";
  const comment = content.match(/^[ \t]*comment:[ \t]*(.*)$/m)?.[1]?.trim() || "";
  const evidenceText = content.match(/^[ \t]*evidence:[ \t]*(.*)$/m)?.[1]?.trim() || "";
  return {
    status,
    comment,
    evidence: evidenceText
      ? evidenceText.split(/\s*\|\s*/).filter(Boolean)
      : [],
  };
}

function parsePhases(body: string): PlanPhaseV2[] {
  const lines = body.split("\n");
  const starts: Array<{ line: number; checked: boolean; id: string; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(PHASE_LINE);
    if (!match) continue;
    starts.push({
      line: i,
      checked: match[1].toLowerCase() === "x",
      id: match[2],
      title: match[3].trim(),
    });
  }

  return starts.map((start, index) => {
    const nextPhase = starts[index + 1]?.line ?? lines.length;
    const nextSectionOffset = lines.slice(start.line + 1, nextPhase).findIndex((line) => /^##\s+/.test(line));
    const nextSection = nextSectionOffset >= 0 ? start.line + 1 + nextSectionOffset : lines.length;
    const end = Math.min(nextPhase, nextSection);
    const block = lines.slice(start.line, end).join("\n");
    const dependencyText = fieldLines(block, "依赖");
    const dependencies = dependencyText
      .flatMap((value) => value.match(/P\d+/g) || [])
      .filter((value, pos, all) => all.indexOf(value) === pos);
    const allowedPaths = [
      ...fieldLines(block, "允许修改"),
      ...fieldLines(block, "允许路径"),
    ];
    const acceptance = [
      ...fieldLines(block, "验收"),
      ...fieldLines(block, "验收标准"),
    ];
    const acceptanceCommands = fieldLines(block, "验收命令").map((value) =>
      value.replace(/^`|`$/g, ""),
    );
    return {
      id: start.id,
      title: start.title,
      checked: start.checked,
      dependencies,
      allowedPaths: allowedPaths.length ? allowedPaths : ["**/*"],
      acceptance,
      acceptanceCommands,
      report: parseReport(block, start.id),
      rawStart: start.line,
      rawEnd: end,
    };
  });
}

function canonicalSpec(metadata: PlanMetadataV2, body: string): string {
  const immutableBody = body
    .replace(
      /^[ \t]*<!-- OPENCODE REPORT P\d+ START -->[\s\S]*?^[ \t]*<!-- OPENCODE REPORT P\d+ END -->/gm,
      "  <!-- OPENCODE REPORT -->",
    )
    .replace(
      /^[ \t]*<!-- CODEX REVIEW P\d+ START -->[\s\S]*?^[ \t]*<!-- CODEX REVIEW P\d+ END -->/gm,
      "  <!-- CODEX REVIEW -->",
    )
    .replace(/^- \[[ xX]\](\s+P\d+\s+[—-])/gm, "- [ ]$1")
    .replace(/[ \t]+$/gm, "")
    .trim();
  const contractMetadata = {
    schemaVersion: 2,
    planId: metadata.planId,
    task: metadata.task,
    workspace: metadata.workspace,
    executionMode: metadata.executionMode,
    batchSize: metadata.batchSize,
  };
  return `${JSON.stringify(contractMetadata)}\n${immutableBody}\n`;
}

export function computeSpecHash(metadata: PlanMetadataV2, body: string): string {
  return createHash("sha256").update(canonicalSpec(metadata, body)).digest("hex");
}

export function parsePlan(planPath: string): ParsedPlanV2 {
  const raw = fs.readFileSync(planPath, "utf8");
  const split = splitFrontmatter(raw);
  const metadata = normalizeMetadata(split.metadata, planPath);
  return {
    path: path.resolve(planPath),
    raw,
    metadata,
    hardRules: bullets(section(split.body, /^##\s+整个项目必须遵循的硬性规定\s*$/)),
    phases: parsePhases(split.body),
    globalAcceptanceCommands: bullets(
      section(split.body, /^##\s+(?:总体验收命令|验收命令)\s*$/),
    ).map((value) => {
      const match = value.match(/`([^`]+)`/);
      return match?.[1] || value.replace(/^验收[:：]\s*/, "");
    }),
    computedSpecHash: computeSpecHash(metadata, split.body),
  };
}

export function validatePlan(planPath: string): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let plan: ParsedPlanV2;
  let rawMetadata: RawMetadata = {};
  try {
    rawMetadata = splitFrontmatter(fs.readFileSync(planPath, "utf8")).metadata;
    plan = parsePlan(planPath);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
    };
  }
  if (rawMetadata.schemaVersion !== undefined && ![1, 2].includes(Number(rawMetadata.schemaVersion))) {
    errors.push(`unsupported schemaVersion: ${String(rawMetadata.schemaVersion)}`);
  }
  if (rawMetadata.executionMode !== undefined && !["strict", "batch"].includes(String(rawMetadata.executionMode))) {
    errors.push(`invalid executionMode: ${String(rawMetadata.executionMode)}`);
  }
  if (rawMetadata.batchSize !== undefined && (!Number.isInteger(Number(rawMetadata.batchSize)) || Number(rawMetadata.batchSize) < 1)) {
    errors.push(`invalid batchSize: ${String(rawMetadata.batchSize)}`);
  }
  if (rawMetadata.workspace !== undefined && !path.isAbsolute(String(rawMetadata.workspace))) {
    errors.push("workspace must be absolute");
  }
  if (!plan.metadata.task.trim()) errors.push("task is required");
  if (!path.isAbsolute(plan.metadata.workspace)) errors.push("workspace must be absolute");
  if (!plan.hardRules.length) errors.push("hard rules section is required");
  if (!plan.phases.length) errors.push("at least one phase is required");
  const ids = new Set<string>();
  for (const phase of plan.phases) {
    if (ids.has(phase.id)) errors.push(`duplicate phase id: ${phase.id}`);
    ids.add(phase.id);
    if (!plan.raw.includes(`<!-- OPENCODE REPORT ${phase.id} START -->`) || !plan.raw.includes(`<!-- OPENCODE REPORT ${phase.id} END -->`)) {
      errors.push(`${phase.id} executor report block is required`);
    }
    if (plan.metadata.status === "draft" && phase.checked) errors.push(`${phase.id} must be unchecked before approval`);
    if (plan.metadata.status === "draft" && phase.report.status !== "pending") errors.push(`${phase.id} report must be pending before approval`);
    if (!phase.acceptance.length) warnings.push(`${phase.id} has no machine-readable acceptance field`);
    for (const dependency of phase.dependencies) {
      if (!ids.has(dependency)) {
        errors.push(`${phase.id} dependency must reference an earlier phase: ${dependency}`);
      }
    }
  }
  if (plan.metadata.executionMode === "strict" && plan.metadata.batchSize !== 1) {
    errors.push("strict mode requires batchSize=1");
  }
  if (plan.metadata.status !== "draft") {
    if (!plan.metadata.planId) errors.push("approved/running plan requires planId");
    if (!plan.metadata.specHash) errors.push("approved/running plan requires specHash");
    if (plan.metadata.specHash && plan.metadata.specHash !== plan.computedSpecHash) {
      errors.push("plan_contract_modified: specHash mismatch");
    }
  }
  return { ok: errors.length === 0, errors, warnings, plan };
}

function serialize(metadata: PlanMetadataV2, body: string): string {
  const frontmatter = yaml.dump(metadata, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body.trimStart().replace(/\s*$/, "\n")}`;
}

function ensureReviewBlocks(body: string): string {
  let next = body;
  for (const phase of parsePhases(body)) {
    const existing = `<!-- CODEX REVIEW ${phase.id} START -->`;
    if (next.includes(existing)) continue;
    const reportEnd = `<!-- OPENCODE REPORT ${phase.id} END -->`;
    const review = [
      `  <!-- CODEX REVIEW ${phase.id} START -->`,
      "  verdict: pending",
      "  summary:",
      "  gaps:",
      `  <!-- CODEX REVIEW ${phase.id} END -->`,
    ].join("\n");
    next = next.replace(reportEnd, `${reportEnd}\n${review}`);
  }
  return next;
}

export function approvePlan(planPath: string): ParsedPlanV2 {
  const before = validatePlan(planPath);
  if (!before.ok) throw new Error(`plan_invalid: ${before.errors.join("; ")}`);
  const raw = fs.readFileSync(planPath, "utf8");
  const split = splitFrontmatter(raw);
  const metadata = normalizeMetadata(split.metadata, planPath);
  if (!metadata.planId) metadata.planId = randomUUID();
  metadata.schemaVersion = 2;
  metadata.status = "approved";
  metadata.approvedAt = new Date().toISOString();
  const body = ensureReviewBlocks(split.body);
  metadata.specHash = computeSpecHash(metadata, body);
  atomicWrite(planPath, serialize(metadata, body));
  const parsed = parsePlan(planPath);
  const validation = validatePlan(planPath);
  if (!validation.ok) throw new Error(`plan_invalid: ${validation.errors.join("; ")}`);
  const lockPath = approvalLockPath(planPath);
  atomicWriteJson(lockPath, {
    schemaVersion: 2,
    planId: parsed.metadata.planId,
    approvedAt: parsed.metadata.approvedAt,
    specHash: parsed.metadata.specHash,
  });
  const legacyLock = legacyApprovalLockPath(planPath);
  if (fs.existsSync(legacyLock)) fs.unlinkSync(legacyLock);
  return parsed;
}

function legacyApprovalLockPath(planPath: string): string {
  return `${planPath.replace(/\.md$/i, "")}.lock.json`;
}

export function approvalLockPath(planPath: string): string {
  const orchestratorDir = path.dirname(path.dirname(path.resolve(planPath)));
  const name = path.basename(planPath).replace(/\.md$/i, "");
  return path.join(orchestratorDir, "runs", "plan-locks", `${name}.lock.json`);
}

function existingApprovalLockPath(planPath: string): string {
  const current = approvalLockPath(planPath);
  const legacy = legacyApprovalLockPath(planPath);
  if (fs.existsSync(current)) {
    if (fs.existsSync(legacy)) {
      try {
        fs.unlinkSync(legacy);
      } catch {
        // A concurrent integrity check may already have removed it.
      }
    }
    return current;
  }
  if (!fs.existsSync(legacy)) return current;

  // One-time migration from early v2 builds, which put runtime metadata beside
  // the versionable Markdown Plan and therefore made it appear in git status.
  atomicWriteJson(current, readJson<unknown>(legacy));
  try {
    fs.unlinkSync(legacy);
  } catch {
    // A concurrent integrity check may already have migrated it.
  }
  return current;
}

export function migratePlanV1(args: {
  planPath: string;
  outputPath?: string;
  inPlace?: boolean;
}): { source: string; output: string; backup?: string; validation: PlanValidation } {
  const source = path.resolve(args.planPath);
  const raw = fs.readFileSync(source, "utf8");
  const split = splitFrontmatter(raw);
  if (Number(split.metadata.schemaVersion) === 2) {
    return { source, output: source, validation: validatePlan(source) };
  }
  const workspace = path.resolve(String(split.metadata.workspace || path.resolve(path.dirname(source), "../..")));
  const task = String(split.metadata.task || path.basename(source, ".md"));
  let body = split.body.trim();
  const oldCheckboxes = [...body.matchAll(/^- \[([ xX])\]\s+(?!P\d+\s+[—-])(.+)$/gm)];
  if (oldCheckboxes.length) {
    let index = 0;
    body = body.replace(/^- \[([ xX])\]\s+(?!P\d+\s+[—-])(.+)$/gm, (_line, checked: string, title: string) => {
      index += 1;
      const id = `P${String(index).padStart(2, "0")}`;
      return [
        `- [${checked}] ${id} — ${title.trim()}`,
        "  - 允许修改：**/*",
        "  - 验收：按原 Plan 的对应步骤验收（迁移后需用户复核）",
        `  <!-- OPENCODE REPORT ${id} START -->`,
        "  status: pending",
        "  comment:",
        "  evidence:",
        `  <!-- OPENCODE REPORT ${id} END -->`,
      ].join("\n");
    });
  }
  if (!parsePhases(body).length) {
    body += [
      "",
      "## 步骤",
      "",
      "- [ ] P01 — 迁移后的原任务（需用户复核）",
      "  - 允许修改：**/*",
      "  - 验收：按下方原 v1 Plan 内容完成并由用户复核",
      "  <!-- OPENCODE REPORT P01 START -->",
      "  status: pending",
      "  comment:",
      "  evidence:",
      "  <!-- OPENCODE REPORT P01 END -->",
    ].join("\n");
  }
  if (!bullets(section(body, /^##\s+整个项目必须遵循的硬性规定\s*$/)).length) {
    body += [
      "",
      "## 整个项目必须遵循的硬性规定",
      "",
      "1. 迁移结果保持 draft，执行前必须由用户复核并批准。",
      "2. 不得 push、修改 Git remote 或写入工作区之外。",
      "3. OpenCode 不得直接修改 Plan 契约，只能通过受控报告接口更新进度。",
    ].join("\n");
  }
  const metadata = normalizeMetadata({
    ...split.metadata,
    schemaVersion: 2,
    task,
    workspace,
    status: "draft",
    planId: "",
    approvedAt: null,
    specHash: null,
    executionMode: split.metadata.executionMode === "batch" ? "batch" : "strict",
    batchSize: split.metadata.executionMode === "batch" ? Number(split.metadata.batchSize || 2) : 1,
  }, source);
  const output = path.resolve(args.outputPath || (args.inPlace ? source : source.replace(/\.md$/i, ".v2.md")));
  let backup: string | undefined;
  if (args.inPlace) {
    backup = `${source}.v1.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
  } else if (fs.existsSync(output)) {
    throw new Error(`migration_output_exists: ${output}`);
  }
  atomicWrite(output, serialize(metadata, body));
  const validation = validatePlan(output);
  if (!validation.ok) {
    if (!args.inPlace) fs.unlinkSync(output);
    else if (backup) atomicWrite(source, fs.readFileSync(backup, "utf8"));
    throw new Error(`migration_invalid: ${validation.errors.join("; ")}`);
  }
  return { source, output, backup, validation };
}

export function assertPlanIntegrity(planPath: string): ParsedPlanV2 {
  const plan = parsePlan(planPath);
  const lockPath = existingApprovalLockPath(planPath);
  if (!fs.existsSync(lockPath)) throw new Error(`plan_not_approved: ${planPath}`);
  const lock = readJson<{ planId: string; specHash: string }>(lockPath);
  if (!plan.metadata.specHash || plan.metadata.specHash !== plan.computedSpecHash) {
    throw new Error("plan_contract_modified: frontmatter hash mismatch");
  }
  if (lock.planId !== plan.metadata.planId || lock.specHash !== plan.computedSpecHash) {
    throw new Error("plan_contract_modified: approval lock mismatch");
  }
  return plan;
}

function replacePhaseCheckbox(raw: string, phaseId: string, checked: boolean): string {
  const pattern = new RegExp(`^- \\[([ xX])\\](\\s+${phaseId}\\s+[—-])`, "m");
  if (!pattern.test(raw)) throw new Error(`phase_not_found: ${phaseId}`);
  return raw.replace(pattern, `- [${checked ? "x" : " "}]$2`);
}

export function updateExecutorReport(
  planPath: string,
  phaseId: string,
  report: PhaseReport,
  checked: boolean,
): ParsedPlanV2 {
  const plan = assertPlanIntegrity(planPath);
  if (!plan.phases.some((phase) => phase.id === phaseId)) {
    throw new Error(`phase_not_found: ${phaseId}`);
  }
  const pattern = new RegExp(
    `^[ \\t]*<!-- OPENCODE REPORT ${phaseId} START -->[\\s\\S]*?^[ \\t]*<!-- OPENCODE REPORT ${phaseId} END -->`,
    "m",
  );
  if (!pattern.test(plan.raw)) throw new Error(`phase_report_block_missing: ${phaseId}`);
  const block = [
    `<!-- OPENCODE REPORT ${phaseId} START -->`,
    `  status: ${report.status}`,
    `  comment: ${report.comment.replace(/\s+/g, " ").trim()}`,
    `  evidence: ${report.evidence.map((item) => item.replace(/\s+/g, " ").trim()).join(" | ")}`,
    `  <!-- OPENCODE REPORT ${phaseId} END -->`,
  ].join("\n");
  const next = replacePhaseCheckbox(plan.raw.replace(pattern, block), phaseId, checked);
  atomicWrite(planPath, next);
  return assertPlanIntegrity(planPath);
}

export function updateCodexReview(planPath: string, verdict: ReviewVerdict): ParsedPlanV2 {
  const plan = assertPlanIntegrity(planPath);
  const phase = plan.phases.find((item) => item.id === verdict.phaseId);
  if (!phase) throw new Error(`phase_not_found: ${verdict.phaseId}`);
  const marker = new RegExp(
    `^[ \\t]*<!-- CODEX REVIEW ${verdict.phaseId} START -->[\\s\\S]*?^[ \\t]*<!-- CODEX REVIEW ${verdict.phaseId} END -->`,
    "m",
  );
  const review = [
    `  <!-- CODEX REVIEW ${verdict.phaseId} START -->`,
    `  verdict: ${verdict.verdict}`,
    `  summary: ${verdict.summary.replace(/\s+/g, " ").trim()}`,
    `  gaps: ${(verdict.gaps || []).map((item) => item.replace(/\s+/g, " ").trim()).join(" | ")}`,
    `  <!-- CODEX REVIEW ${verdict.phaseId} END -->`,
  ].join("\n");
  let next = plan.raw;
  if (marker.test(next)) {
    next = next.replace(marker, review);
  } else {
    const reportEnd = `  <!-- OPENCODE REPORT ${verdict.phaseId} END -->`;
    if (!next.includes(reportEnd)) throw new Error(`phase_report_block_missing: ${verdict.phaseId}`);
    next = next.replace(reportEnd, `${reportEnd}\n${review}`);
  }
  if (verdict.verdict !== "accept") {
    next = replacePhaseCheckbox(next, verdict.phaseId, false);
  }
  atomicWrite(planPath, next);
  return assertPlanIntegrity(planPath);
}

export function updatePlanLifecycle(planPath: string, status: PlanLifecycle): ParsedPlanV2 {
  const plan = assertPlanIntegrity(planPath);
  const split = splitFrontmatter(plan.raw);
  const metadata = { ...plan.metadata, status };
  atomicWrite(planPath, serialize(metadata, split.body));
  return assertPlanIntegrity(planPath);
}
