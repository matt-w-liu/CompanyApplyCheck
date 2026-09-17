const HIGHLIGHT_CLASS = "job-application-highlight";
const BADGE_CLASS = "job-application-badge";
const MARKER_ATTR = "data-jah-highlighted";
const DEBOUNCE_MS = 500;
const MAX_SCAN_WAIT_MS = 2000;
const URL_POLL_MS = 1000;
const DIRECTORY_SYNC_MS = 5000;
const PERIODIC_RESCAN_MS = 4000;

let companySet = new Set();
let companyDates = {};
let lastUrl = location.href;
let scanTimeout = null;
let pendingScanSince = null;
let initialized = false;

function normalizeCompanyName(name) {
  if (!name || typeof name !== "string") {
    return "";
  }

  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCurrentSite() {
  const site = getSiteKey();
  return site === "greenhouseSearch" ? "greenhouseSearch" : site;
}

const extractors = {
  ziprecruiter() {
    const results = [];
    const elements = document.querySelectorAll('a[data-testid="job-card-company"]');

    for (const element of elements) {
      const companyName = element.textContent;
      if (companyName) {
        results.push({ companyName, element });
      }
    }

    return results;
  },

  builtin() {
    const results = [];
    const links = document.querySelectorAll('a[data-id="company-title"]');

    for (const link of links) {
      const span = link.querySelector("span");
      const companyName = span ? span.textContent : link.textContent;
      if (companyName) {
        results.push({ companyName, element: link });
      }
    }

    return results;
  },

  indeed() {
    const results = [];
    const elements = document.querySelectorAll('span[data-testid="company-name"]');

    for (const element of elements) {
      const companyName = element.textContent;
      if (companyName) {
        results.push({ companyName, element });
      }
    }

    return results;
  },

  workable() {
    const results = [];
    const anchors = document.querySelectorAll(
      'h3[data-ui="job-card-company-label"] a, a[class*="companyName__link"]'
    );

    for (const element of anchors) {
      const companyName = element.textContent.trim();
      if (companyName) {
        results.push({ companyName, element });
      }
    }

    return results;
  },

  hiringCafe() {
    const results = [];
    const companySpans = document.querySelectorAll(
      'span[class*="line-clamp-3"] span.font-bold'
    );

    for (const element of companySpans) {
      const companyName = element.textContent.trim();
      if (companyName) {
        results.push({ companyName, element });
      }
    }

    return results;
  },

  jobright() {
    const results = [];
    const elements = document.querySelectorAll('div[class*="index_company-name"]');

    for (const element of elements) {
      const companyName = element.textContent;
      if (companyName) {
        results.push({ companyName, element });
      }
    }

    return results;
  },

  remoterocketship() {
    const results = [];
    const elements = document.querySelectorAll('h4[class*="text-md font-normal text-primary mr-2"]');

    for (const element of elements) {
      const tag = element.querySelectorAll("a");

      const companyName = tag[0].textContent.trim();

      if (companyName) {
        results.push({ companyName, element });
      }
    }

    return results;
  },

  glassdoor() {
    const results = [];
    const elements = document.querySelectorAll(
      'span[class^="EmployerProfile_compactEmployerName"]'
    );

    for (const element of elements) {
      const companyName = element.textContent;
      if (companyName) {
        results.push({ companyName, element });
      }
    }

    return results;
  },

  linkedin() {
    const results = [];
    const cards = document.querySelectorAll(
      'div[role="button"][componentkey^="job-card-component-ref-"]'
    );

    for (const card of cards) {
      const paragraphs = card.querySelectorAll("p");
      if (paragraphs.length < 2) {
        continue;
      }

      const companyElement = paragraphs[1];
      const companyName = companyElement.textContent.trim();
      if (companyName) {
        results.push({ companyName, element: companyElement });
      }
    }

    return results;
  },

  greenhouseSearch() {
    const results = [];
    const elements = document.querySelectorAll(
      'div[data-provides="search-result"] p.body:not(.body__secondary)'
    );

    for (const element of elements) {
      const companyName = element.textContent.trim();
      if (companyName) {
        results.push({ companyName, element });
      }
    }

    return results;
  },
};

function formatAppliedDate(timestamp) {
  if (!timestamp) {
    return "Applied";
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function loadCompanyDirectory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["companyNames", "companyDates"], (result) => {
      companySet = new Set(result.companyNames || []);
      companyDates = result.companyDates || {};
      resolve(companySet);
    });
  });
}

function extractCompanies() {
  const site = getCurrentSite();
  if (!site || !extractors[site]) {
    return [];
  }

  return extractors[site]();
}

function addOrUpdateBadge(element, normalized) {
  const badgeText = formatAppliedDate(companyDates[normalized]);
  const next = element.nextElementSibling;

  if (next && next.classList.contains(BADGE_CLASS)) {
    next.textContent = badgeText;
    return;
  }

  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  badge.textContent = badgeText;
  element.insertAdjacentElement("afterend", badge);
}

function highlightElement(element, normalized) {
  element.classList.add(HIGHLIGHT_CLASS);
  element.setAttribute(MARKER_ATTR, "true");
  element.setAttribute("data-jah-company", normalized);
  addOrUpdateBadge(element, normalized);
}

