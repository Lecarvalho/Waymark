"use client";

import { useState } from "react";
import styles from "./practice-guide-view.module.css";
import exampleStyles from "./practice-guide-examples.module.css";
import structureStyles from "./practice-guide-structure.module.css";

const styleMaps = [styles, exampleStyles, structureStyles];

function classes(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((name) => {
      const matches = styleMaps
        .map((styleMap) => styleMap[name as keyof typeof styleMap])
        .filter((match): match is string => Boolean(match));
      return matches.length > 0 ? matches : [name];
    })
    .join(" ");
}

const practicePairs = [
  {
    number: "01",
    title: "Organize around behavior",
    principle:
      "Keep the files needed for one change near each other so the agent can build a complete mental model with fewer searches.",
    goodTitle: "Domain and feature modules",
    goodExample:
      "src/orders/\n  create-order.ts\n  cancel-order.ts\n  order-repository.ts\n\nsrc/payments/\n  collect-payment.ts\n  payment-provider.ts",
    badTitle: "Layer-wide dumping grounds",
    badExample:
      "src/\n  controllers/\n  services/\n  repositories/\n  helpers/\n  models/",
  },
  {
    number: "02",
    title: "Make dependency direction explicit",
    principle:
      "Agents should be able to predict what a component may import before opening every file.",
    goodTitle: "Stable inward dependencies",
    goodExample:
      "API → Application → Domain\n          ↓\n    Infrastructure\n\nDomain owns interfaces.\nInfrastructure implements them.",
    badTitle: "Hidden and mixed dependencies",
    badExample:
      "HTTP handling + SQL + business rules\ninside one function\n\nGlobal database\nGlobal current user\nCircular service imports",
  },
  {
    number: "03",
    title: "Name files for the concept they own",
    principle:
      "Precise names give search and retrieval systems useful signals. Generic names create expensive ambiguity.",
    goodTitle: "Specific and cohesive",
    goodExample:
      "calculate-refund.ts\nrefund-policy.ts\nrefund-repository.ts\nissue-refund.test.ts",
    badTitle: "Generic and overloaded",
    badExample:
      "helpers.ts\nutils.ts\ncommon.ts\nmisc.ts\nmanager.ts",
  },
  {
    number: "04",
    title: "Provide one canonical workflow",
    principle:
      "There should be one obvious command for setup, verification, and development—shared by humans, agents, and CI.",
    goodTitle: "One executable contract",
    goodExample:
      "make setup\nmake dev\nmake test\nmake lint\nmake typecheck\nmake verify",
    badTitle: "Conflicting sources of truth",
    badExample:
      "README: npm test\nCI: pnpm run test:ci\nDeveloper script: yarn verify\nPackage: ./check-new.sh",
  },
  {
    number: "05",
    title: "Put instructions close to the code",
    principle:
      "Repository-wide rules belong at the root; unusual domain constraints belong beside the affected module.",
    goodTitle: "Scoped, accurate guidance",
    goodExample:
      "AGENTS.md\nsrc/billing/AGENTS.md\n\n• Monetary values use integer cents\n• Payment operations are idempotent\n• Run make verify",
    badTitle: "Distant or stale knowledge",
    badExample:
      "One enormous wiki page\nUndocumented payment rules\nDead setup commands\nComments that contradict CI",
  },
  {
    number: "06",
    title: "Make tests mirror behavior",
    principle:
      "The agent should find the correct feedback loop from the implementation path without searching the whole repository.",
    goodTitle: "Predictable test mapping",
    goodExample:
      "src/orders/create-order.ts\nsrc/orders/create-order.test.ts\n\ntests/integration/orders-api.test.ts\ntests/end-to-end/checkout.test.ts",
    badTitle: "Anonymous test inventory",
    badExample:
      "tests/test1.ts\ntests/test-new.ts\ntests/regression-final.ts\ntests/misc-tests.ts",
  },
  {
    number: "07",
    title: "Separate generated and external code",
    principle:
      "Agents must know which files express product intent and which will be overwritten or should not be edited.",
    goodTitle: "Visible ownership boundaries",
    goodExample:
      "src/          # hand-written\ngenerated/    # do not edit\nvendor/       # external\nthird_party/  # external",
    badTitle: "Everything mixed together",
    badExample:
      "src/hand-written.ts\nsrc/generated-file.ts\nsrc/copied-library-with-local-edits.ts",
  },
];

const agentQuestions = [
  "Where does this behavior live?",
  "What is allowed to depend on what?",
  "How do I run and test it?",
  "Which conventions must I follow?",
  "What else could this change break?",
];

const recommendedTree = `project/
├── README.md
├── AGENTS.md
├── ARCHITECTURE.md
├── .env.example
├── Makefile
├── docs/
│   ├── decisions/
│   └── runbooks/
├── src/
│   ├── accounts/
│   │   ├── README.md
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── tests/
│   └── billing/
├── tests/
│   ├── integration/
│   └── end-to-end/
├── scripts/
├── migrations/
├── fixtures/
└── generated/`;

