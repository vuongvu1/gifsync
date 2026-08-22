import "./theme";

import type { StampInfo } from "./ytstamp";
import { formatOffset, parseDebugInfo, timestampUrl } from "./ytstamp";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <a class="back" href="/">← all tools</a>
  <h1>live timestamp</h1>
  <p class="note">
    Mark a moment in a live stream you can come back to. In the YouTube player,
    right-click → <strong>Copy debug info</strong>, then paste it below. The link
    points at the playhead position the moment you copied.
  </p>
  <label class="field wide">
    Player debug info
    <textarea id="debug" rows="7" spellcheck="false" placeholder='{ "ns": "yt", … }'></textarea>
  </label>
  <div class="controls">
    <label class="field">
      Rewind (seconds)
      <input id="rewind" type="number" min="0" step="1" value="0" />
    </label>
  </div>
  <div id="result" hidden>
    <div class="result-row">
      <a id="link" class="result-link" target="_blank" rel="noreferrer"></a>
      <button id="copy" type="button">Copy</button>
    </div>
    <p class="hint" id="meta"></p>
  </div>
  <div id="status"></div>
`;

const debugInput = app.querySelector<HTMLTextAreaElement>("#debug")!;
const rewindInput = app.querySelector<HTMLInputElement>("#rewind")!;
const resultEl = app.querySelector<HTMLDivElement>("#result")!;
const linkEl = app.querySelector<HTMLAnchorElement>("#link")!;
const copyBtn = app.querySelector<HTMLButtonElement>("#copy")!;
const metaEl = app.querySelector<HTMLParagraphElement>("#meta")!;
const statusEl = app.querySelector<HTMLDivElement>("#status")!;

function rewindSec(): number {
  const n = Number(rewindInput.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function update(): void {
  // Blank input is the starting state, not an error — say nothing until there
  // is something to react to.
  if (!debugInput.value.trim()) {
    resultEl.hidden = true;
    statusEl.textContent = "";
    statusEl.className = "";
    return;
  }

  try {
    const info = parseDebugInfo(debugInput.value);
    const rewind = rewindSec();
    const url = timestampUrl(info.videoId, info.seconds, rewind);
    linkEl.href = url;
    linkEl.textContent = url;
    metaEl.textContent = describe(info, rewind);
    resultEl.hidden = false;
    statusEl.textContent = "";
    statusEl.className = "";
  } catch (err) {
    resultEl.hidden = true;
    statusEl.className = "error";
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

// Rewinding moves the wall clock too, so the two readings can't disagree.
function describe(info: StampInfo, rewind: number): string {
  const seconds = Math.max(0, info.seconds - rewind);
  const parts = [`${formatOffset(seconds)} into the stream`];
  if (info.markedAt) {
    const airedAt = new Date(info.markedAt.getTime() - (info.seconds - seconds) * 1000);
    parts.push(`aired ${airedAt.toLocaleString()}`);
  }
  if (info.live) parts.push("live stream — the link works once the DVR/archive is available");
  return parts.join(" · ");
}

debugInput.addEventListener("input", update);
rewindInput.addEventListener("input", update);

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(linkEl.href);
    // A failed copy leaves an error behind; clear it once one succeeds.
    statusEl.textContent = "";
    statusEl.className = "";
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1200);
  } catch {
    // Clipboard access can be denied (insecure context, permission); selecting
    // the link is the manual fallback.
    statusEl.className = "error";
    statusEl.textContent = "Could not write to the clipboard — select the link and copy it manually.";
  }
});
