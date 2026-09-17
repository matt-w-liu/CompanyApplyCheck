const COPY_HOTKEY_STORAGE_KEY = "copyJobDescriptionHotkey";

const DEFAULT_COPY_HOTKEY = {
  ctrl: true,
  shift: true,
  alt: false,
  meta: false,
  key: "KeyJ",
};

function normalizeHotkey(hotkey) {
  if (!hotkey || !hotkey.key) {
    return null;
  }

  return {
    ctrl: Boolean(hotkey.ctrl),
    alt: Boolean(hotkey.alt),
    shift: Boolean(hotkey.shift),
    meta: Boolean(hotkey.meta),
    key: hotkey.key,
  };
}

function formatHotkeyLabel(hotkey) {
  const normalized = normalizeHotkey(hotkey);
  if (!normalized) {
    return "Not set";
  }

  const parts = [];

  if (normalized.ctrl) {
    parts.push("Ctrl");
  }
  if (normalized.alt) {
    parts.push("Alt");
  }
  if (normalized.shift) {
    parts.push("Shift");
  }
  if (normalized.meta) {
    parts.push("Meta");
  }

  parts.push(formatHotkeyKey(normalized.key));
  return parts.join("+");
}

function formatHotkeyKey(code) {
  if (!code) {
    return "";
  }

  if (code.startsWith("Key")) {
    return code.slice(3);
  }

  if (code.startsWith("Digit")) {
    return code.slice(5);
  }

  if (code.startsWith("Numpad")) {
    return code.slice(6);
  }

  return code;
}

function hotkeyFromKeyboardEvent(event) {
  if (!event.code || event.code === "ControlLeft" || event.code === "ControlRight") {
    return null;
  }
  if (
    event.code === "ShiftLeft" ||
    event.code === "ShiftRight" ||
    event.code === "AltLeft" ||
    event.code === "AltRight" ||
    event.code === "MetaLeft" ||
    event.code === "MetaRight"
  ) {
    return null;
  }

  if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    return null;
  }

  return normalizeHotkey({
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key: event.code,
  });
}

function matchesHotkey(event, hotkey) {
  const normalized = normalizeHotkey(hotkey);
  if (!normalized) {
    return false;
  }

  return (
    event.ctrlKey === normalized.ctrl &&
    event.altKey === normalized.alt &&
    event.shiftKey === normalized.shift &&
    event.metaKey === normalized.meta &&
    event.code === normalized.key
  );
}

function isEditableTarget(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const element = target;
  const tag = element.tagName;

  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  return element.isContentEditable;
}

async function getCopyHotkey() {
  const result = await chrome.storage.local.get([COPY_HOTKEY_STORAGE_KEY]);
  return normalizeHotkey(result[COPY_HOTKEY_STORAGE_KEY]) || { ...DEFAULT_COPY_HOTKEY };
}

async function saveCopyHotkey(hotkey) {
  const normalized = normalizeHotkey(hotkey);
  await chrome.storage.local.set({
    [COPY_HOTKEY_STORAGE_KEY]: normalized,
  });
  return normalized;
}

async function clearCopyHotkey() {
  await chrome.storage.local.remove(COPY_HOTKEY_STORAGE_KEY);
}
