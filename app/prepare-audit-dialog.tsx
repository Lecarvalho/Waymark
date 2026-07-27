"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { buildPreparedAuditRequest } from "../src/orchestration/prepare-audit-request.mjs";
import type {
  ProviderCapabilities,
  ProviderCapability,
  ReasoningEffort,
} from "../src/orchestration/provider-capabilities.mjs";
import type {
  AuditTokenBudgets,
  TokenBudget,
} from "../src/orchestration/types";
import { useProviderCapabilities } from "./use-provider-capabilities";
import styles from "./prepare-audit-dialog.module.css";

function classes(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => styles[name as keyof typeof styles] ?? name)
    .join(" ");
}

type Role = "auditor" | "candidate" | "independent" | "orchestrator";
type BenchmarkRole = Exclude<Role, "auditor">;
type ParticipantSelection = {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort | "";
};
type ParticipantSelections = Record<Role, ParticipantSelection>;
type AuditMode = "general" | "task_specific" | "system_explanation";
type AuditorPermissionMode = "read_only" | "unrestricted_no_approval";

const roleLabels: Record<Role, string> = {
  auditor: "Auditor",
  candidate: "Candidate",
  independent: "Independent researcher",
  orchestrator: "Orchestrator",
};
const phaseLabels: Record<keyof AuditTokenBudgets, string> = {
  candidate_navigation: "Candidate navigation",
  independent_validation: "Independent validation",
  orchestration: "Orchestration",
  deterministic_verification: "Deterministic verification",
  report_generation: "Report generation",
};

function emptyParticipant(): ParticipantSelection {
  return { provider: "", model: "", reasoningEffort: "" };
}

function emptyParticipants(): ParticipantSelections {
  return {
    auditor: emptyParticipant(),
    candidate: emptyParticipant(),
    independent: emptyParticipant(),
    orchestrator: emptyParticipant(),
  };
}

function availableProviders(
  capabilities: ProviderCapabilities | null,
  role: Role,
) {
  return (
    capabilities?.providers.filter(
      (provider) => provider.available && provider.roles.includes(role),
    ) ?? []
  );
}

function selectedProvider(
  capabilities: ProviderCapabilities | null,
  selection: ParticipantSelection,
) {
  return (
    capabilities?.providers.find(
      (provider) => provider.id === selection.provider,
    ) ?? null
  );
}

function selectedModel(
  provider: ProviderCapability | null,
  selection: ParticipantSelection,
) {
  return (
    provider?.models.find((model) => model.id === selection.model) ?? null
  );
}

function defaultSelection(
  provider: ProviderCapability,
): ParticipantSelection {
  const model = provider.models[0];
  return {
    provider: provider.id,
    model: model?.id ?? "",
    reasoningEffort:
      model?.reasoningEfforts.includes("medium") === true
        ? "medium"
        : (model?.reasoningEfforts[0] ?? ""),
  };
}

function cloneBudgets(value: AuditTokenBudgets): AuditTokenBudgets {
  return Object.fromEntries(
    Object.entries(value).map(([phase, budget]) => [
      phase,
      { ...budget },
    ]),
  ) as unknown as AuditTokenBudgets;
}

