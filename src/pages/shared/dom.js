/** Small DOM helpers for extension pages. Always render untrusted text with textContent. */

import { LANGUAGES, TARGET_LANGUAGES } from '../../shared/languages.js';

export const $ = (id) => document.getElementById(id);

export function addOption(parent, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  parent.appendChild(option);
  return option;
}

export function fillLanguageSelects(fromSelect, toSelect) {
  LANGUAGES.forEach(({ code, name }) => addOption(fromSelect, code, name));
  TARGET_LANGUAGES.forEach(({ code, name }) => addOption(toSelect, code, name));
}

export function setStatus(element, text = '', isError = false) {
  element.textContent = text || '';
  element.className = `status${isError ? ' error' : ''}`;
}

/** Disables a button and swaps its label while `busy`. */
export function setBusy(button, busy, label) {
  button.disabled = busy;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.textContent = busy ? label : button.dataset.label;
}

export function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
