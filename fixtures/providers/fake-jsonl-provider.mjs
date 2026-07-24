import { readFileSync } from "node:fs";

const codexCliMode = process.argv[2] === "exec";
const mode = codexCliMode ? "success" : (process.argv[2] ?? "success");
const role = codexCliMode
  ? process.argv.some((argument) =>
      argument.includes("orchestration-output.schema.json"),
    )
    ? "orchestrator"
    : "candidate"
  : (process.argv[3] ?? "candidate");
const suppliedClaimId = codexCliMode ? undefined : process.argv[4];
const prompt = readFileSync(0, "utf8");

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

emit({ type: "thread.started", thread_id: `fresh-${role}` });
emit({ type: "turn.started" });
const commandCount = mode === "command-over-budget" ? 7 : 1;
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
        mode === "command-over-budget" && index === commandCount
          ? "declined"
          : "completed",
      exit_code:
        mode === "command-over-budget" && index === commandCount ? -1 : 0,
    },
  });
}

if (mode === "failure") {
  process.stderr.write("simulated provider failure");
  process.exitCode = 7;
} else {
  let claimId = suppliedClaimId;
  if (role === "orchestrator" && !claimId) {
    const marker = "Assignment evidence (JSON):\n";
    const markerIndex = prompt.indexOf(marker);
    if (markerIndex >= 0) {
      const context = JSON.parse(prompt.slice(markerIndex + marker.length));
      claimId = context.claims?.[0]?.id;
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
          ],
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
