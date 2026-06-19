import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createMemoryStore } from "../src/operations/memoryStore.js";
import { deepenHandler } from "../src/server/deepenHandler.js";
import { undoHandler } from "../src/server/undoHandler.js";
import { stubRunner } from "../src/server/stubRunner.js";

const md = fs.readFileSync("examples/authoring/recursive-self-improvement.mindgraph.md", "utf8");
const addRunner = async ({ slug, store }) => {
  store.put(slug, { md: store.get(slug).md + "\n\n@concept undo-added\nlabel: Undo Added\n" });
};

test("undo restores the pre-deepen markdown and returns the prior document", async () => {
  const store = createMemoryStore({ demo: { md } });
  await deepenHandler({ slug: "demo", conceptId: "c", store, runner: addRunner, emit: () => {} });
  const grown = store.get("demo").json;
  assert.ok(grown.concepts.atomic.some((c) => c.id === "undo-added"));
  const result = undoHandler({ slug: "demo", store });
  assert.equal(result.ok, true);
  assert.equal(store.get("demo").md, md);
  assert.ok(!result.document.concepts.atomic.some((c) => c.id === "undo-added"));
});

test("undo reverts an entire woven discussion turn", async () => {
  const store = createMemoryStore({ demo: { md } });
  // Auto-answer the stub's clarifying question so the turn completes.
  const askQuestions = async () => [{ header: "Angle", values: ["Mechanism"] }];
  await deepenHandler({
    slug: "demo",
    conceptId: "recursive-self-improvement",
    store,
    runner: stubRunner,
    emit: () => {},
    askQuestions,
  });
  const grown = store.get("demo").json;
  assert.ok(
    (grown.sources ?? []).some((s) => s.id.startsWith("disc-")),
    "stub should have woven a discussion source",
  );

  const result = undoHandler({ slug: "demo", store });
  assert.equal(result.ok, true);
  // The whole woven turn (source + block + concept + relation + section/step) is gone.
  assert.equal(store.get("demo").md, md, "markdown restored to the pre-deepen baseline");
  assert.ok(
    !(result.document.sources ?? []).some((s) => s.id.startsWith("disc-")),
    "discussion source should be gone after undo",
  );
});

test("undo with no snapshot reports not-ok without throwing", () => {
  const store = createMemoryStore({ demo: { md } });
  const result = undoHandler({ slug: "demo", store });
  assert.equal(result.ok, false);
  assert.match(result.message, /no deepen/i);
});
