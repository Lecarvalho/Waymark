import { readFileSync } from "node:fs";

const codexCliMode = process.argv[2] === "exec";
const mode =
  process.env.WAYMARK_FAKE_MODE ??
  (codexCliMode ? "success" : (process.argv[2] ?? "success"));
const role = process.env.WAYMARK_FAKE_ROLE ?? (codexCliMode
  ? process.argv.some((argument) =>
      argument.includes("orchestration-output.schema.json"),
    )
    ? "orchestrator"
    : "candidate"
  : (process.argv[3] ?? "candidate"));
const suppliedClaimId = codexCliMode ? undefined : process.argv[4];
const prompt = readFileSync(0, "utf8");
const delayedReportMode = mode === "report-only-delayed";
const commandOverBudgetMode = [
  "command-over-budget",
  "command-over-budget-await",
  "early-output-command-over-budget-await",
].includes(mode);

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

emit({ type: "thread.started", thread_id: `fresh-${role}` });
emit({ type: "turn.started" });

async function postCheckpoint(value) {
  const response = await fetch(process.env.WAYMARK_CHECKPOINT_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: process.env.WAYMARK_CHECKPOINT_AUTHORIZATION,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
  const acknowledgement = await response.json();
  emit({
    type: "waymark.checkpoint.response",
    status: response.status,
    acknowledgement,
  });
  if (!response.ok) {
    throw new Error(
      `checkpoint rejected: ${acknowledgement.error?.code ?? response.status}`,
    );
  }
  return acknowledgement;
}

function generalCheckpointBase() {
  return {
    runId: process.env.WAYMARK_CHECKPOINT_RUN_ID,
    actor: process.env.WAYMARK_CHECKPOINT_ACTOR,
    providerSessionId: `fresh-${role}`,
  };
}

const generalDimensions = [
  "discoveryEfficiency",
  "ownershipClarity",
  "dependencyClarity",
  "changeSurfaceRecall",
  "verificationDiscoverability",
  "instructionQuality",
];
const generalPractices = [
  "organizeAroundBehavior",
  "explicitDependencyDirection",
  "conceptOwningNames",
  "canonicalWorkflow",
  "proximateInstructions",
  "testsMirrorBehavior",
  "separateGeneratedExternal",
];
const generalCodeCitation = {
  path: "src/orchestration/general-audit-runner.mjs",
  startLine: 1,
  endLine: 20,
  symbol: null,
  source: "production_code",
};
const generalTestCitation = {
  path: "tests/orchestration.test.mjs",
  startLine: 1,
  endLine: 20,
  symbol: null,
  source: "test",
};

async function postGeneralFinding({
  id,
  signal,
  title,
  conclusion,
  occurredAt,
}) {
  const base = generalCheckpointBase();
  await postCheckpoint({
    ...base,
    idempotencyKey: `fake-${id}`,
    type: "general.finding.recorded",
    occurredAt,
    payload: {
      revision: {
        revisionId: `${id}-revision-1`,
        findingId: id,
        revisionNumber: 1,
        state: "confirmed",
        signal,
        title,
        conclusion,
        dimensionIds: generalDimensions,
        practiceGuideIds: generalPractices,
        citations: [generalCodeCitation, generalTestCitation],
        navigationCost: {
          searches: 2,
          filesOpened: 4,
          fileHops: 2,
          deadEnds: signal === "friction" ? 1 : 0,
          commands: 3,
          processedTokens: 1200,
          elapsedMs: 40000,
        },
        provenance: {
          previousRevisionId: null,
          amendmentReason: null,
          actor: base.actor,
          occurredAt,
          causedByCitations: [generalCodeCitation, generalTestCitation],
        },
      },
    },
  });
}

if (mode === "general-final-fallback") {
  const actor = process.env.WAYMARK_CHECKPOINT_ACTOR;
  const occurredAt = "2026-07-25T15:00:00.000Z";
  const findingPayload = {
    revision: {
      revisionId: "fallback-revision-1",
      findingId: "fallback-live-evidence",
      revisionNumber: 1,
      state: "confirmed",
      signal: "positive",
      title: "Final output preserved unpublished evidence",
      conclusion:
        "A structured fallback retained evidence when live publication was unavailable.",
      dimensionIds: ["discoveryEfficiency"],
      practiceGuideIds: ["canonicalWorkflow"],
      citations: [generalCodeCitation],
      navigationCost: {
        searches: 1,
        filesOpened: 1,
        fileHops: 0,
        deadEnds: 0,
        commands: 1,
        processedTokens: 500,
        elapsedMs: 1000,
      },
      provenance: {
        previousRevisionId: null,
        amendmentReason: null,
        actor,
        occurredAt,
        causedByCitations: [generalCodeCitation],
      },
    },
  };
  emit({
    type: "item.completed",
    item: {
      id: "auditor-fallback-message",
      type: "agent_message",
      text: JSON.stringify({
        unpublishedCheckpoints: [
          {
            idempotencyKey: "fallback-finding",
            type: "general.finding.recorded",
            occurredAt,
            payloadJson: JSON.stringify(findingPayload),
          },
          {
            idempotencyKey: "fallback-synthesis",
            type: "general.synthesis.completed",
            occurredAt: "2026-07-25T15:01:00.000Z",
            payloadJson: JSON.stringify({
              outcome: "partial",
              summary: "Recovered unpublished checkpoints from final output.",
              limitations: ["The live checkpoint channel was unavailable."],
            }),
          },
        ],
      }),
    },
  });
  emit({
    type: "turn.completed",
    usage: {
      input_tokens: 1200,
      cached_input_tokens: 100,
      output_tokens: 300,
    },
  });
  process.exit(0);
}

if (
  [
    "general-completed",
    "general-partial-crash",
    "general-no-progress",
    "general-continuation",
    "general-interleaved-command-results",
  ].includes(mode)
) {
  await new Promise((resolve) => setTimeout(resolve, 25));
  await postGeneralFinding({
    id: "fake-general-positive",
    signal: "positive",
    title: "The audit runner has a focused owner",
    conclusion:
      "The general runner and its tests expose a direct ownership path.",
    occurredAt: "2026-07-25T15:00:00.000Z",
  });

  if (mode === "general-partial-crash") {
    process.stderr.write("simulated general provider crash after a finding");
    process.exit(7);
  }

  if (mode === "general-no-progress") {
    for (let index = 0; index < 6; index += 1) {
      const item = {
        id: `general-repeat-${index}`,
        type: "command_execution",
        command: "rg --files",
        status: "in_progress",
      };
      emit({ type: "item.started", item });
      emit({
        type: "item.completed",
        item: { ...item, status: "completed", exit_code: 0 },
      });
    }
    setInterval(() => {}, 10_000);
    await new Promise(() => {});
  }

  if (mode === "general-interleaved-command-results") {
    const results = [
      { command: "Get-ChildItem Env:", status: "declined", exit_code: -1 },
      {
        command: "Get-Content -LiteralPath README.md",
        status: "completed",
        exit_code: 0,
      },
      { command: "rg missing-term .", status: "failed", exit_code: 1 },
      {
        command: "Get-ChildItem Env: | Where-Object Name",
        status: "declined",
        exit_code: -1,
      },
    ];
    for (const [index, result] of results.entries()) {
      const item = {
        id: `general-result-${index}`,
        type: "command_execution",
        command: result.command,
        status: "in_progress",
      };
      emit({ type: "item.started", item });
      emit({
        type: "item.completed",
        item: {
          ...item,
          status: result.status,
          exit_code: result.exit_code,
        },
      });
    }
  }

  if (
    mode === "general-continuation" &&
    !prompt.includes("Continuation state")
  ) {
    setInterval(() => {}, 10_000);
    await new Promise(() => {});
  }

  if (mode === "general-completed") {
    await postGeneralFinding({
      id: "fake-general-friction",
      signal: "friction",
      title: "One navigation edge remains indirect",
      conclusion:
        "The fixture preserves one cited file hop to exercise mixed evidence.",
      occurredAt: "2026-07-25T15:01:00.000Z",
    });
    for (const [index, dimensionId] of generalDimensions.entries()) {
      await postCheckpoint({
        ...generalCheckpointBase(),
        idempotencyKey: `fake-assessment-${dimensionId}`,
        type: "general.dimension.assessed",
        occurredAt: `2026-07-25T15:0${index + 2}:00.000Z`,
        payload: {
          dimensionId,
          score: 80 + index,
          confidence: 0.9,
          supportingPositiveFindingIds: ["fake-general-positive"],
          supportingFrictionFindingIds: ["fake-general-friction"],
          limitations: ["Controlled fake-provider evidence."],
        },
      });
    }
    await postCheckpoint({
      ...generalCheckpointBase(),
      idempotencyKey: "fake-recommendation",
      type: "general.recommendation.recorded",
      occurredAt: "2026-07-25T15:09:00.000Z",
      payload: {
        recommendationId: "fake-recommendation",
        title: "Make the indirect edge explicit",
        rationale: "The cited hop requires extra repository navigation.",
        findingIds: ["fake-general-friction"],
        dimensionIds: generalDimensions,
        practiceGuideIds: generalPractices,
        tokenMechanism: "Removes a repeated file hop and search.",
        validationCheck: "Repeat both behavior paths and compare navigation steps.",
        limitations: ["Controlled fixture recommendation."],
      },
    });
    await postCheckpoint({
      ...generalCheckpointBase(),
      idempotencyKey: "fake-friction-disposition",
      type: "general.friction.disposition.recorded",
      occurredAt: "2026-07-25T15:09:30.000Z",
      payload: {
        findingId: "fake-general-friction",
        disposition: "covered",
        recommendationId: "fake-recommendation",
        reason: null,
      },
    });
    for (const [index, principleId] of generalPractices.entries()) {
      await postCheckpoint({
        ...generalCheckpointBase(),
        idempotencyKey: `fake-practice-${principleId}`,
        type: "general.practice.assessed",
        occurredAt: `2026-07-25T15:${10 + index}:00.000Z`,
        payload: {
          principleId,
          assessment: "mixed",
          summary: `Controlled repository-specific assessment for ${principleId}.`,
          surfacesInspected: ["production_code", "tests", "workflows"],
          supportingPositiveFindingIds: ["fake-general-positive"],
          supportingFrictionFindingIds: ["fake-general-friction"],
          limitations: ["Controlled fake-provider evidence."],
          navigationTokenMechanism: "The explicit path reduces repeated retrieval.",
          recommendationIds: ["fake-recommendation"],
          workflowEntryPoints:
            principleId === "canonicalWorkflow"
              ? ["README: npm test", "package.json: npm test"]
              : [],
          workflowConclusion:
            principleId === "canonicalWorkflow"
              ? "The documented entry points converge on npm test."
              : null,
        },
      });
    }
    const knownNode = (label) => ({
      status: "known",
      label,
      citations: [generalCodeCitation],
    });
    for (let index = 1; index <= 2; index += 1) {
      await postCheckpoint({
        ...generalCheckpointBase(),
        idempotencyKey: `fake-path-${index}`,
        type: "general.behavior_path.recorded",
        occurredAt: `2026-07-25T15:1${index}:00.000Z`,
        payload: {
          pathId: `fake-path-${index}`,
          name: `Representative path ${index}`,
          entryPoint: knownNode("entry"),
          owner: knownNode("owner"),
          dependencies: [knownNode("dependency")],
          consumers: [knownNode("consumer")],
          tests: [
            {
              status: "known",
              label: "test",
              citations: [generalTestCitation],
            },
          ],
        },
      });
    }
    await postCheckpoint({
      ...generalCheckpointBase(),
      idempotencyKey: "fake-general-synthesis",
      type: "general.synthesis.completed",
      occurredAt: "2026-07-25T15:20:00.000Z",
      payload: {
        outcome: "completed",
        summary: "All required dimensions have adequate cited evidence.",
        limitations: ["Controlled fake-provider evidence."],
      },
    });
  } else {
    await postCheckpoint({
      ...generalCheckpointBase(),
      idempotencyKey: "fake-general-continuation-synthesis",
      type: "general.synthesis.completed",
      occurredAt: "2026-07-25T15:20:00.000Z",
      payload: {
        outcome: "partial",
        summary: "Acknowledged evidence survived provider continuation.",
        limitations: ["Several dimensions remain unassessed."],
      },
    });
  }

  emit({
    type: "turn.completed",
    usage: {
      input_tokens: mode === "general-completed" ? 120000 : 1200,
      cached_input_tokens: 100,
      output_tokens: mode === "general-completed" ? 80000 : 300,
    },
  });
  process.exit(0);
}

if (
  ["checkpoint-crash", "checkpoint-crash-duplicate"].includes(mode)
) {
  await new Promise((resolve) => setTimeout(resolve, 25));
  const runId = process.env.WAYMARK_CHECKPOINT_RUN_ID;
  const actor = process.env.WAYMARK_CHECKPOINT_ACTOR;
  const providerSessionId = `fresh-${role}`;
  const base = {
    runId,
    actor,
    providerSessionId,
  };
  await postCheckpoint({
    ...base,
    idempotencyKey: "fake-start",
    type: "general.audit.started",
    occurredAt: "2026-07-25T14:00:00.000Z",
    payload: {
      repositoryIdentity: process.env.WAYMARK_FAKE_REPOSITORY_IDENTITY,
      commitSha: process.env.WAYMARK_FAKE_COMMIT_SHA,
      protocolVersion: process.env.WAYMARK_FAKE_PROTOCOL_VERSION,
    },
  });
  const citation = {
    path: "src/refunds/refund-service.ts",
    startLine: 10,
    endLine: 30,
    symbol: "RefundService",
    source: "production_code",
  };
  const finding = {
    ...base,
    idempotencyKey: "fake-finding",
    type: "general.finding.recorded",
    occurredAt: "2026-07-25T14:01:00.000Z",
    payload: {
      revision: {
        revisionId: "fake-revision-1",
        findingId: "fake-refund-owner",
        revisionNumber: 1,
        state: "provisional",
        signal: "friction",
        title: "Refund owner was not immediately discoverable",
        conclusion: "Initial ownership searches did not locate the owner.",
        dimensionIds: ["discoveryEfficiency", "ownershipClarity"],
        practiceGuideIds: ["conceptOwningNames"],
        citations: [citation],
        navigationCost: {
          searches: 4,
          filesOpened: 7,
          fileHops: 3,
          deadEnds: 2,
          commands: 5,
          processedTokens: 1800,
          elapsedMs: 92000,
        },
        provenance: {
          previousRevisionId: null,
          amendmentReason: null,
          actor,
          occurredAt: "2026-07-25T14:01:00.000Z",
          causedByCitations: [citation],
        },
      },
    },
  };
  await postCheckpoint(finding);
  if (mode === "checkpoint-crash-duplicate") {
    await postCheckpoint(finding);
  }
  await postCheckpoint({
    ...base,
    idempotencyKey: "fake-revision",
    type: "general.finding.revised",
    occurredAt: "2026-07-25T14:02:00.000Z",
    payload: {
      revision: {
        revisionId: "fake-revision-2",
        findingId: "fake-refund-owner",
        revisionNumber: 2,
        state: "located_late",
        signal: "friction",
        title: "Refund owner exists but was located late",
        conclusion:
          "The owner exists, but required four searches and three file hops.",
        dimensionIds: ["discoveryEfficiency", "ownershipClarity"],
        practiceGuideIds: ["conceptOwningNames"],
        citations: [citation],
        navigationCost: null,
        provenance: {
          previousRevisionId: "fake-revision-1",
          amendmentReason: "A later consumer trace exposed the owner.",
          actor,
          occurredAt: "2026-07-25T14:02:00.000Z",
          causedByCitations: [
            {
              ...citation,
              path: "src/refunds/refund-router.ts",
            },
          ],
        },
      },
    },
  });
  process.stderr.write("simulated provider crash after acknowledged checkpoints");
  process.exit(7);
}

if (
  [
    "early-output-await",
    "early-output-command-over-budget-await",
  ].includes(mode)
) {
  emit({
    type: "item.completed",
    item: {
      id: `${role}-early-message`,
      type: "agent_message",
      text: JSON.stringify({
        summary: "Early placeholder emitted before repository exploration.",
        findings: [],
        practiceAssessments: [],
        probeResult: {
          status: "partial",
          summary: "Exploration has not completed.",
          citations: [
            {
              path: "package.json",
              startLine: 1,
              endLine: 1,
              symbol: null,
            },
          ],
        },
        deadEnds: [],
        instructions: [],
        verificationWorkflows: [],
      }),
    },
  });
}
const commandCount =
  mode.startsWith("report-only")
    ? 0
    : commandOverBudgetMode
      ? 7
      : 1;
for (let index = 1; index <= commandCount; index += 1) {
  const item = {
    id: `${role}-command-${index}`,
    type: "command_execution",
    command: index === commandCount ? "git status --short" : "rg --files",
    status: "in_progress",
  };
  emit({ type: "item.started", item });
  emit({
    type: "item.completed",
    item: {
      ...item,
      status:
        commandOverBudgetMode && index === commandCount
          ? "declined"
          : "completed",
      exit_code:
        commandOverBudgetMode && index === commandCount
          ? -1
          : 0,
    },
  });
}

if (
  [
    "await-interrupt",
    "command-over-budget-await",
    "early-output-await",
    "early-output-command-over-budget-await",
  ].includes(mode)
) {
  setInterval(() => {}, 10_000);
} else if (mode === "failure") {
  process.stderr.write("simulated provider failure");
  process.exitCode = 7;
} else {
  let claimId = suppliedClaimId;
  if (role === "orchestrator") {
    const marker = "Assignment evidence (JSON):\n";
    const markerIndex = prompt.indexOf(marker);
    if (markerIndex >= 0) {
      const context = JSON.parse(prompt.slice(markerIndex + marker.length));
      claimId ??= context.claims?.[0]?.id;
    }
  }
  const result =
    role === "orchestrator"
      ? {
          summary: "Cross-examined the candidate evidence in a fresh process",
          challenges: [
            {
              challengeId: "fake-challenge-1",
              claimId,
              assessment: "qualify",
              issue: "The ownership statement needs a verification boundary.",
              resolution: "Keep the cited owner and qualify the boundary.",
              disposition: "qualified",
            },
          ],
          verificationRequests: [
            {
              claimId,
              preferredMethod: "static_inspection",
              rationale: "The cited location can be checked without writes.",
              checks: ["Confirm the cited file and symbol exist."],
            },
          ],
          recommendations: [
            {
              id: "fake-recommendation-1",
              priority: "P1",
              title: "Index the test change surface",
              problem:
                "The candidate needed bounded search to locate the owner.",
              change:
                "Add a named change-surface index beside the repository map.",
              repositoryChanges: [
                "Add docs/test-change-surface.md with the owner, consumers, and verification entry point.",
              ],
              claimIds: [claimId],
              practiceIds: ["01", "05"],
              affectedDimensions: [
                "discoveryEfficiency",
                "ownershipClarity",
              ],
              tokenMechanism:
                "One indexed path replaces repeated filename searches.",
              validationChecks: [
                "Repeat the same probe and confirm the owner is found directly.",
              ],
              limitations: ["The fake provider does not execute a probe."],
              effort: null,
            },
          ],
          practiceProfile: [],
        }
      : {
          summary: `${role} inspected an assignment-only prompt`,
          findings: [
            {
              kind:
                mode === "invalid-finding-kind"
                  ? "proposed_change"
                  : "navigation_fact",
              dimension: "verificationDiscoverability",
              subject: "script discoverability",
              assertion:
                "package.json exposes the repository's named verification scripts in one discoverable entry point.",
              friction:
                "Without this single index, an agent would need to search neighboring configuration files for the canonical verification command.",
              confidence: 0.95,
              criticality: "critical",
              citations: [
                {
                  path: "package.json",
                  startLine: 1,
                  endLine: 20,
                  symbol: null,
                },
              ],
            },
            ...(mode === "mixed-valid-and-invalid-findings"
              ? [
                  {
                    kind: "proposed_change",
                    dimension: "discoveryEfficiency",
                    subject: "invalid proposed change",
                    assertion:
                      "This item is intentionally not a navigation fact.",
                    friction: "This fixture item must be rejected.",
                    confidence: 0.5,
                    criticality: "low",
                    citations: [
                      {
                        path: "package.json",
                        startLine: 1,
                        endLine: 1,
                        symbol: null,
                      },
                    ],
                  },
                ]
              : []),
          ],
          practiceAssessments: [],
          probeResult: {
            status: prompt.includes("Budget wrap-up directive")
              ? "partial"
              : "adequate",
            summary:
              prompt.includes("Budget wrap-up directive")
                ? "Budget reserve triggered; reporting only the evidence already gathered."
                : "Located the requested test change surface well enough for validator review.",
            citations: [
              {
                path: "package.json",
                startLine: 1,
                endLine: 20,
                symbol: null,
              },
            ],
          },
          deadEnds: prompt.includes("Budget wrap-up directive")
            ? ["The investigation stopped at the reserved reporting threshold."]
            : [],
          instructions: [],
          verificationWorkflows: [],
          assignmentOnly:
            prompt.includes(
              "fresh process with no inherited conversation history",
            ) && !prompt.includes("operator conversation"),
          hasCommandBudget: prompt.includes(
            role === "candidate"
              ? "Use at most 6 shell commands."
              : "Use at most 8 shell commands.",
          ),
          hasForbiddenPolicy: prompt.includes(
            "Forbidden tool action: editing target files",
          ),
          hasDirectReadPolicy:
            prompt.includes("Use direct read-only command shapes only") &&
            prompt.includes(
              "Do not retry a declined or failed command with a syntactic variant",
            ),
        };
  if (delayedReportMode) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  emit({
    type: "item.completed",
    item: {
      id: `${role}-message`,
      type: "agent_message",
      text: JSON.stringify(result),
    },
  });

  const usage =
    mode === "over-budget" || mode === "live-over-budget"
      ? { input_tokens: 90, cached_input_tokens: 20, output_tokens: 20 }
      : role === "candidate"
        ? { input_tokens: 60, cached_input_tokens: 10, output_tokens: 20 }
        : role === "independent"
          ? { input_tokens: 80, cached_input_tokens: 15, output_tokens: 20 }
          : { input_tokens: 90, cached_input_tokens: 20, output_tokens: 30 };
  emit({ type: "turn.completed", usage });
  if (mode === "live-over-budget") {
    setInterval(() => {}, 10_000);
  }
}
