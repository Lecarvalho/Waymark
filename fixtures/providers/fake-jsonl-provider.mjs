import { readFileSync } from "node:fs";

const mode = process.argv[2] ?? "success";
const role = process.argv[3] ?? "candidate";
const prompt = readFileSync(0, "utf8");

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

emit({ type: "thread.started", thread_id: `fresh-${role}` });
emit({ type: "turn.started" });
emit({
  type: "item.completed",
  item: {
    id: `${role}-command`,
    type: "command_execution",
    command: "rg --files",
    status: "completed",
    exit_code: 0
  }
});

if (mode === "failure") {
  process.stderr.write("simulated provider failure");
  process.exitCode = 7;
} else {
  emit({
    type: "item.completed",
    item: {
      id: `${role}-message`,
      type: "agent_message",
      text: JSON.stringify({
        summary: `${role} inspected an assignment-only prompt`,
        findings: [],
        deadEnds: [],
        instructions: [],
        verificationWorkflows: [],
        assignmentOnly:
          prompt.includes("fresh process with no inherited conversation history") &&
          !prompt.includes("operator conversation")
      })
    }
  });

  const usage =
    mode === "over-budget" || mode === "live-over-budget"
      ? { input_tokens: 90, cached_input_tokens: 20, output_tokens: 20 }
      : role === "candidate"
        ? { input_tokens: 60, cached_input_tokens: 10, output_tokens: 20 }
        : { input_tokens: 80, cached_input_tokens: 15, output_tokens: 20 };
  emit({ type: "turn.completed", usage });
  if (mode === "live-over-budget") {
    setInterval(() => {}, 10_000);
  }
}
