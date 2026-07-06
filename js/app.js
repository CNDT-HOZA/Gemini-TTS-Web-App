/**
 * Gemini Voice Studio — App Controller
 * Main application entry point. Initialises every module, wires up event
 * listeners, and orchestrates the text → speech conversion workflow.
 *
 * Depends on (all attached to window):
 *   SettingsManager, TextParser, TTSEngine, AudioManager, UIController
 *
 * All user-facing strings are in Vietnamese.
 */

window.App = {
  _segments: [],        // Current parsed segments [{id, text}, …]
  _results: {},         // Conversion results: { segmentId: base64Pcm }
  _failedSegments: [],  // Segments that failed: [{id, text, charCount, error}]
  _doneCount: 0,
  _errorCount: 0,
  _isConverting: false,
  _dirHandle: null,     // File System Access API directory handle

  // ─── Initialization ───────────────────────────────────────────────

  /**
   * Boot the application once the DOM is ready.
   */
  init() {
    // 1. Ensure dependencies exist
    if (typeof SettingsManager === 'undefined' ||
        typeof TextParser      === 'undefined' ||
        typeof TTSEngine       === 'undefined' ||
        typeof AudioManager    === 'undefined' ||
        typeof UIController    === 'undefined') {
      console.error('❌ Gemini Voice Studio: missing required modules.');
      return;
    }

    // 2. Load / initialise settings
    SettingsManager.init && SettingsManager.init();

    // 3. Initialise the UI controller (caches DOM elements)
    UIController.init();

    // 4. Bind all event listeners
    this._setupEventListeners();

    // 5. Sync initial UI state
    UIController.updateConvertButton();
    UIController.updateCharCount(UIController.getInputText().length);

    // 6. Initialize theme
    this._initTheme();

    // 7. Apply persisted volume
    var vol = SettingsManager.get('volume');
    if (vol != null && AudioManager.setVolume) {
      AudioManager.setVolume(vol);
    }

    // 8. Set default format in output selector
    var fmt = SettingsManager.get('format');
    var formatSelect = document.getElementById('format-select');
    if (fmt && formatSelect) {
      formatSelect.value = fmt;
    }

    console.log('🎙️ Gemini Voice Studio initialized');
  },

  // ─── Event Listener Wiring ────────────────────────────────────────

  /**
   * Register every UI event listener. Uses arrow functions to preserve
   * `this` context throughout.
   */
  _setupEventListeners() {
    var self = this;
    var el = UIController._elements;

    // ── Theme Toggle ────────────────────────────────────────────
    if (el.themeToggleBtn) {
      el.themeToggleBtn.addEventListener('click', function () {
        self._toggleTheme();
      });
    }

    // ── Tab Switching ────────────────────────────────────────────
    if (el.tabManualBtn) {
      el.tabManualBtn.addEventListener('click', function () {
        self._switchTab('manual');
      });
    }
    if (el.tabBatchBtn) {
      el.tabBatchBtn.addEventListener('click', function () {
        self._switchTab('batch');
      });
    }

    // ── Batch Controls ──────────────────────────────────────────
    if (el.batchStartBtn) {
      el.batchStartBtn.addEventListener('click', function () {
        self._startBatchPolling();
      });
    }
    if (el.batchStopBtn) {
      el.batchStopBtn.addEventListener('click', function () {
        self._stopBatchPolling();
      });
    }
    if (el.batchRefreshBtn) {
      el.batchRefreshBtn.addEventListener('click', function () {
        self._refreshBatchTable();
      });
    }
    if (el.batchFolderBtn) {
      el.batchFolderBtn.addEventListener('click', function () {
        self._pickSaveFolder();
      });
    }

    // ── Text Input ───────────────────────────────────────────────
    if (el.textInput) {
      el.textInput.addEventListener('input', function () {
        self._onTextChange();
      });

      // Paste (Google Docs HTML support)
      el.textInput.addEventListener('paste', function (e) {
        self._handlePaste(e);
      });

      // Drag & drop .txt files onto textarea
      el.textInput.addEventListener('dragover', function (e) {
        e.preventDefault();
        el.textInput.classList.add('drag-over');
      });
      el.textInput.addEventListener('dragleave', function () {
        el.textInput.classList.remove('drag-over');
      });
      el.textInput.addEventListener('drop', function (e) {
        e.preventDefault();
        el.textInput.classList.remove('drag-over');
        var file = e.dataTransfer && e.dataTransfer.files[0];
        if (file) self._handleFileUpload(file);
      });
    }

    // ── File Upload ──────────────────────────────────────────────
    if (el.uploadBtn) {
      el.uploadBtn.addEventListener('click', function () {
        if (el.fileUpload) el.fileUpload.click();
      });
    }
    if (el.fileUpload) {
      el.fileUpload.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) {
          self._handleFileUpload(file);
          // Reset input so the same file can be re-uploaded
          e.target.value = '';
        }
      });
    }

    // Google Docs fetch button
    if (el.gdocFetchBtn) {
      el.gdocFetchBtn.addEventListener('click', function () {
        self._handleGoogleDocFetch();
      });
    }
    // Also allow Enter key in the URL input
    if (el.gdocUrlInput) {
      el.gdocUrlInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          self._handleGoogleDocFetch();
        }
      });
    }

    // ── Clear Button ─────────────────────────────────────────────
    if (el.clearBtn) {
      el.clearBtn.addEventListener('click', function () {
        self._segments = [];
        self._results = {};
        UIController.reset();
        // Stop any playing audio
        if (AudioManager.stopAll) AudioManager.stopAll();
      });
    }

    // ── Conversion Buttons ───────────────────────────────────────
    if (el.convertBtn) {
      el.convertBtn.addEventListener('click', function () {
        self._startConversion();
      });
    }
    if (el.cancelBtn) {
      el.cancelBtn.addEventListener('click', function () {
        if (TTSEngine.cancel) TTSEngine.cancel();
      });
    }
    if (el.retryFailedBtn) {
      el.retryFailedBtn.addEventListener('click', function () {
        self._retryFailed();
      });
    }

    // ── Settings ─────────────────────────────────────────────────
    if (el.settingsBtn) {
      el.settingsBtn.addEventListener('click', function () {
        UIController.openSettings();
      });
    }
    if (el.closeSettingsBtn) {
      el.closeSettingsBtn.addEventListener('click', function () {
        UIController.closeSettings();
      });
    }
    if (el.settingsOverlay) {
      el.settingsOverlay.addEventListener('click', function () {
        UIController.closeSettings();
      });
    }
    if (el.saveSettingsBtn) {
      el.saveSettingsBtn.addEventListener('click', function () {
        self._saveSettings();
      });
    }

    // API key visibility toggle (textarea uses CSS masking)
    if (el.apiKeyToggle) {
      el.apiKeyToggle.addEventListener('click', function () {
        if (!el.apiKeysInput) return;
        var isMasked = el.apiKeysInput.classList.contains('apikeys-masked');
        el.apiKeysInput.classList.toggle('apikeys-masked', !isMasked);
        el.apiKeyToggle.classList.toggle('active', isMasked);
      });
      // Start masked by default
      if (el.apiKeysInput) {
        el.apiKeysInput.classList.add('apikeys-masked');
      }
    }

    // Load models button
    if (el.loadModelsBtn) {
      el.loadModelsBtn.addEventListener('click', function () {
        self._loadModels();
      });
    }

    // Voice grid — toggle active class
    if (el.voiceGrid) {
      el.voiceGrid.addEventListener('click', function (e) {
        var btn = e.target.closest('.voice-btn');
        if (!btn) return;
        el.voiceGrid.querySelectorAll('.voice-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
      });
    }

    // Volume slider — live preview
    if (el.volumeSlider) {
      el.volumeSlider.addEventListener('input', function () {
        var val = parseFloat(el.volumeSlider.value);
        if (el.volumeValue) {
          el.volumeValue.textContent = Math.round(val) + '%';
        }
        if (AudioManager.setVolume) AudioManager.setVolume(val);
      });
    }

    // Output format selector
    var formatSelect = document.getElementById('format-select');
    if (formatSelect) {
      formatSelect.addEventListener('change', function () {
        // Persist choice for session
        SettingsManager.set && SettingsManager.set('format', formatSelect.value);
      });
    }

    // Download all button
    if (el.downloadAllBtn) {
      el.downloadAllBtn.addEventListener('click', function () {
        self._handleDownloadAll();
      });
    }

    // ── Keyboard Shortcuts ───────────────────────────────────────
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        UIController.closeSettings();
      }
    });

    // ── Audio List Event Delegation ──────────────────────────────
    if (el.audioList) {
      el.audioList.addEventListener('click', function (e) {
        var playBtn = e.target.closest('.play-btn');
        var downloadBtn = e.target.closest('.download-segment-btn');
        var retryBtn = e.target.closest('.retry-btn');

        if (playBtn) {
          var playId = parseInt(playBtn.dataset.id, 10);
          if (!isNaN(playId)) self._handlePlayPause(playId);
        }
        if (downloadBtn) {
          var dlId = parseInt(downloadBtn.dataset.id, 10);
          if (!isNaN(dlId)) self._handleSegmentDownload(dlId);
        }
        if (retryBtn) {
          var retryId = parseInt(retryBtn.dataset.id, 10);
          if (!isNaN(retryId)) self._handleRetrySegment(retryId);
        }
      });
    }
  },

  // ─── Paste Handler ────────────────────────────────────────────────

  /**
   * Intercept paste events on the textarea so that HTML content
   * (e.g. from Google Docs) is converted to clean plain text first.
   * @param {ClipboardEvent} e
   */
  _handlePaste(e) {
    var html = e.clipboardData && e.clipboardData.getData('text/html');
    if (html && html.indexOf('<') !== -1) {
      e.preventDefault();
      var text = TextParser.parseHtmlPaste
        ? TextParser.parseHtmlPaste(html)
        : e.clipboardData.getData('text/plain');
      UIController.setInputText(text);
      this._onTextChange();
    }
    // Otherwise let the browser's default plain-text paste occur.
  },

  // ─── Text Change Handler ──────────────────────────────────────────

  /**
   * Called whenever the textarea content changes (input / paste / file load).
   */
  _onTextChange() {
    var text = UIController.getInputText();
    UIController.updateCharCount(text.length);
    this._segments = TextParser.parseText ? TextParser.parseText(text) : [];
    UIController.renderSegments(this._segments);
    UIController.updateConvertButton();
  },

  // ─── File Upload Handler ──────────────────────────────────────────

  /**
   * Read a dropped or selected file and populate the textarea.
   * @param {File} file
   */
  _handleFileUpload(file) {
    if (!file) return;

    var self = this;
    TextParser.readFile(file)
      .then(function (text) {
        UIController.setInputText(text);
        self._onTextChange();
        UIController.showToast('Đã tải tệp: ' + file.name, 'success');
      })
      .catch(function (err) {
        UIController.showToast(
          'Lỗi đọc tệp: ' + (err && err.message ? err.message : err),
          'error'
        );
      });
  },

  // ─── Google Docs Fetch ────────────────────────────────────────────

  /**
   * Fetch text content from a public Google Docs link and populate the textarea.
   */
  _handleGoogleDocFetch() {
    var self = this;
    var el = UIController._elements;
    var url = el.gdocUrlInput ? el.gdocUrlInput.value.trim() : '';
    var statusEl = el.gdocStatus;
    var fetchBtn = el.gdocFetchBtn;

    if (!url) {
      UIController.showToast('Vui lòng dán link Google Docs.', 'warning');
      if (el.gdocUrlInput) el.gdocUrlInput.focus();
      return;
    }

    // Validate URL pattern
    if (!TextParser.extractGoogleDocId(url)) {
      UIController.showToast('Link không hợp lệ. Cần link dạng: docs.google.com/document/d/...', 'warning');
      return;
    }

    // Show loading state
    if (fetchBtn) {
      fetchBtn.disabled = true;
      var svgIcon = fetchBtn.querySelector('svg');
      if (svgIcon) svgIcon.classList.add('spinning');
    }
    if (statusEl) {
      statusEl.textContent = 'Đang tải nội dung tài liệu...';
      statusEl.style.color = '';
    }

    TextParser.fetchGoogleDoc(url)
      .then(function (text) {
        UIController.setInputText(text);
        self._onTextChange();

        var charCount = text.length.toLocaleString('vi-VN');
        if (statusEl) {
          statusEl.textContent = 'Đã tải thành công! ' + charCount + ' ký tự.';
          statusEl.style.color = 'var(--success)';
        }
        UIController.showToast('Đã tải nội dung Google Docs (' + charCount + ' ký tự)', 'success');
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : 'Lỗi không xác định';
        if (statusEl) {
          statusEl.textContent = msg;
          statusEl.style.color = 'var(--danger)';
        }
        UIController.showToast(msg, 'error');
      })
      .finally(function () {
        if (fetchBtn) {
          fetchBtn.disabled = false;
          var svgIcon = fetchBtn.querySelector('svg');
          if (svgIcon) svgIcon.classList.remove('spinning');
        }
      });
  },

  // ─── Conversion ───────────────────────────────────────────────────

  /**
   * Kick off the sequential segment → audio conversion.
   */
  _startConversion() {
    if (this._segments.length === 0) return;
    if (this._isConverting) return;

    var settings = SettingsManager.getAll();
    var validation = SettingsManager.validate ? SettingsManager.validate() : { valid: true };
    if (!validation.valid) {
      UIController.showToast(
        (validation.errors && validation.errors[0]) || 'Cài đặt không hợp lệ.',
        'error'
      );
      UIController.openSettings();
      return;
    }

    this._isConverting = true;
    this._results = {};
    this._failedSegments = [];
    this._doneCount = 0;
    this._errorCount = 0;
    // Reset key rotation to start from first key
    if (SettingsManager.resetKeyIndex) SettingsManager.resetKeyIndex();
    UIController.setConvertingState(true);
    UIController.clearOutput();
    UIController.initAudioList(this._segments);
    UIController.showProgress(true);

    var self = this;
    var segments = this._segments;

    TTSEngine.convertAll(segments, settings, {
      onProgress: function (current, total) {
        UIController.updateProgress(current, total);
        var seg = segments[current - 1];
        if (seg) UIController.updateSegmentStatus(seg.id, 'processing');
      },

      onSegmentDone: function (id, base64Pcm) {
        self._results[id] = base64Pcm;
        self._doneCount++;
        UIController.updateSegmentStatus(id, 'done');
        UIController.updateOutputStats(self._doneCount, self._errorCount);

        var duration = AudioManager.getDuration
          ? AudioManager.getDuration(base64Pcm)
          : 0;
        var formatted = AudioManager.formatDuration
          ? AudioManager.formatDuration(duration)
          : '0:00';
        UIController.showAudioPlayer(id, formatted);
      },

      onSegmentError: function (id, error) {
        self._errorCount++;
        // Track the failed segment for retry
        for (var i = 0; i < segments.length; i++) {
          if (segments[i].id === id) {
            self._failedSegments.push({
              id: segments[i].id,
              text: segments[i].text,
              charCount: segments[i].charCount,
              error: error
            });
            break;
          }
        }
        UIController.updateSegmentStatus(id, 'error');
        UIController.updateOutputStats(self._doneCount, self._errorCount);
        UIController.showToast('Đoạn #' + id + ': ' + error, 'error');
      },

      onComplete: function (results) {
        self._isConverting = false;
        UIController.setConvertingState(false);

        var successCount = 0;
        if (results && results.length) {
          for (var i = 0; i < results.length; i++) {
            if (results[i] && results[i].success) successCount++;
          }
        }

        UIController.updateOutputStats(self._doneCount, self._errorCount);

        if (successCount > 0) {
          UIController.showOutputActions(true);
          UIController.showToast(
            'Hoàn thành! ' + successCount + '/' + results.length + ' đoạn thành công.' +
            (self._errorCount > 0 ? ' (' + self._errorCount + ' lỗi)' : ''),
            self._errorCount > 0 ? 'warning' : 'success'
          );
          UIController.updateProgress(results.length, results.length);
        } else {
          UIController.showToast(
            'Không có đoạn nào được chuyển đổi thành công.',
            'error'
          );
        }
      },

      onCancel: function () {
        self._isConverting = false;
        UIController.setConvertingState(false);
        UIController.updateOutputStats(self._doneCount, self._errorCount);
        UIController.showToast('Đã hủy chuyển đổi.', 'warning');
      }
    });
  },

  /**
   * Retry only the failed segments.
   */
  _retryFailed() {
    if (this._failedSegments.length === 0) return;
    if (this._isConverting) return;

    var settings = SettingsManager.getAll();
    var validation = SettingsManager.validate ? SettingsManager.validate() : { valid: true };
    if (!validation.valid) {
      UIController.showToast(
        (validation.errors && validation.errors[0]) || 'Cài đặt không hợp lệ.',
        'error'
      );
      return;
    }

    this._isConverting = true;
    if (SettingsManager.resetKeyIndex) SettingsManager.resetKeyIndex();
    UIController.setConvertingState(true);
    UIController.showProgress(true);

    // Hide retry button during retry
    if (UIController._elements.retryFailedBtn) {
      UIController._elements.retryFailedBtn.classList.add('hidden');
    }

    var self = this;
    var retrySegments = this._failedSegments.slice();
    this._failedSegments = [];
    var retryErrorCount = 0;

    // Reset the status of segments being retried
    for (var r = 0; r < retrySegments.length; r++) {
      UIController.updateSegmentStatus(retrySegments[r].id, 'pending');
    }

    TTSEngine.convertAll(retrySegments, settings, {
      onProgress: function (current, total) {
        UIController.updateProgress(current, total);
        var seg = retrySegments[current - 1];
        if (seg) UIController.updateSegmentStatus(seg.id, 'processing');
      },

      onSegmentDone: function (id, base64Pcm) {
        self._results[id] = base64Pcm;
        self._doneCount++;
        self._errorCount--;
        UIController.updateSegmentStatus(id, 'done');
        UIController.updateOutputStats(self._doneCount, self._errorCount);

        var duration = AudioManager.getDuration
          ? AudioManager.getDuration(base64Pcm)
          : 0;
        var formatted = AudioManager.formatDuration
          ? AudioManager.formatDuration(duration)
          : '0:00';
        UIController.showAudioPlayer(id, formatted);
      },

      onSegmentError: function (id, error) {
        retryErrorCount++;
        for (var i = 0; i < retrySegments.length; i++) {
          if (retrySegments[i].id === id) {
            self._failedSegments.push(retrySegments[i]);
            break;
          }
        }
        UIController.updateSegmentStatus(id, 'error');
        UIController.updateOutputStats(self._doneCount, self._errorCount);
      },

      onComplete: function () {
        self._isConverting = false;
        UIController.setConvertingState(false);
        UIController.updateOutputStats(self._doneCount, self._errorCount);

        if (retryErrorCount === 0) {
          UIController.showToast('✅ Tất cả đoạn lỗi đã được khắc phục!', 'success');
        } else {
          UIController.showToast(
            'Vẫn còn ' + retryErrorCount + ' đoạn lỗi. Bấm "Đọc lại lỗi" để thử lại.',
            'warning'
          );
        }

        if (self._doneCount > 0) {
          UIController.showOutputActions(true);
        }
      },

      onCancel: function () {
        self._isConverting = false;
        UIController.setConvertingState(false);
        UIController.updateOutputStats(self._doneCount, self._errorCount);
        UIController.showToast('Đã hủy thử lại.', 'warning');
      }
    });
  },

  // ─── Audio Playback ───────────────────────────────────────────────

  /**
   * Toggle play/pause for a specific segment's audio.
   * Stops all other playing audio first.
   * @param {number} segmentId
   */
  _handlePlayPause(segmentId) {
    var base64Pcm = this._results[segmentId];
    if (!base64Pcm) return;

    var item = document.querySelector('.audio-item[data-id="' + segmentId + '"]');
    if (!item) return;
    var playBtn = item.querySelector('.play-btn');
    if (!playBtn) return;

    // Check if this segment is currently playing
    var currentAudio =
      AudioManager._audioElements && AudioManager._audioElements[segmentId];

    if (currentAudio && !currentAudio.paused) {
      // Pause it
      if (AudioManager.pause) AudioManager.pause(segmentId);
      playBtn.innerHTML = ICONS.play;
      return;
    }

    // Stop everything else first
    if (AudioManager.stopAll) AudioManager.stopAll();

    // Reset all play buttons back to play icon
    document.querySelectorAll('.play-btn').forEach(function (btn) {
      btn.innerHTML = ICONS.play;
    });

    // Create WAV blob and play
    var blob = AudioManager.createWavBlob
      ? AudioManager.createWavBlob(base64Pcm)
      : null;
    if (!blob) return;

    var vol = SettingsManager.get('volume');
    if (vol != null && AudioManager.setVolume) AudioManager.setVolume(vol);

    var audio = AudioManager.play(blob, segmentId);
    if (!audio) return;
    playBtn.innerHTML = ICONS.pause;

    var progressFill = item.querySelector('.audio-progress-fill');
    var durationSpan = item.querySelector('.audio-duration');

    // Live progress updates
    audio.addEventListener('timeupdate', function () {
      if (audio.duration) {
        var pct = (audio.currentTime / audio.duration) * 100;
        if (progressFill) progressFill.style.width = pct + '%';
        if (durationSpan && AudioManager.formatDuration) {
          durationSpan.textContent = AudioManager.formatDuration(audio.currentTime);
        }
      }
    });

    // Reset when playback ends
    audio.addEventListener('ended', function () {
      playBtn.innerHTML = ICONS.play;
      if (progressFill) progressFill.style.width = '0%';
      if (durationSpan && AudioManager.formatDuration && AudioManager.getDuration) {
        var totalDuration = AudioManager.getDuration(base64Pcm);
        durationSpan.textContent = AudioManager.formatDuration(totalDuration);
      }
    });
  },

  // ─── Segment Download ─────────────────────────────────────────────

  /**
   * Download a single segment's audio file.
   * @param {number} segmentId
   */
  _handleSegmentDownload(segmentId) {
    var base64Pcm = this._results[segmentId];
    if (!base64Pcm) return;

    var formatSelect = document.getElementById('format-select');
    var format = (formatSelect && formatSelect.value) ||
                 SettingsManager.get('format') || 'wav';

    var self = this;
    try {
      var blobPromise = AudioManager.getSegmentBlob
        ? AudioManager.getSegmentBlob(base64Pcm, format)
        : Promise.resolve(AudioManager.createWavBlob(base64Pcm));

      Promise.resolve(blobPromise)
        .then(function (blob) {
          if (AudioManager.download) {
            AudioManager.download(blob, 'segment_' + segmentId + '.' + format);
          }
          UIController.showToast('Đã tải đoạn #' + segmentId, 'success');
        })
        .catch(function (err) {
          UIController.showToast(
            'Lỗi tải xuống: ' + (err && err.message ? err.message : err),
            'error'
          );
        });
    } catch (err) {
      UIController.showToast(
        'Lỗi tải xuống: ' + (err && err.message ? err.message : err),
        'error'
      );
    }
  },

  // ─── Download All ─────────────────────────────────────────────────

  /**
   * Merge and download all successfully converted segments as a single file.
   */
  _handleDownloadAll() {
    var formatSelect = document.getElementById('format-select');
    var format = (formatSelect && formatSelect.value) ||
                 SettingsManager.get('format') || 'wav';

    var sortedIds = Object.keys(this._results)
      .map(Number)
      .sort(function (a, b) { return a - b; });

    var self = this;
    var pcmArray = sortedIds.map(function (id) { return self._results[id]; });

    if (pcmArray.length === 0) {
      UIController.showToast('Không có dữ liệu âm thanh để tải.', 'warning');
      return;
    }

    UIController.showToast('Đang chuẩn bị tải xuống...', 'info');

    try {
      var downloadPromise = AudioManager.downloadAll
        ? AudioManager.downloadAll(pcmArray, 'gemini_voice_studio_output.' + format, format)
        : Promise.reject(new Error('downloadAll not available'));

      Promise.resolve(downloadPromise)
        .then(function () {
          UIController.showToast('Đã tải tất cả đoạn!', 'success');
        })
        .catch(function (err) {
          UIController.showToast(
            'Lỗi: ' + (err && err.message ? err.message : err),
            'error'
          );
        });
    } catch (err) {
      UIController.showToast(
        'Lỗi: ' + (err && err.message ? err.message : err),
        'error'
      );
    }
  },

  // ─── Retry Single Segment ──────────────────────────────────────────

  /**
   * Retry converting a single segment.
   * @param {number} segmentId
   */
  _handleRetrySegment(segmentId) {
    var self = this;
    var segment = null;

    // Find the segment in our stored segments
    for (var i = 0; i < this._segments.length; i++) {
      if (this._segments[i].id === segmentId) {
        segment = this._segments[i];
        break;
      }
    }

    if (!segment) {
      UIController.showToast('Không tìm thấy đoạn văn bản.', 'error');
      return;
    }

    var settings = SettingsManager.getAll();
    var validation = SettingsManager.validate();
    if (!validation.valid) {
      UIController.showToast(validation.errors[0], 'warning');
      return;
    }

    // Update UI to processing
    UIController.updateSegmentStatus(segmentId, 'processing');
    UIController.showToast('Đang tạo lại đoạn #' + segmentId + '...', 'info', 2000);

    // Hide player while re-processing
    var audioItem = UIController._getAudioItem(segmentId);
    if (audioItem) {
      var player = audioItem.querySelector('.audio-item-player');
      if (player) player.style.display = 'none';
    }

    // Stop any playing audio for this segment
    AudioManager.pause(segmentId);

    // Use the retry-enabled conversion
    TTSEngine._convertWithRetry(segment.text, settings, new AbortController().signal)
      .then(function (result) {
        // Update stored result
        self._results[segmentId] = result.base64Pcm;

        // Update UI
        UIController.updateSegmentStatus(segmentId, 'done');
        var duration = AudioManager.getDuration(result.base64Pcm);
        UIController.showAudioPlayer(segmentId, AudioManager.formatDuration(duration));
        UIController.showToast('Đã tạo lại đoạn #' + segmentId + ' thành công!', 'success');
      })
      .catch(function (err) {
        UIController.updateSegmentStatus(segmentId, 'error');
        var msg = (err && err.message) ? err.message : 'Lỗi không xác định';
        UIController.showToast('Lỗi đoạn #' + segmentId + ': ' + msg, 'error');
      });
  },

  // ─── Theme ────────────────────────────────────────────────────────

  THEME_KEY: 'gemini_voice_studio_theme',

  /**
   * Initialize theme from localStorage or system preference.
   */
  _initTheme() {
    var savedTheme = localStorage.getItem(this.THEME_KEY);
    if (!savedTheme) {
      // Auto-detect system preference
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      savedTheme = prefersDark ? 'dark' : 'light';
    }
    this._applyTheme(savedTheme);
  },

  /**
   * Toggle between light and dark themes.
   */
  _toggleTheme() {
    var currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    var newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this._applyTheme(newTheme);
    localStorage.setItem(this.THEME_KEY, newTheme);
    UIController.showToast(
      newTheme === 'dark' ? '🌙 Chế độ tối' : '☀️ Chế độ sáng',
      'info', 1500
    );
  },

  /**
   * Apply a theme by setting data-theme attribute.
   * @param {string} theme - 'light' or 'dark'
   */
  _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(this.THEME_KEY, theme);
  },

  // ─── Tab Switching ────────────────────────────────────────────────

  /**
   * Switch between 'manual' and 'batch' tabs.
   * @param {string} tab - 'manual' or 'batch'
   */
  _switchTab(tab) {
    var el = UIController._elements;

    // Update tab buttons
    if (el.tabManualBtn) {
      el.tabManualBtn.classList.toggle('active', tab === 'manual');
    }
    if (el.tabBatchBtn) {
      el.tabBatchBtn.classList.toggle('active', tab === 'batch');
    }

    // Show/hide panels
    if (el.manualPanel) {
      el.manualPanel.classList.toggle('hidden', tab !== 'manual');
    }
    if (el.batchPanel) {
      el.batchPanel.classList.toggle('hidden', tab !== 'batch');
    }
  },

  // ─── File System Access ───────────────────────────────────────────

  /**
   * Check if File System Access API is supported.
   */
  _supportsFileSystem() {
    return typeof window.showDirectoryPicker === 'function';
  },

  /**
   * Open folder picker and store the directory handle.
   */
  async _pickSaveFolder() {
    if (!this._supportsFileSystem()) {
      UIController.showToast(
        'Trình duyệt không hỗ trợ lưu trực tiếp. Sẽ tải xuống ZIP thay thế.',
        'warning', 4000
      );
      return;
    }

    try {
      this._dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      var el = UIController._elements;
      if (el.batchFolderName) {
        el.batchFolderName.textContent = '📁 ' + this._dirHandle.name;
      }
      if (el.batchFolderBtn) {
        el.batchFolderBtn.classList.add('folder-selected');
      }
      // Pass handle to BatchProcessor
      BatchProcessor._dirHandle = this._dirHandle;
      UIController.showToast(
        'Đã chọn: ' + this._dirHandle.name + ' — file sẽ lưu trực tiếp',
        'success', 3000
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        UIController.showToast('Lỗi chọn thư mục: ' + err.message, 'error');
      }
    }
  },

  // ─── Batch Automation ─────────────────────────────────────────────

  /**
   * Refresh the batch table from Google Sheet.
   */
  async _refreshBatchTable(silent) {
    var el = UIController._elements;
    if (!el.batchTableBody) return;

    var url = SettingsManager.get('appsScriptUrl');
    if (!url) {
      if (!silent) UIController.showToast('Vui lòng nhập URL Apps Script trong Cài đặt', 'warning');
      return;
    }

    // Only show loading on first load (when table is empty or has placeholder)
    var isFirstLoad = el.batchTableBody.querySelectorAll('tr[data-row]').length === 0;
    if (isFirstLoad) {
      el.batchTableBody.innerHTML = '<tr><td colspan="5" class="batch-empty">Đang tải...</td></tr>';
    }

    try {
      var rows = await SheetManager.fetchAllJobs();
      this._renderBatchTable(rows);
      if (!silent) UIController.showToast('Đã tải ' + rows.length + ' dòng từ Sheet', 'success', 2000);
    } catch (err) {
      // Only overwrite table on error if it was a manual refresh
      if (!silent) {
        el.batchTableBody.innerHTML = '<tr><td colspan="5" class="batch-empty">Lỗi: ' + err.message + '</td></tr>';
        UIController.showToast('Lỗi tải Sheet: ' + err.message, 'error');
      }
    }
  },

  /**
   * Render rows into the batch table.
   * @param {Array} rows
   */
  _renderBatchTable(rows) {
    var el = UIController._elements;
    if (!el.batchTableBody) return;

    if (!rows || rows.length === 0) {
      el.batchTableBody.innerHTML = '<tr><td colspan="5" class="batch-empty">Không có dữ liệu</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var statusClass = this._getStatusClass(r.status);
      html += '<tr data-row="' + r.row + '">' +
        '<td>' + r.row + '</td>' +
        '<td>' + this._getStatusBadgeHtml(r.status, statusClass) + '</td>' +
        '<td>' + (r.voice || '-') + '</td>' +
        '<td>' + (r.speed || '-') + '</td>' +
        '<td>' + (r.note || '-') + '</td>' +
        '</tr>';
    }
    el.batchTableBody.innerHTML = html;
  },

  /**
   * Get CSS class suffix for a status value.
   */
  _getStatusClass(status) {
    if (!status) return 'pending';
    var s = status.toString().trim().toLowerCase();
    if (s === 'run') return 'run';
    if (s === 'đang chạy') return 'processing';
    if (s === 'đã xong') return 'done';
    if (s === 'lỗi') return 'error';
    return 'pending';
  },

  /**
   * Generate HTML for a status badge.
   */
  _getStatusBadgeHtml(status, cls) {
    var label = status || 'Chờ';
    return '<span class="batch-status-badge status-' + cls + '">' +
      '<span class="batch-status-dot"></span>' + label + '</span>';
  },

  /**
   * Start batch polling.
   */
  _startBatchPolling() {
    var url = SettingsManager.get('appsScriptUrl');
    if (!url) {
      UIController.showToast('Vui lòng nhập URL Apps Script trong Cài đặt', 'warning');
      return;
    }

    var interval = (SettingsManager.get('pollingInterval') || 20) * 1000;
    var self = this;

    // Set up status callback
    BatchProcessor.setStatusCallback(function (state) {
      self._onBatchStatusChange(state);
    });

    BatchProcessor.startPolling(interval);

    // Update button states
    var el = UIController._elements;
    if (el.batchStartBtn) el.batchStartBtn.disabled = true;
    if (el.batchStopBtn) el.batchStopBtn.disabled = false;

    UIController.showToast('Bắt đầu quét Sheet tự động', 'success', 2000);

    // Also load the table immediately
    this._refreshBatchTable();
  },

  /**
   * Stop batch polling.
   */
  _stopBatchPolling() {
    BatchProcessor.stopPolling();

    var el = UIController._elements;
    if (el.batchStartBtn) el.batchStartBtn.disabled = false;
    if (el.batchStopBtn) el.batchStopBtn.disabled = true;

    // Reset polling indicator
    if (el.batchPollingStatus) {
      el.batchPollingStatus.className = 'polling-indicator';
    }
    if (el.batchStatusText) {
      el.batchStatusText.textContent = 'Đã dừng';
    }
    if (el.batchProgress) {
      el.batchProgress.classList.add('hidden');
    }

    UIController.showToast('Đã dừng quét', 'info', 2000);
  },

  /**
   * Callback when batch status changes.
   * @param {Object} state - {isPolling, isProcessing, currentJob, lastCheck, error}
   */
  _onBatchStatusChange(state) {
    var el = UIController._elements;

    // Update polling indicator
    if (el.batchPollingStatus) {
      if (state.isProcessing) {
        el.batchPollingStatus.className = 'polling-indicator polling-processing';
      } else if (state.isPolling) {
        el.batchPollingStatus.className = 'polling-indicator polling-active';
      } else {
        el.batchPollingStatus.className = 'polling-indicator';
      }
    }

    // Update status text
    if (el.batchStatusText) {
      if (state.isProcessing && state.currentJob) {
        el.batchStatusText.textContent = 'Đang xử lý dòng ' + state.currentJob.row +
          (state.currentJob.note ? ' - ' + state.currentJob.note : '');
      } else if (state.isPolling) {
        var timeStr = state.lastCheck
          ? new Date(state.lastCheck).toLocaleTimeString('vi-VN')
          : '--:--';
        el.batchStatusText.textContent = 'Đang quét • Lần cuối: ' + timeStr;
      } else {
        el.batchStatusText.textContent = 'Đã dừng';
      }
    }

    // Show/hide progress
    if (el.batchProgress) {
      el.batchProgress.classList.toggle('hidden', !state.isProcessing);
    }

    if (state.isProcessing && state.currentJob && el.batchProgressLabel) {
      el.batchProgressLabel.textContent = 'Đang xử lý: ' +
        (state.currentJob.note || 'Dòng ' + state.currentJob.row);
    }

    // Handle errors
    if (state.error) {
      UIController.showToast(state.error, 'error');
    }

    // If a job just completed, refresh the table silently
    if (!state.isProcessing && state.lastCheck) {
      this._refreshBatchTable(true);
    }
  },

  // ─── Settings Persistence ─────────────────────────────────────────

  /**
   * Read values from the settings form, persist them, and close the modal.
   */
  _saveSettings() {
    var settings = UIController.getSettingsFromForm();
    if (SettingsManager.save) {
      SettingsManager.save(settings);
    }
    UIController.closeSettings();
    UIController.showToast('Đã lưu cài đặt!', 'success');
    UIController.updateConvertButton();
  },

  // ─── Load Models ────────────────────────────────────────────────────

  /**
   * Fetch available TTS models from Gemini API and populate the dropdown.
   */
  _loadModels() {
    var el = UIController._elements;
    // Get the first API key from the textarea
    var keysRaw = el.apiKeysInput ? el.apiKeysInput.value.trim() : '';
    var firstKey = keysRaw.split('\n').map(function(k){ return k.trim(); }).filter(function(k){ return k.length > 0; })[0] || '';
    var statusEl = el.modelLoadStatus;
    var loadBtn = el.loadModelsBtn;
    var modelSelect = el.modelSelect;

    if (!firstKey) {
      UIController.showToast('Vui lòng nhập ít nhất một API Key trước.', 'warning');
      if (el.apiKeysInput) el.apiKeysInput.focus();
      return;
    }

    // Show loading state
    if (loadBtn) {
      loadBtn.disabled = true;
      var svgIcon = loadBtn.querySelector('svg');
      if (svgIcon) svgIcon.classList.add('spinning');
    }
    if (statusEl) {
      statusEl.textContent = 'Đang tải danh sách model...';
      statusEl.style.color = '';
    }

    TTSEngine.fetchModels(firstKey)
      .then(function (models) {
        if (!modelSelect) return;

        // Remember current selection
        var currentValue = modelSelect.value || SettingsManager.get('model') || '';

        // Clear and populate
        modelSelect.innerHTML = '';

        if (models.length === 0) {
          modelSelect.innerHTML = '<option value="">-- Không tìm thấy model TTS --</option>';
          if (statusEl) {
            statusEl.textContent = 'Không tìm thấy model TTS nào.';
            statusEl.style.color = 'var(--warning)';
          }
          return;
        }

        var hasCurrentValue = false;
        for (var i = 0; i < models.length; i++) {
          var opt = document.createElement('option');
          opt.value = models[i].id;
          opt.textContent = models[i].displayName;
          modelSelect.appendChild(opt);
          if (models[i].id === currentValue) hasCurrentValue = true;
        }

        // Restore selection if possible
        if (hasCurrentValue) {
          modelSelect.value = currentValue;
        }

        if (statusEl) {
          statusEl.textContent = 'Đã tải ' + models.length + ' model.';
          statusEl.style.color = 'var(--success)';
        }
        UIController.showToast('Đã tải ' + models.length + ' model TTS!', 'success');
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : 'Lỗi không xác định';
        if (statusEl) {
          statusEl.textContent = msg;
          statusEl.style.color = 'var(--danger)';
        }
        UIController.showToast(msg, 'error');
      })
      .finally(function () {
        if (loadBtn) {
          loadBtn.disabled = false;
          var svgIcon = loadBtn.querySelector('svg');
          if (svgIcon) svgIcon.classList.remove('spinning');
        }
      });
  }
};

// ─── Bootstrap ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  App.init();
});
