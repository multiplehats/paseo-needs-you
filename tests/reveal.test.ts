import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { revealInSidebar } from "../client/reveal";

/** A sidebar shaped like Paseo's: one group per project, its rows only there when unfolded. */
function sidebar(projects: { key: string; workspaces: string[] }[]) {
  const groups = projects
    .map(
      ({ key, workspaces }) => `
      <div role="group">
        <div data-testid='sidebar-project-row-${key}'></div>
        ${workspaces.map((id) => `<div data-testid="sidebar-workspace-row-${id}"></div>`).join("")}
      </div>`,
    )
    .join("");
  const { document } = parseHTML(`<!doctype html><html><body>${groups}</body></html>`);
  const presses: string[] = [];
  for (const row of document.querySelectorAll('[data-testid^="sidebar-project-row-"]'))
    row.addEventListener("click", () => presses.push(row.getAttribute("data-testid") ?? ""));
  return { document: document as unknown as Document, presses };
}

const target = { serverId: "s1", workspaceId: "w1", projectKey: "shop" };

test("a folded project is unfolded", () => {
  const { document, presses } = sidebar([{ key: "shop", workspaces: [] }]);
  revealInSidebar(document, target);
  assert.deepEqual(presses, ["sidebar-project-row-shop"]);
});

test("an open project is left open", () => {
  const { document, presses } = sidebar([{ key: "shop", workspaces: ["s1:w1"] }]);
  revealInSidebar(document, target);
  assert.deepEqual(presses, []);
});

test("a project already being unfolded is not pressed closed again", () => {
  const { document, presses } = sidebar([{ key: "shop", workspaces: [] }]);
  revealInSidebar(document, target);
  revealInSidebar(document, target);
  assert.deepEqual(presses, ["sidebar-project-row-shop"]);
});

test("only the agent's own project is touched", () => {
  const { document, presses } = sidebar([
    { key: "other", workspaces: [] },
    { key: "shop", workspaces: [] },
  ]);
  revealInSidebar(document, target);
  assert.deepEqual(presses, ["sidebar-project-row-shop"]);
});

test("a key with quotes and slashes still finds its row", () => {
  const key = 'remote:["github.com/a/b"]';
  const { document, presses } = sidebar([{ key, workspaces: [] }]);
  revealInSidebar(document, { ...target, projectKey: key });
  assert.deepEqual(presses, [`sidebar-project-row-${key}`]);
});

test("a project the sidebar does not show is ignored", () => {
  const { document, presses } = sidebar([{ key: "other", workspaces: [] }]);
  revealInSidebar(document, target);
  assert.deepEqual(presses, []);
});

test("with no project there is nothing to unfold", () => {
  const { document, presses } = sidebar([{ key: "shop", workspaces: [] }]);
  revealInSidebar(document, { ...target, projectKey: null });
  assert.deepEqual(presses, []);
});
