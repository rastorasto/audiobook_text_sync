// ==UserScript==
// @name         Audiobookshelf Read-Along Overlay
// @namespace    local.audiobookshelf.readalong
// @version      0.1.0
// @description  Overlay word-level VTT captions on Audiobookshelf's built-in player.
// @match        https://audiobookshelf.rasto.org/*
// @match        https://abs.rasto.org/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const ALLOWED_HOSTS = new Set(['audiobookshelf.rasto.org', 'abs.rasto.org']);

  const ROOT_ID = 'abs-readalong-root';
  const STYLE_ID = 'abs-readalong-style';
  const PANEL_ID = 'abs-readalong-panel';
  const CAPTION_ID = 'abs-readalong-caption';
  const STATUS_ID = 'abs-readalong-status';
  const SETTINGS_KEY = 'abs-readalong-settings';
  const DEFAULT_SETTINGS = {
    captionTop: 72,
    contextWords: 5,
    maxLines: 4,
    captionWidth: 78,
    fontScale: 1,
    captionTransparency: 0
  };

  const WORDS_PER_LINE = 8;

  const state = {
    audio: null,
    vttFiles: new Map(),
    cues: [],
    cueIndex: 0,
    currentSourceKey: '',
    currentFileName: '',
    currentFileLabel: '',
    observer: null,
    initialized: false,
    hidden: false,
    panelCollapsed: false,
    lastTime: 0,
    settings: { ...DEFAULT_SETTINGS }
  };

  function ensureInjected() {
    if (document.getElementById(ROOT_ID)) return true;

    const audio = findAudioElement();
    if (!audio) return false;

    state.settings = loadSettings();
    injectStyles();
    injectUi();
    applyCaptionSettings();
    bindAudio(audio);
    startObserver();
    setStatus('Ready. Pick a VTT folder or a single VTT file, then press play in Audiobookshelf.');
    state.initialized = true;
    return true;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      #${ROOT_ID} * {
        box-sizing: border-box;
      }

      #${PANEL_ID} {
        pointer-events: auto;
        position: fixed;
        top: 16px;
        right: 16px;
        width: min(420px, calc(100vw - 32px));
        max-height: calc(100vh - 32px);
        overflow-y: auto;
        overscroll-behavior: contain;
        background: rgba(15, 15, 18, 0.92);
        color: #f5f5f5;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(14px);
        padding: 14px;
      }

      #${PANEL_ID}[data-collapsed='true'] {
        width: auto;
        padding: 8px 10px;
      }

      #${PANEL_ID}[data-collapsed='true'] .abs-readalong-body {
        display: none;
      }

      .abs-readalong-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .abs-readalong-title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #b7bcc7;
      }

      .abs-readalong-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .abs-readalong-button {
        pointer-events: auto;
        background: #2d5a3d;
        color: #fff;
        border: 0;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 12px;
        cursor: pointer;
      }

      .abs-readalong-button.secondary {
        background: rgba(255, 255, 255, 0.08);
      }

      .abs-readalong-button:hover {
        filter: brightness(1.06);
      }

      .abs-readalong-body {
        display: grid;
        gap: 10px;
      }

      .abs-readalong-row {
        display: grid;
        gap: 6px;
      }

      .abs-readalong-label {
        font-size: 12px;
        color: #9ca3af;
      }

      .abs-readalong-input {
        width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: #f3f4f6;
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 14px;
        outline: none;
      }

      .abs-readalong-input:focus {
        border-color: rgba(74, 222, 128, 0.55);
        box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.12);
      }

      .abs-readalong-meta {
        color: #d1d5db;
        font-size: 12px;
        line-height: 1.4;
      }

      .abs-readalong-status {
        color: #9ca3af;
        font-size: 12px;
        line-height: 1.45;
      }

      .abs-readalong-caption {
        pointer-events: none;
        position: fixed;
        left: 50%;
        top: calc(var(--abs-readalong-caption-top, 72) * 1vh);
        transform: translateX(-50%);
        width: min(calc(var(--abs-readalong-caption-width, 78) * 1vw), calc(100vw - 32px));
        max-width: min(calc(var(--abs-readalong-caption-width, 78) * 1vw), calc(100vw - 32px));
        padding: 18px 22px;
        border-radius: 20px;
        background-color: rgb(0 0 0 / 1);
        color: #f8fafc;
        font-size: calc(clamp(22px, 2.6vw, 42px) * var(--abs-readalong-caption-scale, 1));
        line-height: 1.42;
        text-align: center;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: var(--abs-readalong-caption-lines, 3);
        overflow: hidden;
        opacity: 0;
        transition: opacity 120ms ease;
      }

      .abs-readalong-caption[data-visible='true'] {
        opacity: 1;
      }

      .abs-readalong-caption .active {
        color: #4ade80;
      }

      .abs-readalong-small {
        font-size: 11px;
        color: #94a3b8;
      }

      .abs-readalong-list {
        display: grid;
        gap: 6px;
        max-height: 180px;
        overflow: auto;
        padding-right: 2px;
      }

      .abs-readalong-item {
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 8px 10px;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.03);
      }

      .abs-readalong-item:hover {
        background: rgba(255, 255, 255, 0.07);
      }

      .abs-readalong-item strong {
        font-size: 13px;
        font-weight: 600;
      }

      .abs-readalong-item span {
        font-size: 11px;
        color: #94a3b8;
      }
    `;
    document.head.appendChild(style);
  }

  function injectUi() {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div id="${PANEL_ID}">
        <div class="abs-readalong-head">
          <div class="abs-readalong-title">Read-Along</div>
          <div class="abs-readalong-actions">
            <button id="abs-readalong-toggle-captions" class="abs-readalong-button secondary" type="button">Hide captions</button>
            <button id="abs-readalong-toggle-panel" class="abs-readalong-button secondary" type="button">Close modal</button>
          </div>
        </div>

        <div class="abs-readalong-body">
          <div class="abs-readalong-row">
            <label class="abs-readalong-label" for="abs-readalong-folder">VTT folder</label>
            <input id="abs-readalong-folder" class="abs-readalong-input" type="file" webkitdirectory directory multiple accept=".vtt" />
            <div class="abs-readalong-small">Pick the folder that contains the generated .vtt files. Matching is by audio filename.</div>
          </div>

          <div class="abs-readalong-row">
            <label class="abs-readalong-label" for="abs-readalong-file">Single VTT file</label>
            <input id="abs-readalong-file" class="abs-readalong-input" type="file" accept=".vtt" />
            <div class="abs-readalong-small">Use this when you only want to load one captions file.</div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Current source</div>
            <div id="abs-readalong-source" class="abs-readalong-meta">Waiting for Audiobookshelf audio player...</div>
            <div id="${STATUS_ID}" class="abs-readalong-status"></div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Loaded captions</div>
            <div id="abs-readalong-caption-summary" class="abs-readalong-meta">None</div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Caption position</div>
            <input id="abs-readalong-caption-top" class="abs-readalong-input" type="range" min="8" max="90" step="1" />
            <div id="abs-readalong-caption-top-value" class="abs-readalong-small"></div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Context words</div>
            <input id="abs-readalong-context-words" class="abs-readalong-input" type="range" min="0" max="20" step="1" />
            <div id="abs-readalong-context-words-value" class="abs-readalong-small"></div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Visible lines</div>
            <input id="abs-readalong-max-lines" class="abs-readalong-input" type="range" min="1" max="20" step="1" />
            <div id="abs-readalong-max-lines-value" class="abs-readalong-small"></div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Caption width</div>
            <input id="abs-readalong-caption-width" class="abs-readalong-input" type="range" min="35" max="95" step="1" />
            <div id="abs-readalong-caption-width-value" class="abs-readalong-small"></div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Text size</div>
            <input id="abs-readalong-font-scale" class="abs-readalong-input" type="range" min="75" max="160" step="1" />
            <div id="abs-readalong-font-scale-value" class="abs-readalong-small"></div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Caption transparency</div>
            <input id="abs-readalong-caption-transparency" class="abs-readalong-input" type="range" min="0" max="100" step="1" />
            <div id="abs-readalong-caption-transparency-value" class="abs-readalong-small"></div>
          </div>

          <div class="abs-readalong-row">
            <div class="abs-readalong-label">Loaded VTT files</div>
            <div id="abs-readalong-list" class="abs-readalong-list"></div>
          </div>
        </div>
      </div>

      <div id="${CAPTION_ID}" class="abs-readalong-caption">Pick a VTT folder or a single VTT file to begin.</div>
    `;
    document.body.appendChild(root);

    const toggleCaptions = document.getElementById('abs-readalong-toggle-captions');
    toggleCaptions.addEventListener('click', () => {
      state.hidden = !state.hidden;
      updateCaptionVisibility();
    });

    const togglePanel = document.getElementById('abs-readalong-toggle-panel');
    togglePanel.addEventListener('click', () => {
      const panel = document.getElementById(PANEL_ID);
      state.panelCollapsed = !state.panelCollapsed;
      panel.dataset.collapsed = state.panelCollapsed ? 'true' : 'false';
      togglePanel.textContent = state.panelCollapsed ? 'Open modal' : 'Close modal';
    });

    const folderInput = document.getElementById('abs-readalong-folder');
    folderInput.addEventListener('change', onFolderSelected);

    const fileInput = document.getElementById('abs-readalong-file');
    fileInput.addEventListener('change', onSingleFileSelected);

    const captionTop = document.getElementById('abs-readalong-caption-top');
    const contextWords = document.getElementById('abs-readalong-context-words');
    const maxLines = document.getElementById('abs-readalong-max-lines');
    const captionWidth = document.getElementById('abs-readalong-caption-width');
    const fontScale = document.getElementById('abs-readalong-font-scale');
    const captionTransparency = document.getElementById('abs-readalong-caption-transparency');

    if (captionTop) {
      captionTop.value = String(state.settings.captionTop);
      captionTop.addEventListener('input', () => updateSetting('captionTop', captionTop.value));
    }

    if (contextWords) {
      contextWords.value = String(state.settings.contextWords);
      contextWords.addEventListener('input', () => updateSetting('contextWords', contextWords.value));
    }

    if (maxLines) {
      maxLines.value = String(state.settings.maxLines);
      maxLines.addEventListener('input', () => updateSetting('maxLines', maxLines.value));
    }

    if (captionWidth) {
      captionWidth.value = String(state.settings.captionWidth);
      captionWidth.addEventListener('input', () => updateSetting('captionWidth', captionWidth.value));
    }

    if (fontScale) {
      fontScale.value = String(Math.round(state.settings.fontScale * 100));
      fontScale.addEventListener('input', () => updateSetting('fontScale', fontScale.value));
    }

    if (captionTransparency) {
      captionTransparency.value = String(state.settings.captionTransparency);
      captionTransparency.addEventListener('input', () => updateSetting('captionTransparency', captionTransparency.value));
    }

    syncSettingLabels();
  }

  function setStatus(message) {
    const status = document.getElementById(STATUS_ID);
    if (status) status.textContent = message || '';
  }

  function setSourceLabel(message) {
    const el = document.getElementById('abs-readalong-source');
    if (el) el.textContent = message || '';
  }

  function setCaptionSummary(message) {
    const el = document.getElementById('abs-readalong-caption-summary');
    if (el) el.textContent = message || 'None';
  }

  function setCaptionVisible(visible) {
    const caption = document.getElementById(CAPTION_ID);
    if (!caption) return;
    caption.dataset.visible = visible ? 'true' : 'false';
  }

  function updateCaptionVisibility() {
    const caption = document.getElementById(CAPTION_ID);
    if (!caption) return;
    caption.style.display = state.hidden ? 'none' : '';
    const button = document.getElementById('abs-readalong-toggle-captions');
    if (button) button.textContent = state.hidden ? 'Show captions' : 'Hide captions';
  }

  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };

      const parsed = JSON.parse(raw);
      return {
        captionTop: clampNumber(parsed.captionTop, DEFAULT_SETTINGS.captionTop, 8, 90),
        contextWords: clampNumber(parsed.contextWords, DEFAULT_SETTINGS.contextWords, 0, 20),
        maxLines: clampNumber(parsed.maxLines, DEFAULT_SETTINGS.maxLines, 1, 20),
        captionWidth: clampNumber(parsed.captionWidth, DEFAULT_SETTINGS.captionWidth, 35, 95),
        fontScale: clampFloat(parsed.fontScale, DEFAULT_SETTINGS.fontScale, 0.75, 1.6),
        captionTransparency: parsed.captionTransparency !== undefined
          ? clampNumber(parsed.captionTransparency, DEFAULT_SETTINGS.captionTransparency, 0, 100)
          : parsed.captionOpacity !== undefined
            ? clampNumber(Math.round((1 - clampFloat(parsed.captionOpacity, 1, 0, 1)) * 100), DEFAULT_SETTINGS.captionTransparency, 0, 100)
            : DEFAULT_SETTINGS.captionTransparency
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {
      // Ignore storage failures.
    }
  }

  function updateSetting(name, value) {
    if (!(name in state.settings)) return;

    const bounds = name === 'captionTop'
      ? [8, 90]
      : name === 'contextWords'
        ? [0, 20]
        : name === 'maxLines'
          ? [1, 20]
          : name === 'captionWidth'
            ? [35, 95]
          : name === 'fontScale'
            ? [75, 160]
            : [0, 100];

    if (name === 'fontScale') {
      state.settings[name] = clampNumber(value, Math.round(DEFAULT_SETTINGS.fontScale * 100), bounds[0], bounds[1]) / 100;
    } else {
      state.settings[name] = clampNumber(value, DEFAULT_SETTINGS[name], bounds[0], bounds[1]);
    }

    applyCaptionSettings();
    syncSettingLabels();
    saveSettings();
    refreshCaption();
  }

  function applyCaptionSettings() {
    const caption = document.getElementById(CAPTION_ID);
    if (!caption) return;

    caption.style.setProperty('--abs-readalong-caption-top', String(state.settings.captionTop));
    caption.style.setProperty('--abs-readalong-caption-lines', String(state.settings.maxLines));
    caption.style.setProperty('--abs-readalong-caption-width', String(state.settings.captionWidth));
    caption.style.setProperty('--abs-readalong-caption-scale', String(state.settings.fontScale));
    const alpha = 1 - (state.settings.captionTransparency / 100);
    caption.style.backgroundColor = `rgb(0 0 0 / ${alpha})`;
  }

  function syncSettingLabels() {
    const captionTop = document.getElementById('abs-readalong-caption-top-value');
    const contextWords = document.getElementById('abs-readalong-context-words-value');
    const maxLines = document.getElementById('abs-readalong-max-lines-value');
    const captionWidth = document.getElementById('abs-readalong-caption-width-value');
    const fontScale = document.getElementById('abs-readalong-font-scale-value');
    const captionTransparency = document.getElementById('abs-readalong-caption-transparency-value');

    if (captionTop) captionTop.textContent = `${state.settings.captionTop}% from top`;
    if (contextWords) contextWords.textContent = `${state.settings.contextWords} words before and after the active cue`;
    if (maxLines) maxLines.textContent = `${state.settings.maxLines} visible line${state.settings.maxLines === 1 ? '' : 's'}`;
    if (captionWidth) captionWidth.textContent = `${state.settings.captionWidth}% of the viewport width`;
    if (fontScale) fontScale.textContent = `${Math.round(state.settings.fontScale * 100)}% text size`;
    if (captionTransparency) captionTransparency.textContent = `${state.settings.captionTransparency}% transparency`;
  }

  function clampFloat(value, fallback, min, max) {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function clampNumber(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function onFolderSelected(event) {
    loadVttSelection(Array.from(event.target.files || []), 'VTT files loaded. Play something in Audiobookshelf and captions will follow.');
  }

  function onSingleFileSelected(event) {
    loadVttSelection(Array.from(event.target.files || []), 'Single VTT file loaded. Play something in Audiobookshelf and captions will follow.');
  }

  function loadVttSelection(files, readyMessage) {
    const vttFiles = files.filter((file) => file.name.toLowerCase().endsWith('.vtt'));

    state.vttFiles = new Map();
    vttFiles.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
    vttFiles.forEach((file) => {
      state.vttFiles.set(baseName(file.name).toLowerCase(), file);
    });

    const listEl = document.getElementById('abs-readalong-list');
    if (listEl) {
      listEl.innerHTML = '';
      vttFiles.forEach((file) => {
        const row = document.createElement('div');
        row.className = 'abs-readalong-item';
        row.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(file.webkitRelativePath || file.name || '')}</span>`;
        row.addEventListener('click', () => loadVttFile(file));
        listEl.appendChild(row);
      });
    }

    setCaptionSummary(vttFiles.length ? `${vttFiles.length} file${vttFiles.length === 1 ? '' : 's'} loaded` : 'None');
    setStatus(vttFiles.length ? readyMessage : 'No .vtt files selected.');

    if (state.audio) syncSource(true);
  }

  function loadVttFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      state.cues = parseVtt(reader.result || '');
      state.cueIndex = 0;
      setStatus(`Loaded ${file.name}`);
      if (state.audio) refreshCaption();
    };
    reader.readAsText(file);
  }

  function bindAudio(audio) {
    if (state.audio === audio) return;
    unbindAudio();
    state.audio = audio;

    const events = ['loadedmetadata', 'play', 'pause', 'timeupdate', 'ended', 'emptied', 'seeking', 'seeked', 'ratechange'];
    events.forEach((eventName) => audio.addEventListener(eventName, onAudioEvent));
    syncSource(true);
  }

  function unbindAudio() {
    if (!state.audio) return;
    const events = ['loadedmetadata', 'play', 'pause', 'timeupdate', 'ended', 'emptied', 'seeking', 'seeked', 'ratechange'];
    events.forEach((eventName) => state.audio.removeEventListener(eventName, onAudioEvent));
    state.audio = null;
  }

  function onAudioEvent(event) {
    if (!state.audio) return;

    if (event.type === 'ended') {
      setCaptionVisible(false);
      return;
    }

    syncSource(false);
    if (event.type === 'timeupdate' || event.type === 'seeked' || event.type === 'loadedmetadata' || event.type === 'ratechange') {
      refreshCaption();
    }
  }

  function syncSource(forceReload) {
    if (!state.audio) return;

    const sourceUrl = state.audio.currentSrc || state.audio.src || '';
    const sourceKey = baseNameFromUrl(sourceUrl).toLowerCase();
    const sourceLabel = sourceKey || 'unknown source';

    if (!forceReload && sourceKey === state.currentSourceKey) {
      setSourceLabel(state.currentFileLabel || sourceLabel);
      return;
    }

    state.currentSourceKey = sourceKey;
    state.currentFileName = sourceKey;
    state.currentFileLabel = sourceLabel;

    setSourceLabel(sourceLabel);
    loadCuesForSource(sourceKey);
    refreshCaption();
  }

  function loadCuesForSource(sourceKey) {
    const specific = state.vttFiles.get(sourceKey);
    const fallback = state.vttFiles.size === 1 ? [...state.vttFiles.values()][0] : null;
    const file = specific || fallback || null;

    if (!file) {
      state.cues = [];
      state.cueIndex = 0;
      setCaptionSummary(state.vttFiles.size ? 'No matching caption file for current audio' : 'None');
      setStatus('No matching .vtt file for the active audio track.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      state.cues = parseVtt(reader.result || '');
      state.cueIndex = 0;
      setCaptionSummary(`Using ${file.name}`);
      setStatus(`Matched ${file.name} to the current audio track.`);
      refreshCaption();
    };
    reader.readAsText(file);
  }

  function refreshCaption() {
    if (!state.audio) {
      setCaptionVisible(false);
      return;
    }

    const currentTime = state.audio.currentTime || 0;
    state.lastTime = currentTime;

    if (!state.cues.length) {
      const caption = document.getElementById(CAPTION_ID);
      if (caption) caption.textContent = 'No captions loaded for this track.';
      setCaptionVisible(false);
      return;
    }

    const activeIndex = findActiveCueIndex(state.cues, currentTime, state.cueIndex);
    if (activeIndex < 0) {
      setCaptionVisible(false);
      return;
    }

    state.cueIndex = activeIndex;
    renderCue(activeIndex);
    setCaptionVisible(true);
  }

  function renderCue(activeIndex) {
    const caption = document.getElementById(CAPTION_ID);
    if (!caption) return;

    const wordsPerPage = Math.max(1, WORDS_PER_LINE * clampNumber(state.settings.maxLines, DEFAULT_SETTINGS.maxLines, 1, 20));
    const pageStart = Math.floor(activeIndex / wordsPerPage) * wordsPerPage;
    const pageEnd = Math.min(state.cues.length - 1, pageStart + wordsPerPage - 1);

    const lines = [];
    for (let lineStart = pageStart; lineStart <= pageEnd; lineStart += WORDS_PER_LINE) {
      const lineEnd = Math.min(pageEnd, lineStart + WORDS_PER_LINE - 1);
      const lineHtml = state.cues
        .slice(lineStart, lineEnd + 1)
        .map((cue, index) => {
          const text = escapeHtml(cue.word || '').replace(/\n/g, '<br>');
          const cueIndex = lineStart + index;
          return cueIndex === activeIndex ? `<span class="active">${text}</span>` : text;
        })
        .join(' ');
      lines.push(lineHtml);
    }

    caption.innerHTML = lines.join('<br>');
  }

  function findActiveCueIndex(cues, time, currentIndex) {
    if (!Array.isArray(cues) || !cues.length) return -1;

    const start = Math.max(0, Math.min(currentIndex || 0, cues.length - 1));

    for (let i = start; i < cues.length; i += 1) {
      if (time >= cues[i].start && time <= cues[i].end) return i;
      if (time < cues[i].start) return i > 0 ? i - 1 : i;
    }

    for (let i = start - 1; i >= 0; i -= 1) {
      if (time >= cues[i].start && time <= cues[i].end) return i;
    }

    return -1;
  }

  function parseVtt(text) {
    const normalized = String(text || '')
      .replace(/^\uFEFF/, '')
      .trim();

    if (!normalized) return [];

    const blocks = normalized.split(/\n\s*\n/);
    const cues = [];

    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) continue;
      if (/^WEBVTT/i.test(lines[0])) continue;
      if (/^NOTE\b/i.test(lines[0])) continue;

      const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
      if (timeLineIndex < 0) continue;

      const [startText, endText] = lines[timeLineIndex].split('-->').map((piece) => piece.trim().split(' ')[0]);
      const start = toSeconds(startText);
      const end = toSeconds(endText);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;

      const wordLines = lines.slice(timeLineIndex + 1);
      const word = wordLines.join(' ').trim();
      if (!word) continue;

      cues.push({ start, end, word });
    }

    return cues;
  }

  function toSeconds(timestamp) {
    if (!timestamp) return Number.NaN;
    const parts = String(timestamp).trim().split(':');

    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts;
      return Number(hours) * 3600 + Number(minutes) * 60 + Number.parseFloat(seconds);
    }

    if (parts.length === 2) {
      const [minutes, seconds] = parts;
      return Number(minutes) * 60 + Number.parseFloat(seconds);
    }

    return Number.parseFloat(timestamp);
  }

  function baseName(name) {
    return String(name || '').replace(/\.[^/.]+$/, '');
  }

  function baseNameFromUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, window.location.href);
      const fileName = parsed.pathname.split('/').pop() || '';
      return baseName(decodeURIComponent(fileName));
    } catch {
      const raw = String(url).split('?')[0].split('#')[0].split('/').pop() || '';
      return baseName(decodeURIComponent(raw));
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function findAudioElement() {
    const audios = Array.from(document.querySelectorAll('audio'));
    if (!audios.length) return null;

    const visible = audios.filter((audio) => {
      const rect = audio.getBoundingClientRect();
      const style = window.getComputedStyle(audio);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });

    return visible.find((audio) => audio.currentSrc || audio.src) || visible[0] || audios.find((audio) => audio.currentSrc || audio.src) || audios[0];
  }

  function startObserver() {
    if (state.observer) return;

    state.observer = new MutationObserver(() => {
      const audio = findAudioElement();
      if (audio) bindAudio(audio);
      if (!state.initialized) ensureInjected();
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  const boot = () => {
    if (!ALLOWED_HOSTS.has(window.location.hostname)) return;
    if (ensureInjected()) return;
    const timer = window.setInterval(() => {
      if (ensureInjected()) {
        window.clearInterval(timer);
      }
    }, 1000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();