function validateForm(input: {
  targetRepositoryPath: string;
  auditMode: AuditMode;
  task: string;
  participants: ParticipantSelections;
  activeRoles: readonly Role[];
  tokenBudgets: AuditTokenBudgets | null;
  softUsageNoticeTokens: number | null;
}) {
  const errors: string[] = [];
  if (input.targetRepositoryPath.trim() === "") {
    errors.push("Enter the target repository path.");
  }
  if (input.auditMode !== "general" && input.task.trim() === "") {
    errors.push(
      input.auditMode === "system_explanation"
        ? "Enter the system behavior the agent should explain."
        : "Enter the engineering task used as the navigation probe.",
    );
  }
  for (const role of input.activeRoles) {
    const selection = input.participants[role];
    if (
      selection.provider === "" ||
      selection.model === "" ||
      selection.reasoningEffort === ""
    ) {
      errors.push(`Choose provider, model, and reasoning for ${roleLabels[
        role
      ].toLowerCase()}.`);
    }
  }
  if (
    input.auditMode === "general" &&
    input.softUsageNoticeTokens !== null &&
    (!Number.isSafeInteger(input.softUsageNoticeTokens) ||
      input.softUsageNoticeTokens < 1)
  ) {
    errors.push(
      "The optional soft usage notice must be a positive token count.",
    );
  } else if (input.auditMode !== "general" && input.tokenBudgets === null) {
    errors.push("Token budgets are not available.");
  } else if (input.auditMode !== "general" && input.tokenBudgets !== null) {
    for (const [phase, budget] of Object.entries(input.tokenBudgets)) {
      if (
        !Number.isSafeInteger(budget.targetTokens) ||
        budget.targetTokens < 1
      ) {
        errors.push(`${phaseLabels[phase as keyof AuditTokenBudgets]} needs a positive target.`);
      }
      if (
        !Number.isSafeInteger(budget.hardLimitTokens) ||
        budget.hardLimitTokens < budget.targetTokens
      ) {
        errors.push(
          `${phaseLabels[phase as keyof AuditTokenBudgets]} hard limit must be at least its target.`,
        );
      }
    }
  }
  return errors;
}

