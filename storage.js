const DB_NAME = "JobApplicationHighlighter";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const HANDLE_KEY = "resumeDirectory";
const COMPANY_NAMES_KEY = "companyNames";
const COMPANY_DATES_KEY = "companyDates";
const DIRECTORY_NAME_KEY = "directoryName";
const COMPANY_COUNT_KEY = "companyCount";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      event.target.result.createObjectStore(STORE_NAME);
    };
  });
}

async function saveDirectoryHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getDirectoryHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function clearDirectoryHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function normalizeCompanyName(name) {
  if (!name || typeof name !== "string") {
    return "";
  }

  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCompanyNameFromPdfFile(fileName) {
  if (!/\.pdf$/i.test(fileName)) {
    return null;
  }

  return fileName.replace(/\.pdf$/i, "");
}

async function getFileLastModified(fileHandle) {
  const file = await fileHandle.getFile();
  return file.lastModified;
}

async function getDirectoryAppliedDate(dirHandle) {
  let earliest = null;

  for await (const entry of dirHandle.values()) {
    if (entry.kind !== "file") {
      continue;
    }

    const modified = await getFileLastModified(entry);
    if (earliest === null || modified < earliest) {
      earliest = modified;
    }
  }

  return earliest;
}

async function readCompanyEntries(handle) {
  const entries = [];

  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      entries.push({
        name: entry.name,
        appliedDate: await getDirectoryAppliedDate(entry),
      });
      continue;
    }

    if (entry.kind === "file") {
      const pdfName = getCompanyNameFromPdfFile(entry.name);
      if (pdfName) {
        entries.push({
          name: pdfName,
          appliedDate: await getFileLastModified(entry),
        });
      }
    }
  }

  return entries;
}

function buildCompanyDataFromEntries(entries) {
  const dates = {};
  const names = new Set();

  for (const entry of entries) {
    const normalized = normalizeCompanyName(entry.name);
    if (!normalized) {
      continue;
    }

    names.add(normalized);

    if (entry.appliedDate == null) {
      continue;
    }

    const existing = dates[normalized];
    if (existing == null || entry.appliedDate < existing) {
      dates[normalized] = entry.appliedDate;
    }
  }

  return {
    names: [...names],
    dates,
  };
}

async function readAndBuildCompanyData(handle) {
  const entries = await readCompanyEntries(handle);
  return buildCompanyDataFromEntries(entries);
}

async function readCompanyFolders(handle) {
  const { names } = await readAndBuildCompanyData(handle);
  return names;
}

async function ensureDirectoryPermission(handle) {
  const current = await handle.queryPermission({ mode: "read" });
  if (current === "granted") {
    return true;
  }

  const requested = await handle.requestPermission({ mode: "read" });
  return requested === "granted";
}

function companyListsEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function companyDatesEqual(a, b) {
  const left = a || {};
  const right = b || {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

function companyDataEqual(storedNames, storedDates, nextNames, nextDates) {
  return companyListsEqual(storedNames, nextNames) && companyDatesEqual(storedDates, nextDates);
}

async function syncCompanyNamesFromHandle(handle, options = {}) {
  const { force = false } = options;
  const { names, dates } = await readAndBuildCompanyData(handle);
  const unique = [...new Set(names)];
  const stored = await getCompanyNames();
  const storedDates = await getCompanyDates();

  if (!force && companyDataEqual(stored, storedDates, unique, dates)) {
    return { names: unique, dates, normalized: unique, changed: false };
  }

  await chrome.storage.local.set({
    [COMPANY_NAMES_KEY]: unique,
    [COMPANY_DATES_KEY]: dates,
    [DIRECTORY_NAME_KEY]: handle.name,
    [COMPANY_COUNT_KEY]: unique.length,
  });

  return { names: unique, dates, normalized: unique, changed: true };
}

async function syncCompanyNamesFromStoredHandle(options = {}) {
  const handle = await getDirectoryHandle();
  if (!handle) {
    return null;
  }

  const granted = await ensureDirectoryPermission(handle);
  if (!granted) {
    throw new Error("Permission to access the resume directory was denied.");
  }

  return syncCompanyNamesFromHandle(handle, options);
}

async function syncCompanyNamesIfPermitted() {
  const handle = await getDirectoryHandle();
  if (!handle) {
    return { changed: false, reason: "no-handle" };
  }

  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted") {
    return { changed: false, reason: "no-permission" };
  }

  const result = await syncCompanyNamesFromHandle(handle);
  return { ...result, changed: result.changed };
}

async function saveCompanyNames(names) {
  const unique = [...new Set(names.filter(Boolean))];
  await chrome.storage.local.set({
    [COMPANY_NAMES_KEY]: unique,
    [COMPANY_COUNT_KEY]: unique.length,
  });
  return unique;
}

async function getCompanyNames() {
  const result = await chrome.storage.local.get([COMPANY_NAMES_KEY]);
  return result[COMPANY_NAMES_KEY] || [];
}

async function getCompanyDates() {
  const result = await chrome.storage.local.get([COMPANY_DATES_KEY]);
  return result[COMPANY_DATES_KEY] || {};
}

async function getStoredDirectoryInfo() {
  return chrome.storage.local.get([
    DIRECTORY_NAME_KEY,
    COMPANY_COUNT_KEY,
    COMPANY_NAMES_KEY,
    COMPANY_DATES_KEY,
  ]);
}

async function refreshCompaniesFromStoredHandle() {
  return syncCompanyNamesFromStoredHandle({ force: false });
}
