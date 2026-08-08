import type { ParsedPlanV2, RunStateV2 } from "./types.js";

const STOP_STATES = new Set(["blocked", "attempt_failed", "review_failed"]);

export function dependenciesAccepted(
  run: RunStateV2,
  dependencies: string[],
): boolean {
  return dependencies.every((id) => run.phases[id]?.status === "accepted");
}

/** Compute the only phases the executor may act on right now. */
export function computeAuthorizedWindow(
  plan: ParsedPlanV2,
  run: RunStateV2,
): string[] {
  if (run.status !== "running") return [];
  const phases = plan.phases;
  const firstUnaccepted = phases.findIndex(
    (phase) => !["accepted", "skipped"].includes(run.phases[phase.id]?.status),
  );
  if (firstUnaccepted < 0) return [];
  const firstRuntime = run.phases[phases[firstUnaccepted].id];
  if (!firstRuntime || STOP_STATES.has(firstRuntime.status)) return [];
  if (["implemented", "reviewing"].includes(firstRuntime.status)) return [];

  const limit = run.executionMode === "batch" ? run.batchSize : 1;
  const out: string[] = [];
  for (let index = firstUnaccepted; index < phases.length && out.length < limit; index++) {
    const phase = phases[index];
    const runtime = run.phases[phase.id];
    if (!runtime || STOP_STATES.has(runtime.status)) break;
    if (["implemented", "reviewing"].includes(runtime.status)) break;
    const dependenciesSatisfied = phase.dependencies.every((dependency) => {
      if (run.phases[dependency]?.status === "accepted") return true;
      return out.includes(dependency);
    });
    if (!dependenciesSatisfied) break;
    if (["pending", "ready", "running"].includes(runtime.status)) out.push(phase.id);
  }
  return out;
}

export function allPhasesAccepted(run: RunStateV2): boolean {
  const values = Object.values(run.phases);
  return values.length > 0 && values.every((phase) => phase.status === "accepted" || phase.status === "skipped");
}
