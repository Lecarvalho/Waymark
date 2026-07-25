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
  let suppliedClaimIds = suppliedClaimId ? [suppliedClaimId] : [];
  if (role === "orchestrator") {
    const marker = "Assignment evidence (JSON):\n";
    const markerIndex = prompt.indexOf(marker);
    if (markerIndex >= 0) {
      const context = JSON.parse(prompt.slice(markerIndex + marker.length));
      claimId ??= context.claims?.[0]?.id;
      suppliedClaimIds = (context.claims ?? []).map(({ id }) => id);
    }
  }
  const generalMode = prompt.includes("Audit mode: general");
  const generalPracticeIds = ["01", "02", "03", "04", "05", "06", "07"];
  const generalDimensions = [
    "discoveryEfficiency",
    "dependencyClarity",
    "discoveryEfficiency",
    "verificationDiscoverability",
    "instructionQuality",
    "verificationDiscoverability",
    "ownershipClarity",
  ];
  const generalFindings = generalPracticeIds.map((practiceId, index) => ({
    kind: "navigation_fact",
    dimension: generalDimensions[index],
    subject: `general practice ${practiceId}`,
    assertion: `The controlled fixture exposes cited evidence for Practice Guide ${practiceId}.`,
    friction: `The fixture retains one bounded navigation gap for practice ${practiceId}.`,
    confidence: 0.9,
    criticality: "high",
    practiceIds: [practiceId],
    citations: [
      {
        path: "package.json",
        startLine: 1,
        endLine: 20,
        symbol: null,
      },
    ],
  }));
  const generalRecommendations = generalPracticeIds.map(
    (practiceId, index) => ({
      id: `fake-general-recommendation-${practiceId}`,
      priority: index < 2 ? "P1" : "P2",
      title: `Improve Practice Guide ${practiceId}`,
      problem: `The controlled fixture retains navigation friction for practice ${practiceId}.`,
      change: `Add a repository-specific navigation signal for practice ${practiceId}.`,
      repositoryChanges: [
        `Document and index the fixture evidence for practice ${practiceId}.`,
      ],
      claimIds: [suppliedClaimIds[index]],
      practiceIds: [practiceId],
      affectedDimensions: [generalDimensions[index]],
      tokenMechanism:
        "A direct repository signal replaces repeated bounded searches.",
      validationChecks: [
        `Repeat the general audit and confirm practice ${practiceId} is found directly.`,
      ],
      limitations: ["This is deterministic fake-provider evidence."],
      effort: null,
    }),
  );
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
          recommendations: generalMode
            ? generalRecommendations
            : [
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
          practiceProfile: generalMode
            ? generalPracticeIds.map((practiceId, index) => ({
                practiceId,
                status: "mixed",
                assessment: `Practice ${practiceId} has useful signals and one verified navigation gap.`,
                tokenImpact:
                  "The remaining gap causes one additional bounded search.",
                claimIds: [suppliedClaimIds[index]],
                recommendationIds: [
                  `fake-general-recommendation-${practiceId}`,
                ],
                limitations: ["The controlled fixture is intentionally small."],
              }))
            : [],
        }
      : {
          summary: `${role} inspected an assignment-only prompt`,
          findings: generalMode
            ? mode === "report-only-empty-general"
              ? []
              : generalFindings
            : [
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
          practiceAssessments: generalMode
            ? mode === "report-only-empty-general"
              ? []
              : generalPracticeIds
                  .filter(
                    (practiceId) =>
                      mode !== "missing-practice-assessment-general" ||
                      practiceId !== "06",
                  )
                  .map((practiceId) => {
                    const index = generalPracticeIds.indexOf(practiceId);
                    return {
                      practiceId,
                      status: "mixed",
                      summary: `Practice ${practiceId} is only partly explicit in the controlled fixture.`,
                      findingIndexes:
                        mode === "invalid-practice-references-general"
                          ? practiceId === "01"
                            ? [0, 4]
                            : practiceId === "05"
                              ? [0]
                              : practiceId === "07"
                                ? [6, 99]
                                : [index]
                          : [index],
                      limitations: [
                        "The fixture contains one representative path.",
                      ],
                    };
                  })
            : [],
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
