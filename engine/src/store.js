'use strict';
// Config persistence: ~/Documents/Push3UserMode/config.json (+ presets/).
// Writes are debounced and atomic (temp file + rename) so a crash never leaves a half file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultConfig, normalizeConfig } = require('./config');

const DIR = process.env.P3UM_DIR || path.join(os.homedir(), 'Documents', 'Push3UserMode');
const FILE = path.join(DIR, 'config.json');
const PRESETS = path.join(DIR, 'presets');

function ensureDirs() {
  fs.mkdirSync(PRESETS, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function load(log) {
  ensureDirs();
  for (const f of [FILE, `${FILE}.bak`]) {
    try {
      if (fs.existsSync(f)) return normalizeConfig(readJson(f));
    } catch (e) {
      log('warn', `Could not read ${f}: ${e.message}`);
    }
  }
  return defaultConfig();
}

let saveTimer = null;
function save(config, log) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      ensureDirs();
      if (fs.existsSync(FILE)) fs.copyFileSync(FILE, `${FILE}.bak`);
      writeAtomic(FILE, JSON.stringify(config, null, 1));
    } catch (e) {
      log('error', `Could not save config: ${e.message}`);
    }
  }, 300);
}

function safeName(name) {
  return String(name || '')
    .replace(/[^\w \-]+/g, '')
    .trim()
    .slice(0, 48);
}

function listPresets() {
  ensureDirs();
  return fs
    .readdirSync(PRESETS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function savePreset(name, config) {
  const n = safeName(name);
  if (!n) throw new Error('invalid preset name');
  ensureDirs();
  writeAtomic(path.join(PRESETS, `${n}.json`), JSON.stringify(config, null, 1));
  return n;
}

function loadPreset(name) {
  const n = safeName(name);
  return normalizeConfig(readJson(path.join(PRESETS, `${n}.json`)));
}

function deletePreset(name) {
  const n = safeName(name);
  fs.rmSync(path.join(PRESETS, `${n}.json`), { force: true });
}

module.exports = { DIR, FILE, load, save, listPresets, savePreset, loadPreset, deletePreset };
