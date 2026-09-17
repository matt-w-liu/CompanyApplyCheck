const COPY_BUTTON_ID = "jah-copy-job-description";
const COPY_BUTTON_CLASS = "jah-copy-job-description";
const COPY_BUTTON_LABEL = "Copy Job Description";
const COPY_DEBOUNCE_MS = 500;

const COPY_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const CHECK_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
const ERROR_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
const TOAST_DURATION_MS = 3000;

let copyButton = null;
let copyUiInitDone = false;
let copyHotkeyInitDone = false;
let copyScanTimeout = null;
let copyLastUrl = location.href;
let copyHotkey = null;
let copyHotkeyListenerReady = false;
const jobDescriptionExtractors = {
  ziprecruiter() {
    const element = document.querySelector('[data-testid="job-details-scroll-container"]');
    return getTextContent(element);
  },

  builtin() {
    const element = document.querySelector('div[id^="job-post-body-"]');
    return getTextContent(element);
  },

  indeed() {
    const element = document.querySelector(".simple-job-description-html");
    return getTextContent(element);
  },

  workable() {
    const element = document.querySelector('div[class^="jobBreakdown__job-breakdown--"]');
    return getTextContent(element);
  },

  jobright() {
    const parts = [];
    const intro = document.querySelector('div[class^="index_jobIntroduction"]');

    if (intro) {
      parts.push(getTextContent(intro));
    }

    for (const section of document.querySelectorAll('section[class^="index_sectionContent"]')) {
      parts.push(getTextContent(section));
    }

    return parts.filter(Boolean).join("\n\n");
  },

  glassdoor() {
    const element = document.querySelector('div[class^="JobDetails_jobDescription"]');
    return getTextContent(element);
  },

  linkedin() {
    const element = document.querySelector('div[componentkey^="JobDetails_AboutTheJob"]');
    return getTextContent(element);
  },

  greenhouse() {
    const element = document.querySelector("div.job__description.body");
    return getTextContent(element);
  },

  ashbyhq() {
    const element = document.querySelector('div[aria-labelledby="job-overview"]');
    return getTextContent(element);
  },

  rippling() {
    const element = document.querySelector("div.ATS_htmlPreview");
    return getTextContent(element);
  },

  workday() {
    const element = document.querySelector('[data-automation-id="job-posting-details"]');
    return getTextContent(element);
  },

  lever() {
    const element = document.querySelector(".posting-page");
    return getTextContent(element);
  },

  paylocity() {
    const element = document.querySelector(".job-preview-details");
    return getTextContent(element);
  },

  jobvite() {
    const element = document.querySelector(".jv-job-detail-description");
    return getTextContent(element);
  },

  icims() {
    const selectors = [
      ".iCIMS_JobContent",
      ".iCIMS_Expandable_Container",
      '[class*="iCIMS_JobContent"]',
      '[class*="iCIMS_Expandable_Container"]',
      '[class*="iCIMS_Expandable"]',
      "#icims_content",
    ];
    const roots = [getTopAccessibleDocument()];

    if (document !== roots[0]) {
      roots.push(document);
    }

    let bestElement = null;
    let bestLength = 0;

    for (const root of roots) {
      const element = findBestElementInAllFrames(selectors, root);
      const length = getTextContent(element).length;

      if (length > bestLength) {
        bestLength = length;
        bestElement = element;
      }
    }

    return getTextContent(bestElement);
  },

  smartrecruiters() {
    const element = document.querySelector('div[itemprop="description"]');
    return getTextContent(element);
  },

  applytojob() {
    const element = document.querySelector("#job-description");
    return getTextContent(element);
  },
  
  remoterocketship() {
    const elements = document.querySelectorAll('p[class*="whitespace-pre-line"]');

    let result = "";

    for (const element of elements) {
      result += getTextContent(element) + "\n";
    }

    return result;
  },
};

async function loadCopyHotkeySettings() {
  copyHotkey = await getCopyHotkey();
}

function onCopyHotkey(event) {
  if (!copyHotkey || !copyHotkey.key) {
    return;
  }

  if (!jobDescriptionExtractors[getSiteKey()]) {
    return;
  }

  if (isEditableTarget(event.target)) {
    return;
  }

  if (!matchesHotkey(event, copyHotkey)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  handleCopyClick();
}

function setupCopyHotkeyListener() {
  if (copyHotkeyListenerReady) {
    return;
  }

  copyHotkeyListenerReady = true;
  window.addEventListener("keydown", onCopyHotkey, true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[COPY_HOTKEY_STORAGE_KEY]) {
      copyHotkey = normalizeHotkey(changes[COPY_HOTKEY_STORAGE_KEY].newValue);
    }
  });
}

