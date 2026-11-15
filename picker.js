// Folder selection runs in a regular extension tab instead of the action
// popup: the popup is closed by Chrome as soon as it loses focus (native file
// dialog, "Let site view files?" prompt), which kills the pending
// showDirectoryPicker() promise before the handle can be saved.

const pickBtn = document.getElementById("pickBtn");
const messageEl = document.getElementById("message");
const CLOSE_DELAY_MS = 1500;

function showMessage(text, kind) {
  messageEl.textContent = text;
  messageEl.className = `message ${kind}`;
}

function clearMessage() {
  messageEl.textContent = "";
  messageEl.className = "message";
}

async function sendMessageSafe(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // Background may be inactive; storage listeners still pick up changes.
  }
}

async function closeSelf() {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.remove(tab.id);
      return;
    }
  } catch {
    // Fall through to window.close().
  }
  window.close();
}

pickBtn.addEventListener("click", async () => {
  clearMessage();
  pickBtn.disabled = true;

  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });

    const granted = await ensureDirectoryPermission(handle);
    if (!granted) {
      throw new Error("Permission to read the selected directory was denied.");
    }

    await saveDirectoryHandle(handle);
    const { normalized } = await syncCompanyNamesFromHandle(handle, { force: true });
    await sendMessageSafe({ type: "COMPANIES_UPDATED" });
    await sendMessageSafe({ type: "START_DIRECTORY_WATCH" });

    showMessage(
      `Selected "${handle.name}" — ${normalized.length} companies tracked.`,
      "success"
    );
    setTimeout(closeSelf, CLOSE_DELAY_MS);
  } catch (error) {
    pickBtn.disabled = false;
    if (error.name === "AbortError") {
      return;
    }
    showMessage(error.message || "Failed to select directory.", "error");
  }
});
