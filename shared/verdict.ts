// Text rules: does an agent's last message want something from the person? Used when no model
// is set up, and whenever a model call fails. Missing a question is the failure this plugin
// exists to prevent, so the rules lean towards listing too much; a wrong entry is one Dismiss.

export type Verdict = "question" | "action" | "offer" | "none";

const CODE_BLOCK = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;

/** What a person reads as prose. Punctuation in code, links, quotes and headings says nothing. */
export function readable(text: string) {
  return text
    .replace(CODE_BLOCK, "\n")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\bhttps?:\/\/\S+/g, " ")
    .replace(/^\s*(?:>|#{1,6}\s).*$/gm, "")
    .trim();
}

const APOSTROPHE = "['’]";

const ACTION = new RegExp(
  [
    "\\blet me know\\b",
    "\\btell me\\b",
    `\\bonce you(?:${APOSTROPHE}ve| have)?\\b`,
    "\\bi need (?:your|you|the|that|a|an)\\b",
    `\\bi${APOSTROPHE}ll need\\b`,
    "\\bwaiting (?:on|for) you\\b",
    "\\bneeds? your\\b",
    "\\byour (?:call|decision|answer|input|approval|go-ahead)\\b",
    "\\bplease (?:confirm|run|provide|share|send|check|approve|review|paste|add|set|restart)\\b",
    `\\b(?:when|whenever) you${APOSTROPHE}re ready\\b`,
    `\\byou(?:${APOSTROPHE}ll| will)? need to\\b`,
    // Dutch
    "\\blaat (?:me|het) (?:even )?weten\\b",
    "\\bstuur me\\b",
    "\\bzodra je\\b",
    "\\b(?:heb ik|ik heb) (?:je|jouw|de|het|een)\\b[^.\\n]{0,60}\\bnodig\\b",
    "\\b(?:jouw|je) (?:keuze|beslissing|akkoord|antwoord|goedkeuring)\\b",
    "\\bgraag (?:je|jouw)\\b",
  ].join("|"),
  "i",
);

const OFFER = new RegExp(
  [
    `\\bif you(?:${APOSTROPHE}d| would)? (?:want|like|prefer)\\b`,
    "\\bhappy to\\b",
    "\\bi can (?:also )?[^.\\n]{0,60}\\bif you\\b",
    // Dutch
    "\\bals je (?:dat |het )?wil(?:t)?\\b",
  ].join("|"),
  "i",
);

export function ruleVerdict(text: string): Verdict {
  const body = readable(text);
  if (body.includes("?")) return "question";
  if (ACTION.test(body)) return "action";
  if (OFFER.test(body)) return "offer";
  return "none";
}

/** A line as it reads with the markdown taken off. */
function plain(line: string) {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*+]\s+/, "")
    .trim();
}

/**
 * The part of a message to show in the list: the lines that ask for something, or the last line
 * when none clearly does. An early rhetorical question should not win over the real ask at the
 * end, while a numbered list of questions should show from its first item.
 */
export function excerpt(text: string, max = 240) {
  const lines = text
    .replace(CODE_BLOCK, "\n")
    .split("\n")
    .map((raw) => ({ raw, body: readable(raw) }))
    .filter((line) => line.body);
  const asks = lines.filter(
    ({ body }) => body.includes("?") || ACTION.test(body) || OFFER.test(body),
  );
  const chosen = asks.length ? asks.slice(-3).slice(0, 2) : lines.slice(-1);
  const joined = chosen.map(({ raw }) => plain(raw)).join(" ");
  return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}…` : joined;
}

/** A short stable id for a message, so a dismissal or a verdict is tied to that exact text. */
export function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}