function clearHighlight(element) {
  element.classList.remove(HIGHLIGHT_CLASS);
  element.removeAttribute(MARKER_ATTR);
  element.removeAttribute("data-jah-company");

  const next = element.nextElementSibling;
  if (next && next.classList.contains(BADGE_CLASS)) {
    next.remove();
  }
}

function clearAllHighlights() {
  const highlighted = document.querySelectorAll(`[${MARKER_ATTR}="true"]`);
  for (const element of highlighted) {
    clearHighlight(element);
  }
}

function updateHighlights(matches) {
  for (const { companyName, element } of matches) {
    const normalized = normalizeCompanyName(companyName);
    if (!normalized) {
      continue;
    }

    const isHighlighted = element.getAttribute(MARKER_ATTR) === "true";
    const shouldHighlight = companySet.has(normalized);

    if (shouldHighlight && !isHighlighted) {
      highlightElement(element, normalized);
    } else if (shouldHighlight && isHighlighted) {
      addOrUpdateBadge(element, normalized);
    } else if (!shouldHighlight && isHighlighted) {
      clearHighlight(element);
    }
  }
}

function runScan() {
  if (!getCurrentSite()) {
    return;
  }

  if (companySet.size === 0) {
    clearAllHighlights();
    return;
  }

  const matches = extractCompanies();
  updateHighlights(matches);
}

function scheduleScan() {
  const now = Date.now();
  if (pendingScanSince === null) {
    pendingScanSince = now;
  }

  clearTimeout(scanTimeout);

  // Sites with continuous DOM churn (live badges, ad refreshes, chat widgets)
  // keep retriggering the debounce and would otherwise starve runScan()
  // forever. Force a scan once churn has been going on for MAX_SCAN_WAIT_MS.
  if (now - pendingScanSince >= MAX_SCAN_WAIT_MS) {
    pendingScanSince = null;
    runScan();
    return;
  }

  scanTimeout = setTimeout(() => {
    pendingScanSince = null;
    runScan();
  }, DEBOUNCE_MS);
}

function observeDomChanges() {
  // Observe documentElement rather than body: some SPAs (client-side route
  // changes) tear down and replace document.body wholesale, which would
  // silently detach an observer scoped to the old body node.
  const target = document.documentElement || document.body;
  if (!target) {
    return;
  }

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
    // React (and similar frameworks used by these job sites) frequently
    // updates an in-place list item's company name by mutating an existing
    // text node's data rather than replacing the node, which is a
    // characterData change, not a childList change. Without this, swapping
    // company names within a reused DOM node (e.g. re-sorted/filtered
    // results) went undetected until the next unrelated childList mutation.
    characterData: true,
  });
}

function observeUrlChanges() {
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    originalPushState(...args);
    lastUrl = location.href;
    runScan();
  };

  history.replaceState = function (...args) {
    originalReplaceState(...args);
    lastUrl = location.href;
    runScan();
  };

  window.addEventListener("popstate", () => {
    lastUrl = location.href;
    runScan();
  });

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      runScan();
    }
  }, URL_POLL_MS);
}

function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    if (changes.companyNames) {
      companySet = new Set(changes.companyNames.newValue || []);
    }

    if (changes.companyDates) {
      companyDates = changes.companyDates.newValue || {};
    }

    if (changes.companyNames || changes.companyDates) {
      rescanAllPages();
    }
  });
}

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "RELOAD_COMPANIES") {
      loadCompanyDirectory().then(rescanAllPages);
    }
  });
}

function rescanAllPages() {
  clearAllHighlights();
  runScan();
}

function requestDirectorySync() {
  chrome.runtime.sendMessage({ type: "REQUEST_DIRECTORY_SYNC" }).catch(() => { });
}

function setupDirectorySync() {
  setInterval(requestDirectorySync, DIRECTORY_SYNC_MS);
}

// Belt-and-suspenders full rescan: catches any case where the mutation
// observer misses a DOM change (detached target, extension frames that skip
// events while backgrounded, etc.) without waiting on a user-triggered
// refresh. updateHighlights() is idempotent, so this is a cheap no-op scan
// on pages that are already in sync.
function setupPeriodicRescan() {
  setInterval(runScan, PERIODIC_RESCAN_MS);
}

// Long-lived tabs (background tab left open, or restored from the
// back/forward cache) can miss storage updates or DOM mutations while
// inactive/frozen. Resync the company directory and rescan as soon as the
// tab is visible/restored again instead of relying on a manual refresh.
function setupVisibilityHandling() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadCompanyDirectory().then(runScan);
      requestDirectorySync();
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      loadCompanyDirectory().then(runScan);
      requestDirectorySync();
    }
  });
}

async function init() {
  if (initialized || !getSiteKey() || window.top !== window) {
    return;
  }

  initialized = true;

  if (extractors[getCurrentSite()]) {
    await loadCompanyDirectory();
    setupStorageListener();
    setupMessageListener();
    setupDirectorySync();
    setupPeriodicRescan();
    setupVisibilityHandling();
    observeUrlChanges();

    if (document.body) {
      observeDomChanges();
      runScan();
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          observeDomChanges();
          runScan();
        },
        { once: true }
      );
    }
  }
}

init();
