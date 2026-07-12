/**
 * Bash-like readline keybindings for text input.
 *
 * Supported:
 * - Ctrl-A: cursor to beginning
 * - Ctrl-E: cursor to end
 * - Ctrl-W: delete previous word
 * - Ctrl-U: delete from cursor to beginning
 * - Ctrl-K: delete from cursor to end
 * - Ctrl-B: move cursor back one char (unless tmuxPrefix is Ctrl-B)
 * - Ctrl-F: move cursor forward one char
 * - Ctrl-D: delete char under cursor
 * - Alt-B: move back one word
 * - Alt-F: move forward one word
 * - Alt-D: delete word forward
 *
 * Returns true if the event was handled (prevents default + stops propagation).
 */
export function handleBashKeydown(
  e: KeyboardEvent,
  textarea: HTMLTextAreaElement | HTMLInputElement,
  tmuxPrefixKey?: string,
): boolean {
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    return handleAltKey(e, textarea);
  }

  if (!e.ctrlKey || e.metaKey) return false;

  // Skip if this is the tmux prefix key (tmux mode handles it separately)
  const prefix = tmuxPrefixKey ?? '';
  const eventKey = `ctrl-${e.key.toLowerCase()}`;
  if (prefix && eventKey === prefix) return false;

  switch (e.key.toLowerCase()) {
    case 'a':
      e.preventDefault();
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;
      return true;

    case 'e':
      e.preventDefault();
      const len = textarea.value.length;
      textarea.selectionStart = len;
      textarea.selectionEnd = len;
      return true;

    case 'w':
      e.preventDefault();
      deletePreviousWord(textarea);
      return true;

    case 'u':
      e.preventDefault();
      deleteToBeginning(textarea);
      return true;

    case 'k':
      e.preventDefault();
      deleteToEnd(textarea);
      return true;

    case 'b': {
      e.preventDefault();
      const posB = textarea.selectionStart ?? 0;
      if (posB > 0) {
        const newPos = posB - 1;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
      }
      return true;
    }

    case 'f': {
      e.preventDefault();
      const posF = textarea.selectionStart ?? 0;
      if (posF < textarea.value.length) {
        const newPos = posF + 1;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
      }
      return true;
    }

    case 'd':
      e.preventDefault();
      deleteCharForward(textarea);
      return true;

    default:
      return false;
  }
}

function handleAltKey(
  e: KeyboardEvent,
  textarea: HTMLTextAreaElement | HTMLInputElement,
): boolean {
  switch (e.key.toLowerCase()) {
    case 'b':
      e.preventDefault();
      moveWordBack(textarea);
      return true;

    case 'f':
      e.preventDefault();
      moveWordForward(textarea);
      return true;

    case 'd':
      e.preventDefault();
      deleteWordForward(textarea);
      return true;

    default:
      return false;
  }
}

function deletePreviousWord(textarea: HTMLTextAreaElement | HTMLInputElement): void {
  const value = textarea.value;
  const cursor = textarea.selectionStart ?? 0;

  // Skip trailing whitespace before cursor
  let i = cursor;
  while (i > 0 && /\s/.test(value[i - 1])) i--;

  // Skip non-whitespace
  while (i > 0 && !/\s/.test(value[i - 1])) i--;

  textarea.value = value.slice(0, i) + value.slice(cursor);
  textarea.selectionStart = i;
  textarea.selectionEnd = i;
  dispatchInput(textarea);
}

function deleteToBeginning(textarea: HTMLTextAreaElement | HTMLInputElement): void {
  const value = textarea.value;
  const cursor = textarea.selectionStart ?? 0;
  textarea.value = value.slice(cursor);
  textarea.selectionStart = 0;
  textarea.selectionEnd = 0;
  dispatchInput(textarea);
}

function deleteToEnd(textarea: HTMLTextAreaElement | HTMLInputElement): void {
  const value = textarea.value;
  const cursor = textarea.selectionStart ?? 0;
  textarea.value = value.slice(0, cursor);
  textarea.selectionStart = cursor;
  textarea.selectionEnd = cursor;
  dispatchInput(textarea);
}

function deleteCharForward(textarea: HTMLTextAreaElement | HTMLInputElement): void {
  const value = textarea.value;
  const cursor = textarea.selectionStart ?? 0;
  if (cursor < value.length) {
    textarea.value = value.slice(0, cursor) + value.slice(cursor + 1);
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    dispatchInput(textarea);
  }
}

function moveWordBack(textarea: HTMLTextAreaElement | HTMLInputElement): void {
  const value = textarea.value;
  let i = textarea.selectionStart ?? 0;

  while (i > 0 && /\s/.test(value[i - 1])) i--;
  while (i > 0 && !/\s/.test(value[i - 1])) i--;

  textarea.selectionStart = i;
  textarea.selectionEnd = i;
}

function moveWordForward(textarea: HTMLTextAreaElement | HTMLInputElement): void {
  const value = textarea.value;
  let i = textarea.selectionStart ?? 0;

  while (i < value.length && /\s/.test(value[i])) i++;
  while (i < value.length && !/\s/.test(value[i])) i++;

  textarea.selectionStart = i;
  textarea.selectionEnd = i;
}

function deleteWordForward(textarea: HTMLTextAreaElement | HTMLInputElement): void {
  const value = textarea.value;
  const cursor = textarea.selectionStart ?? 0;
  let i = cursor;

  while (i < value.length && /\s/.test(value[i])) i++;
  while (i < value.length && !/\s/.test(value[i])) i++;

  textarea.value = value.slice(0, cursor) + value.slice(i);
  textarea.selectionStart = cursor;
  textarea.selectionEnd = cursor;
  dispatchInput(textarea);
}

function dispatchInput(textarea: HTMLTextAreaElement | HTMLInputElement): void {
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
