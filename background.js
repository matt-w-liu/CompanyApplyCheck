importScripts("storage.js");

const OFFSCREEN_PATH = "offscreen.html";
const DIRECTORY_POLL_ALARM = "directoryPoll";
const OFFSCREEN_START_RETRIES = 5;
const OFFSCREEN_START_RETRY_MS = 200;

let creatingOffscreen = null;
let applySyncChain = Promise.resolve();

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) {
    return false;
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  return contexts.length > 0;
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return true;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return hasOffscreenDocument();
  }

  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["LOCAL_STORAGE"],
      justification:
        "Monitor the selected resume directory for folder add/remove changes.",
    })
    .catch((error) => {
      if (
        error.message &&
        error.message.includes("Only a single offscreen document may be created")
      ) {
        return;
      }
      throw error;
    });

  try {
    await creatingOffscreen;
    return true;
  } finally {
    creatingOffscreen = null;
  }
}

async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) {
    return;
  }

  await chrome.offscreen.closeDocument();
}

function sendOffscreenMessage(message) {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

async function ensureOffscreenWatching() {
  await setupOffscreenDocument();

  for (let attempt = 0; attempt < OFFSCREEN_START_RETRIES; attempt += 1) {
    const result = await sendOffscreenMessage({ type: "OFFSCREEN_START_WATCH" });
    if (result && result.ok) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, OFFSCREEN_START_RETRY_MS));
  }

  return false;
}

function ensureDirectoryPollAlarm() {
  chrome.alarms.create(DIRECTORY_POLL_ALARM, { periodInMinutes: 1 });
}

async function applyDirectorySync(payload) {
  const run = async () => {
    const incoming = payload.companyNames || [];
    const incomingDates = payload.companyDates || {};
    const stored = await getCompanyNames();
    const storedDates = await getCompanyDates();

    if (companyDataEqual(stored, storedDates, incoming, incomingDates)) {
      return { changed: false };
    }

    await chrome.storage.local.set({
      companyNames: incoming,
      companyDates: incomingDates,
      directoryName: payload.directoryName || "",
      companyCount: incoming.length,
    });

    return { changed: true };
  };

  applySyncChain = applySyncChain.then(run, run);
  return applySyncChain;
}

async function startDirectoryWatch() {
  const handle = await getDirectoryHandle();
  if (!handle) {
    await stopDirectoryWatch();
    return { watching: false, reason: "no-handle" };
  }

  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted") {
    // Keep a retry alarm so watching can resume after the user re-grants
    // permission via Refresh / Select Directory.
    await sendOffscreenMessage({ type: "OFFSCREEN_STOP_WATCH" });
    await closeOffscreenDocument();
    ensureDirectoryPollAlarm();
    return { watching: false, reason: "no-permission" };
  }

  await syncCompanyNamesIfPermitted();

  try {
    const started = await ensureOffscreenWatching();
    ensureDirectoryPollAlarm();
    return { watching: true, offscreen: started };
  } catch (error) {
    console.warn("Offscreen monitor unavailable, using alarm fallback:", error);
    ensureDirectoryPollAlarm();
    return { watching: true, offscreen: false, fallback: "alarms" };
  }
}

async function stopDirectoryWatch() {
  chrome.alarms.clear(DIRECTORY_POLL_ALARM);
  await sendOffscreenMessage({ type: "OFFSCREEN_STOP_WATCH" });
  await closeOffscreenDocument();
}

async function requestDirectorySync() {
  const handle = await getDirectoryHandle();
  if (!handle) {
    return { ok: false, reason: "no-handle" };
  }

  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted") {
    return { ok: false, reason: "no-permission" };
  }

  // Permission may have been re-granted while the offscreen watcher was down.
  if (!(await hasOffscreenDocument())) {
    const started = await startDirectoryWatch();
    if (started.watching) {
      return { ok: true, restarted: true };
    }
  }

  if (await hasOffscreenDocument()) {
    const offscreenResult = await sendOffscreenMessage({ type: "OFFSCREEN_SYNC_NOW" });
    if (offscreenResult) {
      return offscreenResult;
    }
  }

  return syncCompanyNamesIfPermitted();
}

function notifyContentScripts(payload) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) {
        continue;
      }

      chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  startDirectoryWatch();
});

chrome.runtime.onStartup.addListener(() => {
  startDirectoryWatch();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DIRECTORY_POLL_ALARM) {
    requestDirectorySync();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "COMPANIES_UPDATED") {
    notifyContentScripts({ type: "RELOAD_COMPANIES" });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "START_DIRECTORY_WATCH") {
    startDirectoryWatch().then(sendResponse);
    return true;
  }

  if (message.type === "STOP_DIRECTORY_WATCH") {
    stopDirectoryWatch().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "REQUEST_DIRECTORY_SYNC") {
    requestDirectorySync().then(sendResponse);
    return true;
  }

  if (message.type === "DIRECTORY_SYNC") {
    applyDirectorySync(message).then(sendResponse);
    return true;
  }

  if (message.type === "GET_COMPANY_COUNT") {
    chrome.storage.local.get(["companyCount"], (result) => {
      sendResponse({ count: result.companyCount || 0 });
    });
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.companyNames || changes.companyDates)) {
    notifyContentScripts({ type: "RELOAD_COMPANIES" });
  }

  if (changes.directoryName) {
    startDirectoryWatch();
  }
});

startDirectoryWatch();
