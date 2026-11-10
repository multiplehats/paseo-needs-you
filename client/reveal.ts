// Opening an agent leaves the sidebar as it was, so on desktop and web this unfolds the agent's
// project too. Paseo has no API for folding, so it presses the project's own row, found by the
// test ID Paseo gives it. If Paseo's sidebar changes, this quietly does nothing.

const PROJECT_ROW = "sidebar-project-row-";
const WORKSPACE_ROW = "sidebar-workspace-row-";
/** On a row being unfolded, so another plugin doing the same does not press it closed again. */
const UNFOLDING = "data-paseo-unfolding";
const UNFOLDING_MS = 1_500;
const RENDER_MS = 150;

export interface RevealTarget {
  serverId: string;
  workspaceId: string | null;
  projectKey: string | null;
}

/** Keys can hold quotes and slashes, so they are compared rather than put in a selector. */
function rowFor(doc: Document, prefix: string, key: string) {
  const testId = `${prefix}${key}`;
  for (const row of doc.querySelectorAll(`[data-testid^="${prefix}"]`))
    if (row.getAttribute("data-testid") === testId) return row as HTMLElement;
  return null;
}

export function revealInSidebar(doc: Document, target: RevealTarget) {
  const { serverId, workspaceId, projectKey } = target;
  if (!projectKey) return;
  const project = rowFor(doc, PROJECT_ROW, projectKey);
  const group = project?.closest('[role="group"]');
  if (!project || !group) return;
  // A folded project renders no workspace rows, and pressing an open one would fold it.
  const folded = !group.querySelector(`[data-testid^="${WORKSPACE_ROW}"]`);
  if (folded && !project.hasAttribute(UNFOLDING)) {
    project.setAttribute(UNFOLDING, "");
    project.click();
    setTimeout(() => project.removeAttribute(UNFOLDING), UNFOLDING_MS);
  }
  if (!workspaceId) return;
  // The rows appear once the sidebar has rendered, and a long one may need to scroll to them.
  setTimeout(
    () =>
      rowFor(doc, WORKSPACE_ROW, `${serverId}:${workspaceId}`)?.scrollIntoView?.({
        block: "nearest",
      }),
    RENDER_MS,
  );
}
