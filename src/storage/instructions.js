/** Reusable translation preferences: `{ id, name, text, enabled }[]` in local storage. */

import { loadSettings } from './settings.js';
import { makeId } from './normalize.js';

const NAME_MAX_CHARS = 80;

async function readInstructions() {
  return (await loadSettings()).instructions || [];
}

async function writeInstructions(instructions) {
  await chrome.storage.local.set({ instructions });
}

export async function getInstructions() {
  return readInstructions();
}

export async function addInstruction(name, text) {
  const instructions = await readInstructions();
  const instruction = {
    id: makeId('instruction'),
    name:
      String(name || 'Instruction')
        .trim()
        .slice(0, NAME_MAX_CHARS) || 'Instruction',
    text: String(text || '').trim(),
    enabled: true
  };
  if (!instruction.text) throw new Error('Instruction text is required.');
  await writeInstructions([...instructions, instruction]);
  return instruction;
}

export async function updateInstruction(id, patch) {
  const instructions = await readInstructions();
  const next = instructions.map((item) =>
    item.id === id
      ? {
          ...item,
          ...(patch?.name !== undefined ? { name: String(patch.name).trim().slice(0, NAME_MAX_CHARS) } : {}),
          ...(patch?.text !== undefined ? { text: String(patch.text).trim() } : {}),
          ...(patch?.enabled !== undefined ? { enabled: Boolean(patch.enabled) } : {})
        }
      : item
  );
  await writeInstructions(next);
}

export async function removeInstruction(id) {
  const instructions = await readInstructions();
  await writeInstructions(instructions.filter((item) => item.id !== id));
}

export async function toggleInstruction(id) {
  const instructions = await readInstructions();
  await writeInstructions(instructions.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item)));
}

/** Enabled instruction texts joined by newline. */
export async function getCombinedInstructions() {
  const instructions = await readInstructions();
  return instructions
    .filter((item) => item.enabled)
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n');
}
