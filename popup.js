const selectBtn = document.getElementById("selectBtn");
const refreshBtn = document.getElementById("refreshBtn");
const directoryNameEl = document.getElementById("directoryName");
const companyCountEl = document.getElementById("companyCount");
const errorBox = document.getElementById("errorBox");
const emptyHint = document.getElementById("emptyHint");
const hotkeyInput = document.getElementById("hotkeyInput");
const clearHotkeyBtn = document.getElementById("clearHotkeyBtn");

let isRecordingHotkey = false;
function showError(message) {
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

function clearError() {
  errorBox.textContent = "";
  errorBox.style.display = "none";
}

function updateUI(info) {
  const hasDirectory = Boolean(info.directoryName);
  directoryNameEl.textContent = info.directoryName || "Not selected";
  companyCountEl.textContent = String(info.companyCount || 0);
  refreshBtn.disabled = !hasDirectory;
  emptyHint.style.display = hasDirectory ? "none" : "block";
}

async function loadStoredState() {
  const info = await getStoredDirectoryInfo();
  updateUI({
    directoryName: info.directoryName,
    companyCount: info.companyCount || (info.companyNames || []).length,
  });
}

async function notifyTabsUpdated() {
  try {
    await chrome.runtime.sendMessage({ type: "COMPANIES_UPDATED" });
  } catch {
    // Background may be inactive; storage listener still notifies tabs.
  }
}

async function startDirectoryWatch() {
  try {
    await chrome.runtime.sendMessage({ type: "START_DIRECTORY_WATCH" });
  } catch {
    // Background may be inactive; it will restart watch on next wake.
  }
}

function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    if (!changes.directoryName && !changes.companyCount && !changes.companyNames) {
      return;
    }

    loadStoredState();
  });
}

async function handleDirectorySelected(handle) {
  const granted = await ensureDirectoryPermission(handle);
  if (!granted) {
    throw new Error("Permission to read the selected directory was denied.");
  }

  await saveDirectoryHandle(handle);
  const { normalized } = await syncCompanyNamesFromHandle(handle);
  updateUI({ directoryName: handle.name, companyCount: normalized.length });
  await notifyTabsUpdated();
  await startDirectoryWatch();
}

selectBtn.addEventListener("click", async () => {
  clearError();

  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    await handleDirectorySelected(handle);
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    showError(error.message || "Failed to select directory.");
  }
});

refreshBtn.addEventListener("click", async () => {
  clearError();
  refreshBtn.disabled = true;

  try {
    const result = await refreshCompaniesFromStoredHandle();
    if (!result) {
      showError("No saved directory found. Please select a directory first.");
      return;
    }

    updateUI({
      directoryName: (await getStoredDirectoryInfo()).directoryName,
      companyCount: result.normalized.length,
    });
    await notifyTabsUpdated();
    // Refresh re-grants FS permission under a user gesture; restart the live
    // watcher so later directory changes sync without another click.
    await startDirectoryWatch();
  } catch (error) {
    showError(error.message || "Failed to refresh company list.");
  } finally {
    refreshBtn.disabled = false;
  }
});

async function loadHotkeySettings() {
  const hotkey = await getCopyHotkey();
  hotkeyInput.value = formatHotkeyLabel(hotkey);
}

function setHotkeyRecording(active) {
  isRecordingHotkey = active;
  hotkeyInput.classList.toggle("is-recording", active);
  hotkeyInput.placeholder = active ? "Press a key combination..." : "";
}

hotkeyInput.addEventListener("focus", () => {
  setHotkeyRecording(true);
  hotkeyInput.value = "";
});

hotkeyInput.addEventListener("blur", async () => {
  setHotkeyRecording(false);
  await loadHotkeySettings();
});

hotkeyInput.addEventListener("keydown", async (event) => {
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    hotkeyInput.blur();
    return;
  }

  if (event.key === "Backspace") {
    await saveCopyHotkey({ ...DEFAULT_COPY_HOTKEY });
    hotkeyInput.value = formatHotkeyLabel(DEFAULT_COPY_HOTKEY);
    hotkeyInput.blur();
    return;
  }

  const hotkey = hotkeyFromKeyboardEvent(event);
  if (!hotkey) {
    return;
  }

  await saveCopyHotkey(hotkey);
  hotkeyInput.value = formatHotkeyLabel(hotkey);
  hotkeyInput.blur();
});

clearHotkeyBtn.addEventListener("click", async () => {
  await clearCopyHotkey();
  await loadHotkeySettings();
});

setupStorageListener();
loadStoredState();
loadHotkeySettings();