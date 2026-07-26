import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const appDirectory = path.join(repositoryRoot, "app");
const stylesDirectory = path.join(appDirectory, "styles");
const allowedGlobalClasses = new Set([
  "empty-report-state",
  "muted-action",
  "page-content",
  "panel",
  "panel-heading",
  "section-kicker",
]);

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function cssClassNames(css) {
  return new Set(
    [...css.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map(
      (match) => match[1],
    ),
  );
}

test("globals.css remains an import-only manifest", () => {
  const globals = read("app/globals.css")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  const statements = globals.split(/\r?\n/).filter(Boolean);

  assert.ok(statements.length > 0, "globals.css must import the global foundation");
  for (const statement of statements) {
    assert.match(
      statement,
      /^@import\s+["'][^"']+["'];$/,
      `globals.css may contain ordered @import statements only; found: ${statement}`,
    );
  }
});

test("the shared foundation contains only documented global classes", () => {
  const primitives = read("app/styles/primitives.css");
  const sharedClasses = cssClassNames(primitives);
  for (const className of sharedClasses) {
    assert.ok(
      allowedGlobalClasses.has(className),
      `.${className} is not in the shared primitive allowlist; move it to an owning CSS Module or document the primitive`,
    );
  }

  for (const foundationFile of ["tokens.css", "base.css"]) {
    const classes = cssClassNames(read(`app/styles/${foundationFile}`));
    assert.deepEqual(
      [...classes],
      [],
      `${foundationFile} must not own global classes`,
    );
  }

  const styleMap = read("app/styles/STYLE_MAP.md");
  for (const className of allowedGlobalClasses) {
    assert.match(
      styleMap,
      new RegExp(`\\b${className}\\b`),
      `STYLE_MAP.md must document the .${className} primitive`,
    );
  }
});

test("legacy layers and generic state classes cannot return", () => {
  const cssFiles = [
    path.join(appDirectory, "globals.css"),
    ...fs
      .readdirSync(stylesDirectory)
      .filter((name) => name.endsWith(".css"))
      .map((name) => path.join(stylesDirectory, name)),
    ...fs
      .readdirSync(appDirectory)
      .filter((name) => name.endsWith(".module.css"))
      .map((name) => path.join(appDirectory, name)),
  ];

  for (const filePath of cssFiles) {
    const css = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      css,
      /@layer\s+legacy\b/,
      `${path.relative(repositoryRoot, filePath)} reintroduced @layer legacy`,
    );
    assert.doesNotMatch(
      css,
      /\.(?:active|is-[\w-]+|status-[\w-]+|state-[\w-]+|signal-[\w-]+)\b/,
      `${path.relative(repositoryRoot, filePath)} uses a generic state class; prefer a native or data attribute`,
    );
  }
});

test("tokens have one canonical root declaration", () => {
  const foundationCss = ["globals.css", "styles/tokens.css", "styles/base.css", "styles/primitives.css"]
    .map((name) => read(`app/${name}`))
    .join("\n");
  const rootDeclarations = foundationCss.match(/:root\s*\{/g) ?? [];
  assert.equal(
    rootDeclarations.length,
    1,
    "the global foundation must contain exactly one :root token declaration",
  );
});
