function getSiteKey() {
  const host = location.hostname.toLowerCase();

  if (host.includes("ziprecruiter.com")) return "ziprecruiter";
  if (host.includes("builtin.com")) return "builtin";
  if (host.includes("indeed.com")) return "indeed";
  if (host.includes("workable.com")) return "workable";
  if (host.includes("hiring.cafe")) return "hiringCafe";
  if (host.includes("jobright.ai")) return "jobright";
  if (host.includes("glassdoor.com")) return "glassdoor";
  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("my.greenhouse.io")) return "greenhouseSearch";
  if (host.includes("greenhouse.io")) return "greenhouse";
  if (host.includes("ashbyhq.com")) return "ashbyhq";
  if (host.includes("rippling.com")) return "rippling";
  if (host.includes("myworkdayjobs.com")) return "workday";
  if (host.includes("jobs.lever.co")) return "lever";
  if (host.includes("recruiting.paylocity.com")) return "paylocity";
  if (host.includes("jobs.jobvite.com")) return "jobvite";
  if (host.includes("icims.com")) return "icims";
  if (host.includes("smartrecruiters.com")) return "smartrecruiters";
  if (host.includes("applytojob.com")) return "applytojob";
  if (host.includes("remoterocketship.com")) return "remoterocketship";

  return null;
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

function normalizeExtractedText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getStructuredTextContent(element) {
  const parts = [];

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) {
        parts.push(text);
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const tag = node.tagName;

    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
      return;
    }

    if (tag === "BR") {
      parts.push("\n");
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && parts.length > 0 && parts[parts.length - 1] !== "\n") {
      parts.push("\n");
    }

    for (const child of node.childNodes) {
      walk(child);
    }

    if (isBlock && parts.length > 0 && parts[parts.length - 1] !== "\n") {
      parts.push("\n");
    }
  }

  walk(element);

  return normalizeExtractedText(parts.join(""));
}

function getTextContent(element) {
  if (!element) {
    return "";
  }

  const innerText = element.innerText;
  if (innerText && innerText.trim()) {
    return normalizeExtractedText(innerText);
  }

  return getStructuredTextContent(element);
}

function getTopAccessibleDocument() {
  try {
    const topDoc = window.top.document;
    if (topDoc) {
      return topDoc;
    }
  } catch {
    // Cross-origin parent.
  }

  return document;
}

function getIframeDocuments(root = document) {
  const documents = [root];

  for (const iframe of root.querySelectorAll("iframe")) {
    try {
      const doc = iframe.contentDocument;
      if (doc && !documents.includes(doc)) {
        documents.push(doc);
        documents.push(...getIframeDocuments(doc).slice(1));
      }
    } catch {
      // Cross-origin iframe.
    }
  }

  return documents;
}

function querySelectorInAllFrames(selectors, root = document) {
  for (const doc of getIframeDocuments(root)) {
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (element) {
        return element;
      }
    }
  }

  return null;
}

function findBestElementInAllFrames(selectors, root = document) {
  let bestElement = null;
  let bestLength = 0;

  for (const doc of getIframeDocuments(root)) {
    for (const selector of selectors) {
      for (const element of doc.querySelectorAll(selector)) {
        const length = getTextContent(element).length;
        if (length > bestLength) {
          bestLength = length;
          bestElement = element;
        }
      }
    }
  }

  return bestElement;
}