export function PrepareAuditDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const repositoryInput = useRef<HTMLInputElement>(null);
  const [targetRepositoryPath, setTargetRepositoryPath] = useState("");
  const [auditMode, setAuditMode] = useState<AuditMode>("task_specific");
  const {
    capabilities,
    databasePath,
    serviceUrl,
    state: capabilityState,
  } = useProviderCapabilities(auditMode);
  const [task, setTask] = useState("");
  const [participants, setParticipants] =
    useState<ParticipantSelections>(emptyParticipants);
  const [tokenBudgets, setTokenBudgets] =
    useState<AuditTokenBudgets | null>(null);
  const [softUsageNoticeTokens, setSoftUsageNoticeTokens] =
    useState<number | null>(null);
  const [auditorPermissionMode, setAuditorPermissionMode] =
    useState<AuditorPermissionMode>("read_only");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const selectedAuditMode =
    capabilities?.auditModes.find((mode) => mode.id === auditMode) ?? null;
  const activeRoles = useMemo<readonly Role[]>(
    () =>
      selectedAuditMode?.participantRoles ??
      (auditMode === "general"
        ? ["auditor"]
        : ["candidate", "independent", "orchestrator"]),
    [auditMode, selectedAuditMode],
  );

  const resolvedParticipants = useMemo(() => {
    if (!capabilities) {
      return participants;
    }
    const resolved = { ...participants };
    for (const role of activeRoles) {
      const current = participants[role];
      const currentProvider = availableProviders(capabilities, role).find(
        ({ id }) => id === current.provider,
      );
      const currentModel = currentProvider?.models.find(
        ({ id }) => id === current.model,
      );
      if (
        currentProvider &&
        currentModel &&
        currentModel.reasoningEfforts.includes(
          current.reasoningEffort as ReasoningEffort,
        )
      ) {
        continue;
      }
      const provider = availableProviders(capabilities, role)[0];
      resolved[role] = provider
        ? defaultSelection(provider)
        : emptyParticipant();
    }
    return resolved;
  }, [activeRoles, capabilities, participants]);
  const resolvedTokenBudgets = useMemo(
    () =>
      tokenBudgets ??
      (capabilities
        ? cloneBudgets(capabilities.tokenBudgetDefaults)
        : null),
    [capabilities, tokenBudgets],
  );

  const errors = useMemo(
    () =>
      validateForm({
        targetRepositoryPath,
        auditMode,
        task,
        participants: resolvedParticipants,
        activeRoles,
        tokenBudgets: resolvedTokenBudgets,
        softUsageNoticeTokens,
      }),
    [
      targetRepositoryPath,
      auditMode,
      task,
      resolvedParticipants,
      activeRoles,
      resolvedTokenBudgets,
      softUsageNoticeTokens,
    ],
  );

  const prompt = useMemo(() => {
    if (
      errors.length > 0 ||
      (auditMode !== "general" && resolvedTokenBudgets === null)
    ) {
      return "";
    }
    const base = {
      targetRepositoryPath,
      journalPath: databasePath ?? "",
      serviceUrl,
      task,
    };
    if (auditMode === "general") {
      return buildPreparedAuditRequest({
        ...base,
        auditMode,
        participants: {
          auditor: resolvedParticipants.auditor as ParticipantSelection & {
            reasoningEffort: ReasoningEffort;
          },
        },
        tokenPolicy: "unbounded_by_waymark",
        softUsageNoticeTokens,
        auditorPermissionMode,
      });
    }
    return buildPreparedAuditRequest({
      ...base,
      auditMode,
      participants: Object.fromEntries(
        activeRoles.map((role) => [role, resolvedParticipants[role]]),
      ) as Record<
        BenchmarkRole,
        ParticipantSelection & { reasoningEffort: ReasoningEffort }
      >,
      tokenBudgets: resolvedTokenBudgets as AuditTokenBudgets,
    });
  }, [
    errors.length,
    targetRepositoryPath,
    databasePath,
    serviceUrl,
    auditMode,
    task,
    resolvedParticipants,
    activeRoles,
    resolvedTokenBudgets,
    softUsageNoticeTokens,
    auditorPermissionMode,
  ]);

  const open = () => {
    setCopyState("idle");
    dialog.current?.showModal();
    requestAnimationFrame(() => repositoryInput.current?.focus());
  };

  const close = () => dialog.current?.close();

  const updateParticipant = (
    role: Role,
    field: keyof ParticipantSelection,
    value: string,
  ) => {
    setCopyState("idle");
    setParticipants(() => {
      const base = resolvedParticipants;
      const currentSelection = base[role];
      if (field === "provider") {
        const provider =
          capabilities?.providers.find((item) => item.id === value) ?? null;
        return {
          ...base,
          [role]: provider ? defaultSelection(provider) : emptyParticipant(),
        };
      }
      if (field === "model") {
        const provider = selectedProvider(capabilities, currentSelection);
        const model =
          provider?.models.find((item) => item.id === value) ?? null;
        return {
          ...base,
          [role]: {
            ...currentSelection,
            model: value,
            reasoningEffort:
              model?.reasoningEfforts.includes("medium") === true
                ? "medium"
                : (model?.reasoningEfforts[0] ?? ""),
          },
        };
      }
      return {
        ...base,
        [role]: { ...currentSelection, [field]: value },
      };
    });
  };

  const updateBudget = (
    phase: keyof AuditTokenBudgets,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = Number(event.target.value);
    setCopyState("idle");
    setTokenBudgets((current) => {
      const base = current ?? resolvedTokenBudgets;
      return base === null
        ? null
        : {
            ...base,
            [phase]: { ...base[phase], hardLimitTokens: value },
          };
    });
  };

  const copyPrompt = async () => {
    if (prompt === "") return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <>
      <button
        className={classes("prepare-audit-trigger")}
        onClick={open}
        ref={trigger}
        type="button"
      >
        Prepare audit request
      </button>

      <dialog
        aria-labelledby="prepare-audit-title"
        className={classes("prepare-audit-dialog")}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <form className={classes("prepare-audit-frame")} method="dialog">
          <header className={classes("prepare-audit-heading")}>
            <div>
              <span className={classes("section-kicker")}>Preparation only</span>
              <h2 id="prepare-audit-title">Prepare an audit request</h2>
              <p>
                Build a prompt for your paired coding agent. Nothing here
                creates a run, invokes a model, or writes to the audit journal.
              </p>
            </div>
            <button
              aria-label="Close audit request"
              className={classes("prepare-audit-close")}
              onClick={close}
              type="button"
            >
              ×
            </button>
          </header>

          <div className={classes("prepare-audit-scroll")}>
            <section
              aria-labelledby="audit-request-scope"
              className={classes("prepare-section")}
            >
              <div className={classes("prepare-section-heading")}>
                <span>01</span>
                <div>
                  <h3 id="audit-request-scope">Scope</h3>
                  <p>
                    Identify the target and record its starting point for
                    provenance.
                  </p>
                </div>
              </div>
              <div className={classes("prepare-field-grid")}>
                <label className={classes("prepare-field")} data-span="wide">
                  <span>Target repository path</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => {
                      setCopyState("idle");
                      setTargetRepositoryPath(event.target.value);
                    }}
                    placeholder="C:\path\to\repository"
                    ref={repositoryInput}
                    value={targetRepositoryPath}
                  />
                </label>
                {databasePath && (
                  <p className={classes("prepare-mode-note")}>
                    This request will reuse the running service at {serviceUrl}
                    {" "}and append its run to <code>{databasePath}</code>.
                  </p>
                )}
                <label className={classes("prepare-field")} data-span="wide">
                  <span>Audit mode</span>
                  <select
                    onChange={(event) => {
                      setCopyState("idle");
                      setTokenBudgets(null);
                      setSoftUsageNoticeTokens(null);
                      setAuditMode(event.target.value as AuditMode);
                    }}
                    value={auditMode}
                  >
                    {capabilities?.auditModes.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.label}
                      </option>
                    )) ?? (
                      <>
                        <option value="task_specific">
                          Task-specific audit
                        </option>
                        <option value="general">
                          General repository audit
                        </option>
                        <option value="system_explanation">
                          System explanation
                        </option>
                      </>
                    )}
                  </select>
                </label>
                {auditMode !== "general" ? (
                  <label className={classes("prepare-field")} data-span="wide">
                    <span>
                      {selectedAuditMode?.probeLabel ??
                        (auditMode === "system_explanation"
                          ? "What should the agent find?"
                          : "Engineering task used as the probe")}
                    </span>
                    {auditMode === "system_explanation" ? (
                      <input
                        autoComplete="off"
                        onChange={(event) => {
                          setCopyState("idle");
                          setTask(event.target.value);
                        }}
                        placeholder={
                          selectedAuditMode?.probePlaceholder ??
                          "How are refunds approved?"
                        }
                        value={task}
                      />
                    ) : (
                      <textarea
                        onChange={(event) => {
                          setCopyState("idle");
                          setTask(event.target.value);
                        }}
                        placeholder={
                          selectedAuditMode?.probePlaceholder ??
                          "Add partial refunds with manager approval and idempotency."
                        }
                        rows={3}
                        value={task}
                      />
                    )}
                    <small>
                      {selectedAuditMode?.description ??
                        (auditMode === "system_explanation"
                          ? "Measures the navigation cost of finding a supported answer about existing behavior."
                          : "Measures navigation for a realistic engineering change without implementing it.")}
                    </small>
                  </label>
                ) : (
                  <>
                    <p className={classes("prepare-mode-note")}>
                      {selectedAuditMode?.description ??
                        "Broad, evidence-led repository research by one auditor."}{" "}
                      No feature request or benchmark task suite is needed.
                    </p>
                    <label
                      className={classes("prepare-field")}
                      data-span="wide"
                    >
                      <span>Auditor permissions</span>
                      <select
                        onChange={(event) => {
                          setCopyState("idle");
                          setAuditorPermissionMode(
                            event.target.value as AuditorPermissionMode,
                          );
                        }}
                        value={auditorPermissionMode}
                      >
                        <option value="read_only">Read-only sandbox</option>
                        <option value="unrestricted_no_approval">
                          Full access · no approval prompts
                        </option>
                      </select>
                      <small>
                        Full access lets the auditor run arbitrary commands and
                        use network access, but it is still instructed never to
                        change the target repository. Select it only for
                        repositories and machines you trust.
                      </small>
                    </label>
                  </>
                )}
              </div>
            </section>

            <section
              aria-labelledby="audit-request-participants"
              className={classes("prepare-section")}
            >
              <div className={classes("prepare-section-heading")}>
                <span>02</span>
                <div>
                  <h3 id="audit-request-participants">Participants</h3>
                  <p>
                    Choices come from installed adapter capabilities reported
                    by the local service.
                  </p>
                </div>
              </div>
              {capabilityState === "loading" ? (
                <p className={classes("prepare-capability-state")} role="status">
                  Reading local adapter capabilities…
                </p>
              ) : capabilityState === "unavailable" ? (
                <p
                  className={classes("prepare-capability-state")}
                  data-status="error"
                  role="status"
                >
                  Local adapter capabilities are unavailable. Start the Waymark
                  local service to prepare a request.
                </p>
              ) : capabilities?.providers.some(
                  (provider) => provider.available,
                ) !== true ? (
                <div
                  className={classes("prepare-capability-state")}
                  data-status="error"
                  role="status"
                >
                  <strong>No provider adapter is ready.</strong>
                  {capabilities?.providers.map((provider) => (
                    <span key={provider.id}>
                      {provider.label}: {provider.unavailableReason}
                    </span>
                  ))}
                </div>
              ) : (
                <div className={classes("participant-config-list")}>
                  {activeRoles.map((role) => {
                    const selection = resolvedParticipants[role];
                    const provider = selectedProvider(
                      capabilities,
                      selection,
                    );
                    const model = selectedModel(provider, selection);
                    return (
                      <fieldset className={classes("participant-config")} key={role}>
                        <legend>{roleLabels[role]}</legend>
                        <label className={classes("prepare-field")}>
                          <span>Provider</span>
                          <select
                            onChange={(event) =>
                              updateParticipant(
                                role,
                                "provider",
                                event.target.value,
                              )
                            }
                            value={selection.provider}
                          >
                            {availableProviders(capabilities, role).map(
                              (item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label className={classes("prepare-field")}>
                          <span>Model</span>
                          <select
                            onChange={(event) =>
                              updateParticipant(
                                role,
                                "model",
                                event.target.value,
                              )
                            }
                            value={selection.model}
                          >
                            {provider?.models.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={classes("prepare-field")}>
                          <span>Reasoning</span>
                          <select
                            onChange={(event) =>
                              updateParticipant(
                                role,
                                "reasoningEffort",
                                event.target.value,
                              )
                            }
                            value={selection.reasoningEffort}
                          >
                            {model?.reasoningEfforts.map((effort) => (
                              <option key={effort} value={effort}>
                                {effort}
                              </option>
                            ))}
                          </select>
                        </label>
                      </fieldset>
                    );
                  })}
                </div>
              )}
            </section>

            <section
              aria-labelledby="audit-request-budget"
              className={classes("prepare-section")}
            >
              {auditMode === "general" ? (
                <div className={classes("prepare-advanced general-token-policy")}>
                  <div id="audit-request-budget">
                    <strong>Auditor token usage</strong>
                    <span>Measured without a Waymark stopping threshold</span>
                  </div>
                  <p className={classes("budget-config-note")}>
                    General research is unbounded by Waymark. You may set a
                    soft notice for visibility; it does not stop the auditor or
                    determine report validity.
                  </p>
                  <label className={classes("prepare-field")}>
                    <span>Optional soft usage notice</span>
                    <input
                      min={1}
                      onChange={(event) => {
                        setCopyState("idle");
                        setSoftUsageNoticeTokens(
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                        );
                      }}
                      placeholder="No notice"
                      step={1000}
                      type="number"
                      value={softUsageNoticeTokens ?? ""}
                    />
                  </label>
                </div>
              ) : (
                <details className={classes("prepare-advanced")}>
                <summary id="audit-request-budget">
                  Advanced token budgets
                  <span>Automatic targets · editable hard limits</span>
                </summary>
                {resolvedTokenBudgets && (
                  <div>
                    <p className={classes("budget-config-note")}>
                      Targets may decrease from completed audits of this probe
                      type, but history never raises the safe rubric defaults.
                      Waymark reserves enough room to replay the current
                      context and return a partial report if exploration runs
                      long.
                    </p>
                    <div className={classes("budget-config-list")}>
                      {(
                        Object.entries(resolvedTokenBudgets) as Array<
                          [keyof AuditTokenBudgets, TokenBudget]
                        >
                      ).map(([phase, budget]) => {
                        const basis = capabilities?.tokenBudgetBasis[phase];
                        return (
                          <div className={classes("budget-config-row")} key={phase}>
                            <strong>{phaseLabels[phase]}</strong>
                            <div className={classes("budget-target-baseline")}>
                              <span>Automatic target</span>
                              <strong>
                                {budget.targetTokens.toLocaleString()}
                              </strong>
                              <small>
                                {basis?.source === "historical_average"
                                  ? !basis.usedForTarget
                                    ? `Historical average ${basis.historicalAverageTokens?.toLocaleString()} from ${basis.sampleSize} completed ${
                                        basis.sampleSize === 1 ? "run" : "runs"
                                      } · safe default retained until ${basis.minimumSampleSize} runs`
                                    : basis.cappedToRubricDefault
                                      ? `Historical average ${basis.historicalAverageTokens?.toLocaleString()} from ${basis.sampleSize} completed runs · capped at the safe default`
                                    : `Average of ${basis.sampleSize} completed ${
                                        basis.sampleSize === 1 ? "run" : "runs"
                                      }`
                                  : "Default until a completed run is available"}
                              </small>
                            </div>
                            <label className={classes("prepare-field")}>
                              <span>Hard limit · includes report reserve</span>
                              <input
                                min={budget.targetTokens}
                                onChange={(event) =>
                                  updateBudget(phase, event)
                                }
                                step={1000}
                                type="number"
                                value={budget.hardLimitTokens}
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                </details>
              )}
            </section>

            <section
              aria-labelledby="audit-request-preview"
              className={classes("prepare-section")}
            >
              <div className={classes("prepare-section-heading")}>
                <span>03</span>
                <div>
                  <h3 id="audit-request-preview">Prompt preview</h3>
                  <p>
                    Only selected runtime inputs; fixed policy comes from the
                    repository-local skill.
                  </p>
                </div>
              </div>
              {errors.length > 0 ? (
                <div
                  aria-live="polite"
                  className={classes("prepare-validation")}
                  role="status"
                >
                  <strong>Complete the request to generate its prompt.</strong>
                  <ul>
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <textarea
                  aria-label="Generated audit request"
                  className={classes("prompt-preview")}
                  readOnly
                  rows={12}
                  value={prompt}
                />
              )}
            </section>
          </div>

          <footer className={classes("prepare-audit-footer")}>
            <p aria-live="polite">
              {copyState === "copied"
                ? "Copied. Paste it into the paired coding-agent session; no audit was started."
                : copyState === "failed"
                  ? "Copy failed. Select the preview text and copy it manually."
                  : "Preparation stays outside the audit journal."}
            </p>
            <div>
              <button
                className={classes("prepare-cancel")}
                onClick={close}
                type="button"
              >
                Cancel
              </button>
              <button
                className={classes("prepare-copy")}
                disabled={prompt === ""}
                onClick={copyPrompt}
                type="button"
              >
                Copy audit request
              </button>
            </div>
          </footer>
        </form>
      </dialog>
    </>
  );
}
