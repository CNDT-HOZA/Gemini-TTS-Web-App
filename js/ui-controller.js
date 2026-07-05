/**
 * Gemini Voice Studio — UI Controller
 * Handles all DOM manipulation, rendering, and visual state management.
 * Depends on: window.SettingsManager
 * All user-facing strings are in Vietnamese.
 */

const ICONS = {
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  retry: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
};

window.UIController = {
  _elements: {},
  _playingSegmentId: null,

  // ─── Initialization ───────────────────────────────────────────────

  /**
   * Cache every relevant DOM element by ID for fast repeated access.
   */
  init() {
    const ids = [
      'settings-btn', 'theme-toggle-btn', 'text-input', 'file-upload', 'upload-btn', 'clear-btn',
      'char-count', 'segments-preview', 'segment-count', 'convert-btn',
      'cancel-btn', 'progress-container', 'progress-bar', 'progress-text',
      'progress-percent', 'audio-list', 'output-actions', 'format-select',
      'download-all-btn', 'settings-modal', 'settings-overlay',
      'close-settings-btn', 'api-keys-input', 'api-key-toggle', 'api-key-count',
      'api-key-status', 'model-select',
      'load-models-btn', 'model-load-status',
      'gdoc-url-input', 'gdoc-fetch-btn', 'gdoc-status',
      'voice-grid', 'style-input', 'speed-select', 'volume-slider',
      'volume-value', 'default-format-select', 'delay-input',
      'save-settings-btn', 'toast-container'
    ];

    ids.forEach((id) => {
      const camel = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this._elements[camel] = document.getElementById(id);
    });
  },

  // ─── Text Input Helpers ───────────────────────────────────────────

  /**
   * Return the current value of the main textarea.
   * @returns {string}
   */
  getInputText() {
    return (this._elements.textInput && this._elements.textInput.value) || '';
  },

  /**
   * Set the textarea value programmatically.
   * @param {string} text
   */
  setInputText(text) {
    if (this._elements.textInput) {
      this._elements.textInput.value = text;
    }
  },

  /**
   * Update the character-count badge.
   * Formats with Vietnamese locale separators: "1.234 ký tự"
   * @param {number} count
   */
  updateCharCount(count) {
    if (!this._elements.charCount) return;
    const formatted = count.toLocaleString('vi-VN');
    this._elements.charCount.textContent = formatted + ' ký tự';
  },

  // ─── Segment Rendering ───────────────────────────────────────────

  /**
   * Render parsed segments as preview cards inside #segments-preview.
   * @param {Array<{id: number, text: string}>} segments
   */
  renderSegments(segments) {
    const container = this._elements.segmentsPreview;
    if (!container) return;

    container.innerHTML = '';

    if (!segments || segments.length === 0) {
      container.innerHTML =
        '<div class="empty-state">Nhập hoặc dán văn bản để xem các đoạn</div>';
      if (this._elements.segmentCount) {
        this._elements.segmentCount.textContent = '0';
      }
      return;
    }

    segments.forEach((seg, idx) => {
      const card = document.createElement('div');
      card.className = 'segment-card';
      card.dataset.id = seg.id;

      const charCount = seg.text.length.toLocaleString('vi-VN');
      const truncated =
        seg.text.length > 150 ? seg.text.substring(0, 150) + '...' : seg.text;

      card.innerHTML =
        '<div class="segment-header">' +
          '<span class="segment-number">#' + (idx + 1) + '</span>' +
          '<span class="segment-chars">' + charCount + ' ký tự</span>' +
        '</div>' +
        '<div class="segment-text">' + this._escapeHtml(truncated) + '</div>';

      container.appendChild(card);
    });

    if (this._elements.segmentCount) {
      this._elements.segmentCount.textContent = segments.length;
    }
  },

  // ─── Audio List ───────────────────────────────────────────────────

  /**
   * Build placeholder audio-item rows for each segment before conversion starts.
   * @param {Array<{id: number, text: string}>} segments
   */
  initAudioList(segments) {
    const list = this._elements.audioList;
    if (!list) return;
    list.innerHTML = '';

    if (!segments || segments.length === 0) return;

    segments.forEach((seg, idx) => {
      const titleText =
        seg.text.length > 50 ? seg.text.substring(0, 50) + '...' : seg.text;

      const item = document.createElement('div');
      item.className = 'audio-item';
      item.dataset.id = seg.id;

      item.innerHTML =
        '<div class="audio-item-header">' +
          '<div class="audio-item-info">' +
            '<span class="audio-item-number">#' + (idx + 1) + '</span>' +
            '<span class="audio-item-title">' + this._escapeHtml(titleText) + '</span>' +
          '</div>' +
          '<div class="audio-item-header-actions">' +
            '<span class="audio-item-status status-pending">' +
              '<span class="status-dot"></span>' +
              'Chờ xử lý' +
            '</span>' +
            '<button class="retry-btn icon-btn hidden" data-id="' + seg.id + '" title="Tạo lại">' +
              ICONS.retry +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="audio-item-player" style="display:none">' +
          '<button class="play-btn icon-btn" data-id="' + seg.id + '" title="Phát">' +
            ICONS.play +
          '</button>' +
          '<div class="audio-progress-track">' +
            '<div class="audio-progress-fill"></div>' +
          '</div>' +
          '<span class="audio-duration">0:00</span>' +
          '<button class="download-segment-btn icon-btn" data-id="' + seg.id + '" title="Tải xuống">' +
            ICONS.download +
          '</button>' +
        '</div>';

      list.appendChild(item);
    });
  },

  /**
   * Update the visual status badge for a specific segment in the audio list.
   * @param {number} id   Segment ID
   * @param {'pending'|'processing'|'done'|'error'} status
   */
  updateSegmentStatus(id, status) {
    const item = this._getAudioItem(id);
    if (!item) return;

    const statusEl = item.querySelector('.audio-item-status');
    if (!statusEl) return;

    // Remove all status classes
    statusEl.className = 'audio-item-status';

    const map = {
      pending:    { cls: 'status-pending',    text: 'Chờ xử lý' },
      processing: { cls: 'status-processing', text: 'Đang xử lý...' },
      done:       { cls: 'status-done',       text: 'Hoàn thành' },
      error:      { cls: 'status-error',      text: 'Lỗi' }
    };

    const info = map[status] || map.pending;
    statusEl.classList.add(info.cls);
    statusEl.innerHTML =
      '<span class="status-dot"></span>' + info.text;

    // Show retry button when done or error
    const retryBtn = item.querySelector('.retry-btn');
    if (retryBtn) {
      if (status === 'done' || status === 'error') {
        retryBtn.classList.remove('hidden');
      } else {
        retryBtn.classList.add('hidden');
      }
    }
  },

  /**
   * Reveal the inline audio player row for a completed segment.
   * @param {number} id
   * @param {string} duration  Formatted duration string e.g. "1:23"
   */
  showAudioPlayer(id, duration) {
    const item = this._getAudioItem(id);
    if (!item) return;

    const player = item.querySelector('.audio-item-player');
    if (player) {
      player.style.display = '';
    }

    const durationSpan = item.querySelector('.audio-duration');
    if (durationSpan && duration) {
      durationSpan.textContent = duration;
    }
  },

  // ─── Progress Bar ─────────────────────────────────────────────────

  /**
   * Update the global progress bar and associated text.
   * @param {number} current  Segments completed so far
   * @param {number} total    Total segments
   */
  updateProgress(current, total) {
    this.showProgress(true);

    const pct = total > 0 ? Math.round((current / total) * 100) : 0;

    if (this._elements.progressBar) {
      this._elements.progressBar.style.width = pct + '%';
    }
    if (this._elements.progressText) {
      this._elements.progressText.textContent =
        'Đang xử lý đoạn ' + current + '/' + total + '...';
    }
    if (this._elements.progressPercent) {
      this._elements.progressPercent.textContent = pct + '%';
    }
  },

  /**
   * Toggle visibility of the progress container.
   * @param {boolean} show
   */
  showProgress(show) {
    if (!this._elements.progressContainer) return;
    if (show) {
      this._elements.progressContainer.classList.remove('hidden');
    } else {
      this._elements.progressContainer.classList.add('hidden');
    }
  },

  // ─── Conversion State ─────────────────────────────────────────────

  /**
   * Toggle the UI between "idle" and "converting" states.
   * @param {boolean} isConverting
   */
  setConvertingState(isConverting) {
    if (this._elements.convertBtn) {
      if (isConverting) {
        this._elements.convertBtn.classList.add('hidden');
      } else {
        this._elements.convertBtn.classList.remove('hidden');
      }
    }
    if (this._elements.cancelBtn) {
      if (isConverting) {
        this._elements.cancelBtn.classList.remove('hidden');
      } else {
        this._elements.cancelBtn.classList.add('hidden');
      }
    }
    if (this._elements.textInput) {
      this._elements.textInput.disabled = isConverting;
    }
    if (this._elements.uploadBtn) {
      this._elements.uploadBtn.disabled = isConverting;
    }
    if (this._elements.clearBtn) {
      this._elements.clearBtn.disabled = isConverting;
    }
  },

  /**
   * Show or hide the output action buttons (format select, download all).
   * @param {boolean} show
   */
  showOutputActions(show) {
    if (!this._elements.outputActions) return;
    if (show) {
      this._elements.outputActions.classList.remove('hidden');
    } else {
      this._elements.outputActions.classList.add('hidden');
    }
  },

  // ─── Toast Notifications ──────────────────────────────────────────

  /**
   * Display a temporary toast notification.
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} type
   * @param {number} duration  Auto-dismiss time in ms
   */
  showToast(message, type, duration) {
    type = type || 'success';
    duration = duration || 4000;

    const container = this._elements.toastContainer;
    if (!container) return;

    const iconMap = {
      success: ICONS.check,
      error:   ICONS.error,
      warning: ICONS.warning,
      info:    ICONS.info
    };

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML =
      '<span class="toast-icon">' + (iconMap[type] || iconMap.info) + '</span>' +
      '<span class="toast-message">' + this._escapeHtml(message) + '</span>' +
      '<button class="toast-close" title="Đóng">&times;</button>';

    // Close button handler
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._removeToast(toast));
    }

    container.appendChild(toast);

    // Trigger entry animation on next frame
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // Auto-dismiss
    const timer = setTimeout(() => this._removeToast(toast), duration);
    toast._timer = timer;
  },

  /**
   * Gracefully remove a toast element with an exit animation.
   * @param {HTMLElement} toast
   */
  _removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    clearTimeout(toast._timer);
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-dismiss');
    toast.addEventListener('transitionend', () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
    // Fallback removal in case transitionend doesn't fire
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 500);
  },

  // ─── Settings Modal ───────────────────────────────────────────────

  /**
   * Open the settings modal and populate form fields with current values.
   */
  openSettings() {
    if (typeof SettingsManager !== 'undefined') {
      const settings = SettingsManager.getAll();
      this.loadSettingsToForm(settings);
    }

    if (this._elements.settingsModal) {
      this._elements.settingsModal.classList.remove('hidden');
    }
    document.body.style.overflow = 'hidden';
  },

  /**
   * Close the settings modal.
   */
  closeSettings() {
    if (this._elements.settingsModal) {
      this._elements.settingsModal.classList.add('hidden');
    }
    document.body.style.overflow = '';
  },

  /**
   * Read all settings-form fields and return a plain object.
   * @returns {Object}
   */
  getSettingsFromForm() {
    const activeVoice = this._elements.voiceGrid
      ? this._elements.voiceGrid.querySelector('.voice-btn.active')
      : null;

    // Parse API keys from textarea (one per line)
    var apiKeysRaw = (this._elements.apiKeysInput && this._elements.apiKeysInput.value) || '';
    var apiKeys = apiKeysRaw.split('\n')
      .map(function (k) { return k.trim(); })
      .filter(function (k) { return k.length > 0; });

    return {
      apiKeys: apiKeys,
      model:   (this._elements.modelSelect  && this._elements.modelSelect.value)         || '',
      voice:   activeVoice ? activeVoice.dataset.voice : '',
      style:   (this._elements.styleInput   && this._elements.styleInput.value.trim())   || '',
      speed:   (this._elements.speedSelect  && this._elements.speedSelect.value)         || '1',
      volume:  this._elements.volumeSlider  ? parseFloat(this._elements.volumeSlider.value) : 1,
      format:  (this._elements.defaultFormatSelect && this._elements.defaultFormatSelect.value) || 'wav',
      delay:   this._elements.delayInput    ? parseInt(this._elements.delayInput.value, 10) || 0 : 0
    };
  },

  /**
   * Populate the settings form from a settings object.
   * @param {Object} settings
   */
  loadSettingsToForm(settings) {
    if (!settings) return;

    // Load API keys into textarea
    if (this._elements.apiKeysInput && settings.apiKeys) {
      this._elements.apiKeysInput.value = settings.apiKeys.join('\n');
      this._updateApiKeyCount(settings.apiKeys);
    }
    if (this._elements.modelSelect && settings.model != null) {
      this._elements.modelSelect.value = settings.model;
    }
    if (this._elements.styleInput && settings.style != null) {
      this._elements.styleInput.value = settings.style;
    }
    if (this._elements.speedSelect && settings.speed != null) {
      this._elements.speedSelect.value = settings.speed;
    }
    if (this._elements.volumeSlider && settings.volume != null) {
      this._elements.volumeSlider.value = settings.volume;
    }
    if (this._elements.volumeValue && settings.volume != null) {
      this._elements.volumeValue.textContent = Math.round(settings.volume) + '%';
    }
    if (this._elements.defaultFormatSelect && settings.format != null) {
      this._elements.defaultFormatSelect.value = settings.format;
    }
    if (this._elements.delayInput && settings.delay != null) {
      this._elements.delayInput.value = settings.delay;
    }

    // Set active voice button
    if (this._elements.voiceGrid && settings.voice) {
      const buttons = this._elements.voiceGrid.querySelectorAll('.voice-btn');
      buttons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.voice === settings.voice);
      });
    }
  },

  // ─── Convert Button State ─────────────────────────────────────────

  /**
   * Enable or disable the convert button based on current conditions.
   * Requires non-empty text AND an API key.
   */
  updateConvertButton() {
    if (!this._elements.convertBtn) return;

    const hasText = this.getInputText().trim().length > 0;
    const hasApiKey =
      typeof SettingsManager !== 'undefined' &&
      SettingsManager.getValidKeys &&
      SettingsManager.getValidKeys().length > 0;

    this._elements.convertBtn.disabled = !(hasText && hasApiKey);
  },

  // ─── Output / Reset ───────────────────────────────────────────────

  /**
   * Clear all output UI: audio list, progress, output actions.
   */
  clearOutput() {
    if (this._elements.audioList) {
      this._elements.audioList.innerHTML = '';
    }
    this.showProgress(false);
    this.showOutputActions(false);

    // Reset progress bar
    if (this._elements.progressBar) {
      this._elements.progressBar.style.width = '0%';
    }
    if (this._elements.progressText) {
      this._elements.progressText.textContent = '';
    }
    if (this._elements.progressPercent) {
      this._elements.progressPercent.textContent = '0%';
    }
  },

  /**
   * Reset the entire UI back to its initial empty state.
   */
  reset() {
    this.setInputText('');
    this.updateCharCount(0);
    this.renderSegments([]);
    this.clearOutput();
    this.setConvertingState(false);
    this._playingSegmentId = null;
  },

  // ─── Private Helpers ──────────────────────────────────────────────

  /**
   * Update the API key count badge.
   * @param {string[]} keys
   */
  _updateApiKeyCount(keys) {
    var validKeys = (keys || []).filter(function (k) {
      return k && k.trim().length > 0;
    });
    if (this._elements.apiKeyCount) {
      this._elements.apiKeyCount.textContent = validKeys.length + ' key';
    }
  },

  /**
   * Find an audio-item element by segment ID.
   * @param {number} id
   * @returns {HTMLElement|null}
   */
  _getAudioItem(id) {
    if (!this._elements.audioList) return null;
    return this._elements.audioList.querySelector(
      '.audio-item[data-id="' + id + '"]'
    );
  },

  /**
   * Escape HTML to prevent XSS when inserting user text.
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
};