const hostileTree = `project/
├── app-new.ts
├── app-final.ts
├── app-final-fixed.ts
├── common/
│   ├── helpers.ts
│   └── utils.ts
├── old/
├── backup/
├── temp/
├── services/
│   └── service.ts     # 8,000 lines
├── config.ts          # globals + secrets
├── tests.ts
└── README.md          # stale`;

export function PracticeGuideView() {
  const [openPractice, setOpenPractice] = useState("01");
  const [structureView, setStructureView] = useState<
    "recommended" | "hostile"
  >("recommended");

  return (
    <div className={classes("page-content guide-view")}>
      <section className={classes("guide-hero")}>
        <div>
          <span className={classes("section-kicker")}>Static reference · v1.0</span>
          <h1>The agent-ready codebase</h1>
          <p>
            A practical standard for reducing uncertainty, context cost,
            and wrong turns during agentic coding. This guide evaluates
            AI navigability—not security or general software quality.
          </p>
        </div>
        <aside className={classes("guide-thesis")}>
          <span>Design target</span>
          <strong>Low uncertainty</strong>
          <p>
            Boring, consistent, modular code usually outperforms clever
            code for both humans and agents.
          </p>
        </aside>
      </section>

      <section className={classes("question-panel")}>
        <div className={classes("question-intro")}>
          <span className={classes("section-kicker")}>Orientation test</span>
          <h2>A model should answer these quickly</h2>
        </div>
        <ol>
          {agentQuestions.map((question, index) => (
            <li key={question}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {question}
            </li>
          ))}
        </ol>
      </section>

      <section className={classes("practice-section")}>
        <div className={classes("practice-heading")}>
          <div>
            <span className={classes("section-kicker")}>Seven principles</span>
            <h2>Good patterns and their costly opposites</h2>
          </div>
          <p>
            Each recommendation is about the work an agent must do to
            locate, understand, change, and verify behavior.
          </p>
        </div>

        <div className={classes("practice-list")}>
          {practicePairs.map((practice) => {
            const isOpen = openPractice === practice.number;

            return (
              <article
                className={classes("practice-card")}
                data-state={isOpen ? "open" : "closed"}
                key={practice.number}
              >
                <button
                  aria-expanded={isOpen}
                  className={classes("practice-toggle")}
                  onClick={() =>
                    setOpenPractice(isOpen ? "" : practice.number)
                  }
                  type="button"
                >
                  <span className={classes("practice-number")}>
                    {practice.number}
                  </span>
                  <span className={classes("practice-summary")}>
                    <strong>{practice.title}</strong>
                    <span>{practice.principle}</span>
                  </span>
                  <span className={classes("practice-toggle-icon")} aria-hidden="true">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>

                {isOpen && (
                  <div className={classes("practice-comparison")}>
                    <div className={classes("practice-example good-practice")}>
                      <div className={classes("example-label")}>
                        <span aria-hidden="true">✓</span>
                        <strong>Good</strong>
                        <small>{practice.goodTitle}</small>
                      </div>
                      <pre>{practice.goodExample}</pre>
                    </div>
                    <div className={classes("practice-example bad-practice")}>
                      <div className={classes("example-label")}>
                        <span aria-hidden="true">×</span>
                        <strong>Bad</strong>
                        <small>{practice.badTitle}</small>
                      </div>
                      <pre>{practice.badExample}</pre>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className={classes("tree-section")}>
        <div className={classes("practice-heading")}>
          <div>
            <span className={classes("section-kicker")}>Repository shape</span>
            <h2>Two codebases, two very different journeys</h2>
          </div>
          <p>
            Folder names are not the goal. Predictability, ownership, and
            a short path from behavior to verification are.
          </p>
        </div>
        <div
          className={classes("structure-switcher")}
          aria-label="Repository structure example"
        >
          <button
            aria-pressed={structureView === "recommended"}
            onClick={() => setStructureView("recommended")}
            type="button"
          >
            Recommended
          </button>
          <button
            aria-pressed={structureView === "hostile"}
            onClick={() => setStructureView("hostile")}
            type="button"
          >
            Model-hostile
          </button>
        </div>

        <div className={classes("tree-grid single-tree")}>
          {structureView === "recommended" ? (
            <article className={classes("tree-card recommended-tree")}>
              <div>
                <span className={classes("tree-mark")}>✓</span>
                <h3>Recommended structure</h3>
                <small>Clear ownership and verification paths</small>
              </div>
              <pre>{recommendedTree}</pre>
            </article>
          ) : (
            <article className={classes("tree-card hostile-tree")}>
              <div>
                <span className={classes("tree-mark")}>×</span>
                <h3>Model-hostile structure</h3>
                <small>Ambiguous ownership and competing truths</small>
              </div>
              <pre>{hostileTree}</pre>
            </article>
          )}
        </div>
      </section>

      <section className={classes("guide-close")}>
        <span className={classes("section-kicker")}>Practical target</span>
        <h2>Optimize for low uncertainty, not fewer files.</h2>
        <div className={classes("target-points")}>
          <span>One obvious location for each behavior</span>
          <span>One owner for each concept</span>
          <span>One canonical verification workflow</span>
          <span>Explicit boundaries and fast feedback</span>
          <span>Small amounts of accurate documentation</span>
        </div>
      </section>
    </div>
  );
}