function extractJobDescription() {
  const site = getSiteKey();
  if (!site || !jobDescriptionExtractors[site]) {
    return "";
  }

  return jobDescriptionExtractors[site]();
}

function getUiDocument() {
  return getTopAccessibleDocument();
}

function setCopyButtonIcon(button, iconSvg) {
  button.innerHTML = iconSvg;
}

function ensureCopyButton() {
  const uiDocument = getUiDocument();

  if (copyButton && uiDocument.body.contains(copyButton)) {
    return copyButton;
  }

  copyButton = uiDocument.getElementById(COPY_BUTTON_ID);
  if (copyButton) {
    return copyButton;
  }

  copyButton = uiDocument.createElement("button");
  copyButton.id = COPY_BUTTON_ID;
  copyButton.type = "button";
  copyButton.className = COPY_BUTTON_CLASS;
  copyButton.setAttribute("aria-label", COPY_BUTTON_LABEL);
  copyButton.title = COPY_BUTTON_LABEL;
  setCopyButtonIcon(copyButton, COPY_ICON_SVG);
  copyButton.addEventListener("click", handleCopyClick);
  uiDocument.body.appendChild(copyButton);
  return copyButton;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showToast(message, type = "success") {
  const uiDocument = getUiDocument();
  const toast = uiDocument.createElement("div");
  toast.className = `jah-toast jah-toast--${type}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  uiDocument.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("jah-toast--visible");
  });

  setTimeout(() => {
    toast.classList.remove("jah-toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 300);
  }, TOAST_DURATION_MS);
}

function showCopyFeedback(message, isError = false) {
  const button = ensureCopyButton();
  button.setAttribute("aria-label", message);
  button.title = message;
  button.classList.toggle("jah-copy-job-description--error", isError);
  button.classList.toggle("jah-copy-job-description--success", !isError);
  setCopyButtonIcon(button, isError ? ERROR_ICON_SVG : CHECK_ICON_SVG);

  clearTimeout(button._jahFeedbackTimer);
  button._jahFeedbackTimer = setTimeout(() => {
    button.setAttribute("aria-label", COPY_BUTTON_LABEL);
    button.title = COPY_BUTTON_LABEL;
    button.classList.remove("jah-copy-job-description--error", "jah-copy-job-description--success");
    setCopyButtonIcon(button, COPY_ICON_SVG);
  }, 2000);
}

async function handleCopyClick() {
  const description = extractJobDescription();

  if (!description) {
    showCopyFeedback("No description found", true);
    return;
  }

  try {
    await copyTextToClipboard(description);
    showCopyFeedback("Copied!");
    showToast("Job description copied to clipboard");
  } catch {
    showCopyFeedback("Copy failed", true);
  }
}

function updateCopyButtonVisibility() {
  const site = getSiteKey();
  if (!site || !jobDescriptionExtractors[site]) {
    if (copyButton) {
      copyButton.style.display = "none";
    }
    return;
  }

  const description = extractJobDescription();
  const button = ensureCopyButton();
  button.style.display = description ? "flex" : "none";
}

function scheduleCopyButtonUpdate() {
  clearTimeout(copyScanTimeout);
  copyScanTimeout = setTimeout(updateCopyButtonVisibility, COPY_DEBOUNCE_MS);
}

function observeCopyDomChanges() {
  if (!document.body) {
    return;
  }

  const observer = new MutationObserver(() => {
    scheduleCopyButtonUpdate();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function observeCopyUrlChanges() {
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    originalPushState(...args);
    copyLastUrl = location.href;
    scheduleCopyButtonUpdate();
  };

  history.replaceState = function (...args) {
    originalReplaceState(...args);
    copyLastUrl = location.href;
    scheduleCopyButtonUpdate();
  };

  window.addEventListener("popstate", () => {
    copyLastUrl = location.href;
    scheduleCopyButtonUpdate();
  });

  setInterval(() => {
    if (location.href !== copyLastUrl) {
      copyLastUrl = location.href;
      scheduleCopyButtonUpdate();
    }
  }, 1000);
}

function initJobDescriptionCopy() {
  const site = getSiteKey();
  if (!site || !jobDescriptionExtractors[site]) {
    return;
  }

  if (!copyHotkeyInitDone) {
    copyHotkeyInitDone = true;
    loadCopyHotkeySettings();
    setupCopyHotkeyListener();
  }

  if (window.top !== window) {
    return;
  }

  if (copyUiInitDone) {
    scheduleCopyButtonUpdate();
    return;
  }

  copyUiInitDone = true;
  observeCopyUrlChanges();

  if (document.body) {
    observeCopyDomChanges();
    updateCopyButtonVisibility();
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        observeCopyDomChanges();
        updateCopyButtonVisibility();
      },
      { once: true }
    );
  }
}

initJobDescriptionCopy();
