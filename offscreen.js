const POLL_INTERVAL_MS = 3000;
const OBSERVER_DEBOUNCE_MS = 500;

let pollTimer = null;
let fsObserver = null;
let observerDebounce = null;
let lastSnapshotKey = null;
let watching = false;
let syncInFlight = null;
let syncQueued = false;

function snapshotKey(data) {
  const names = [...data.names].sort().join("\0");
  const dates = Object.keys(data.dates)
    .sort()
    .map((key) => `${key}:${data.dates[key]}`)
    .join("\0");
  return `${names}|${dates}`;
}

function scheduleObserverSync() {
  clearTimeout(observerDebounce);
  observerDebounce = setTimeout(() => {
    syncDirectoryToBackground();
  }, OBSERVER_DEBOUNCE_MS);
}

async function readDirectorySnapshot() {
  const handle = await getDirectoryHandle();
  if (!handle) {
    return { ok: false, reason: "no-handle" };
  }

  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted") {
    return { ok: false, reason: "no-permission" };
  }

  const { names, dates } = await readAndBuildCompanyData(handle);
  const unique = [...new Set(names)];
  const key = snapshotKey({ names: unique, dates });

  return {
    ok: true,
    key,
    companyNames: unique,
    companyDates: dates,
    directoryName: handle.name,
  };
}

async function applySnapshot(snapshot) {
  if (!snapshot.ok) {
    return snapshot;
  }

  if (snapshot.key === lastSnapshotKey) {
    return { ok: true, changed: false };
  }

  try {
    await chrome.runtime.sendMessage({
      type: "DIRECTORY_SYNC",
      companyNames: snapshot.companyNames,
      companyDates: snapshot.companyDates,
      directoryName: snapshot.directoryName,
    });
    lastSnapshotKey = snapshot.key;
    return { ok: true, changed: true };
  } catch (error) {
    lastSnapshotKey = null;
    return { ok: false, reason: error.message };
  }
}

async function runDirectorySyncPass() {
  // Always finish with a fresh read if another sync was requested while we were
  // reading. That prevents an older in-flight scan from overwriting newer FS state.
  let result = { ok: true, changed: false };

  do {
    syncQueued = false;
    const snapshot = await readDirectorySnapshot();
    result = await applySnapshot(snapshot);
    if (!snapshot.ok) {
      return snapshot;
    }
  } while (syncQueued);

  return result;
}

function syncDirectoryToBackground() {
  syncQueued = true;

  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    try {
      return await runDirectorySyncPass();
    } finally {
      syncInFlight = null;
      if (syncQueued) {
        // A request arrived after the last pass cleared the flag but before
        // syncInFlight was cleared — kick one more coalesced sync.
        syncDirectoryToBackground();
      }
    }
  })();

  return syncInFlight;
}

async function startFileSystemObserver(handle) {
  if (typeof FileSystemObserver === "undefined") {
    return false;
  }

  try {
    if (fsObserver) {
      fsObserver.disconnect();
      fsObserver = null;
    }

    fsObserver = new FileSystemObserver(() => {
      scheduleObserverSync();
    });

    // Prefer recursive so nested resume adds inside company folders are seen
    // immediately; fall back to top-level-only if the browser rejects it.
    try {
      await fsObserver.observe(handle, { recursive: true });
    } catch {
      await fsObserver.observe(handle, { recursive: false });
    }
    return true;
  } catch (error) {
    console.warn("FileSystemObserver unavailable in offscreen document:", error);
    if (fsObserver) {
      fsObserver.disconnect();
      fsObserver = null;
    }
    return false;
  }
}

function startPolling() {
  if (pollTimer) {
    return;
  }

  pollTimer = setInterval(() => {
    syncDirectoryToBackground();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function startWatching() {
  if (watching) {
    stopWatching();
  }

  const handle = await getDirectoryHandle();
  if (!handle) {
    stopWatching();
    return { ok: false, reason: "no-handle" };
  }

  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted") {
    stopWatching();
    return { ok: false, reason: "no-permission" };
  }

  watching = true;
  lastSnapshotKey = null;
  await syncDirectoryToBackground();
  await startFileSystemObserver(handle);
  startPolling();
  return { ok: true };
}

function stopWatching() {
  watching = false;
  lastSnapshotKey = null;
  syncQueued = false;

  if (fsObserver) {
    fsObserver.disconnect();
    fsObserver = null;
  }

  clearTimeout(observerDebounce);
  observerDebounce = null;
  stopPolling();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_START_WATCH") {
    startWatching().then(sendResponse);
    return true;
  }

  if (message.type === "OFFSCREEN_STOP_WATCH") {
    stopWatching();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "OFFSCREEN_SYNC_NOW") {
    syncDirectoryToBackground().then(sendResponse);
    return true;
  }
});

startWatching();
