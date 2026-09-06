import "./theme";

import type { StampInfo } from "./ytstamp";
import { asWatchUrl, formatOffset, parseDebugInfo, timestampUrl } from "./ytstamp";

// Todoist project id. Open the project in the web app: the URL ends in
// `<name>-<id>` (e.g. `.../project/shorts-6X76pcJRm3wCrR76`) — take the part
// after the last dash, the name prefix is not part of the id. Empty string
// drops the task in Inbox.
const TODOIST_PROJECT_ID = "6X76pcJRm3wCrR76";
// Baked in at build time from .env — see README. Anyone who can load the page
// can read this token, so keep the deployment private and rotate it if leaked.
const TODOIST_TOKEN = import.meta.env.VITE_TODOIST_TOKEN as string | undefined;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <a class="back" href="/">← all tools</a>
  <h1>live timestamp</h1>
  <label class="field wide">
    Title
    <input id="title" type="text" spellcheck="false" placeholder="What happens at this moment" />
  </label>
  <label class="field wide">
    Player debug info
    <textarea id="debug" rows="7" spellcheck="false" placeholder='{ "ns": "yt", … }  —  or paste a https://youtu.be/… link'></textarea>
  </label>
  <div id="result" hidden>
    <div class="result-row">
      <a id="link" class="result-link" target="_blank" rel="noreferrer"></a>
      <button id="copy" type="button">Copy</button>
      <button id="todoist" type="button">Add to Todoist</button>
    </div>
    <p class="hint" id="meta"></p>
  </div>
  <div id="status"></div>
`;

const titleInput = app.querySelector<HTMLInputElement>("#title")!;
const debugInput = app.querySelector<HTMLTextAreaElement>("#debug")!;
const resultEl = app.querySelector<HTMLDivElement>("#result")!;
const linkEl = app.querySelector<HTMLAnchorElement>("#link")!;
const copyBtn = app.querySelector<HTMLButtonElement>("#copy")!;
const todoistBtn = app.querySelector<HTMLButtonElement>("#todoist")!;
const metaEl = app.querySelector<HTMLParagraphElement>("#meta")!;
const statusEl = app.querySelector<HTMLDivElement>("#status")!;

function update(): void {
  // Blank input is the starting state, not an error — say nothing until there
  // is something to react to.
  if (!debugInput.value.trim()) {
    resultEl.hidden = true;
    setStatus("");
    return;
  }

  // A pasted watch link is stored as-is; only a debug blob needs deriving.
  const pasted = asWatchUrl(debugInput.value);
  if (pasted) {
    show(pasted, "pasted link — used as is");
    return;
  }

  try {
    const info = parseDebugInfo(debugInput.value);
    show(timestampUrl(info.videoId, info.seconds), describe(info));
  } catch (err) {
    resultEl.hidden = true;
    setStatus(err instanceof Error ? err.message : String(err), "error");
  }
}

function show(url: string, meta: string): void {
  linkEl.href = url;
  linkEl.textContent = url;
  metaEl.textContent = meta;
  resultEl.hidden = false;
  setStatus("");
}

function describe(info: StampInfo): string {
  const parts = [`${formatOffset(info.seconds)} into the stream`];
  if (info.markedAt) parts.push(`aired ${info.markedAt.toLocaleString()}`);
  if (info.live)
    parts.push(
      "live stream — the link works once the DVR/archive is available",
    );
  return parts.join(" · ");
}

function setStatus(text: string, kind = ""): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

debugInput.addEventListener("input", update);

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(linkEl.href);
    // A failed copy leaves an error behind; clear it once one succeeds.
    setStatus("");
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1200);
  } catch {
    // Clipboard access can be denied (insecure context, permission); selecting
    // the link is the manual fallback.
    setStatus(
      "Could not write to the clipboard — select the link and copy it manually.",
      "error",
    );
  }
});

todoistBtn.addEventListener("click", async () => {
  const title = titleInput.value.trim();
  if (!title) {
    setStatus("Give the moment a title first.", "error");
    titleInput.focus();
    return;
  }
  if (!TODOIST_TOKEN) {
    setStatus(
      "No Todoist token in this build — set VITE_TODOIST_TOKEN in .env and rebuild.",
      "error",
    );
    return;
  }

  todoistBtn.disabled = true;
  todoistBtn.textContent = "Adding…";
  try {
    await addTask(`${title} - [${linkEl.href}]`);
    setStatus("Added to Todoist.");
    titleInput.value = "";
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "error");
  } finally {
    todoistBtn.disabled = false;
    todoistBtn.textContent = "Add to Todoist";
  }
});

async function addTask(content: string): Promise<void> {
  // ponytail: plain fetch, no SDK — one endpoint, one field. Add @doist/todoist-api
  // only if this grows beyond creating tasks.
  const res = await fetch("https://api.todoist.com/api/v1/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TODOIST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      TODOIST_PROJECT_ID
        ? { content, project_id: TODOIST_PROJECT_ID }
        : { content },
    ),
  });
  if (!res.ok) {
    throw new Error(
      `Todoist rejected the task (${res.status} ${res.statusText}).`,
    );
  }
}
