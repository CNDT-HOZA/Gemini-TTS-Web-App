/**
 * Gemini Voice Studio - TTS Engine
 * Gemini TTS API integration with sequential processing,
 * rate limit handling with exponential backoff, and abort support.
 */
window.TTSEngine = {
  API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models',
  _abortController: null,
  _isProcessing: false,

  /**
   * Speed map: speed setting value → text prefix to prepend to the input.
   */
  SPEED_MAP: {
    'very-slow': 'Speak very slowly and deliberately: ',
    'slow': 'Speak slowly and clearly: ',
    'normal': '',
    'fast': 'Speak at a quick pace: ',
    'very-fast': 'Speak very rapidly: '
  },

  /**
   * Fetch available TTS models from the Gemini API.
   * @param {string} apiKey - The API key to authenticate.
   * @returns {Promise<Array<{ id: string, displayName: string }>>}
   */
  async fetchModels(apiKey) {
    if (!apiKey || apiKey.trim() === '') {
      throw { type: 'AUTH_ERROR', message: 'Vui lòng nhập API Key trước.' };
    }

    var url = this.API_BASE + '?key=' + apiKey.trim();
    var response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw { type: 'NETWORK', message: 'Lỗi kết nối mạng: ' + err.message };
    }

    if (!response.ok) {
      if (response.status === 400 || response.status === 403) {
        throw { type: 'AUTH_ERROR', message: 'API Key không hợp lệ.' };
      }
      throw { type: 'UNKNOWN', message: 'Lỗi: ' + response.status };
    }

    var data;
    try {
      data = await response.json();
    } catch (err) {
      throw { type: 'PARSE_ERROR', message: 'Không thể đọc danh sách model.' };
    }

    if (!data.models || !Array.isArray(data.models)) {
      return [];
    }

    // Filter for TTS models and models that support generateContent
    var ttsModels = data.models.filter(function (m) {
      var name = (m.name || '').toLowerCase();
      var methods = m.supportedGenerationMethods || [];
      var isTts = name.indexOf('tts') !== -1;
      var supportsGenerate = methods.indexOf('generateContent') !== -1;
      return isTts && supportsGenerate;
    });

    return ttsModels.map(function (m) {
      // m.name is like "models/gemini-2.5-flash-tts"
      var id = m.name.replace('models/', '');
      var displayName = m.displayName || id;
      return { id: id, displayName: displayName };
    }).sort(function (a, b) {
      return a.displayName.localeCompare(b.displayName);
    });
  },

  /**
   * Convert a single text chunk to audio via the Gemini API.
   * @param {string} text - The text to convert.
   * @param {Object} settings - Settings object from SettingsManager.getAll().
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation.
   * @returns {Promise<{ base64Pcm: string, success: true }>}
   * @throws {{ type: string, message: string }}
   */
  async convertChunk(text, settings, signal) {
    var url = this.API_BASE + '/' + settings.model + ':generateContent?key=' + settings.apiKey;

    // Build the full text with speed and style prefixes
    var speedPrefix = this.SPEED_MAP[settings.speed] || '';
    var stylePrefix = (settings.style && settings.style.trim() !== '') ? settings.style.trim() + ': ' : '';
    var fullText = speedPrefix + stylePrefix + text;

    var requestBody = {
      contents: [{
        parts: [{ text: fullText }]
      }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: settings.voice
            }
          }
        }
      }
    };

    var fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    };

    if (signal) {
      fetchOptions.signal = signal;
    }

    var response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw { type: 'CANCELLED', message: 'Đã hủy chuyển đổi.' };
      }
      throw { type: 'NETWORK', message: 'Lỗi kết nối mạng: ' + err.message };
    }

    if (!response.ok) {
      var errorDetail = '';
      try {
        var errorJson = await response.json();
        errorDetail = errorJson.error ? errorJson.error.message : JSON.stringify(errorJson);
      } catch (_) {
        errorDetail = response.statusText;
      }

      if (response.status === 429) {
        throw { type: 'RATE_LIMIT', message: 'Giới hạn tốc độ API. Đang chờ...' };
      }
      if (response.status === 400) {
        throw { type: 'BAD_REQUEST', message: 'Yêu cầu không hợp lệ: ' + errorDetail };
      }
      if (response.status === 403) {
        throw { type: 'AUTH_ERROR', message: 'API key không hợp lệ hoặc không có quyền' };
      }
      throw { type: 'UNKNOWN', message: 'Lỗi: ' + response.status + ' - ' + errorDetail };
    }

    var data;
    try {
      data = await response.json();
    } catch (err) {
      throw { type: 'PARSE_ERROR', message: 'Không thể phân tích phản hồi từ API.' };
    }

    // Validate response structure
    if (!data.candidates ||
        !data.candidates[0] ||
        !data.candidates[0].content ||
        !data.candidates[0].content.parts ||
        !data.candidates[0].content.parts[0] ||
        !data.candidates[0].content.parts[0].inlineData ||
        !data.candidates[0].content.parts[0].inlineData.data) {
      throw { type: 'INVALID_RESPONSE', message: 'Phản hồi API không chứa dữ liệu âm thanh.' };
    }

    var base64Pcm = data.candidates[0].content.parts[0].inlineData.data;

    return {
      base64Pcm: base64Pcm,
      success: true
    };
  },

  /**
   * Convert a chunk with retry logic for rate limiting.
   * @param {string} text
   * @param {Object} settings
   * @param {AbortSignal} signal
   * @returns {Promise<{ base64Pcm: string, success: true }>}
   * @throws {{ type: string, message: string }}
   * @private
   */
  async _convertWithRetry(text, settings, signal) {
    var lastError;
    var maxRetries = 5;

    for (var retry = 0; retry <= maxRetries; retry++) {
      try {
        if (signal.aborted) {
          throw { type: 'CANCELLED', message: 'Đã hủy chuyển đổi.' };
        }
        // Refresh apiKey from SettingsManager to get current active key
        if (window.SettingsManager) {
          settings.apiKey = window.SettingsManager.getActiveKey();
        }
        return await this.convertChunk(text, settings, signal);
      } catch (err) {
        lastError = err;

        if (err.type === 'CANCELLED') {
          throw err;
        }

        if (err.type === 'RATE_LIMIT' && retry < maxRetries) {
          // Try rotating to next API key first
          var rotated = false;
          if (window.SettingsManager && window.SettingsManager.rotateKey) {
            rotated = window.SettingsManager.rotateKey();
          }

          if (rotated) {
            var newIdx = window.SettingsManager.getCurrentKeyIndex() + 1;
            var totalKeys = window.SettingsManager.getValidKeys().length;
            console.warn('TTSEngine: Rate limited. Switching to key ' + newIdx + '/' + totalKeys);
            // Short delay before trying new key
            await this._sleep(Math.min(settings.delay, 1000), signal);
          } else {
            // No more keys to rotate, use exponential backoff
            var backoff = Math.min(settings.delay * Math.pow(2, retry + 1), 30000);
            console.warn('TTSEngine: Rate limited. Retrying in ' + backoff + 'ms (attempt ' + (retry + 1) + '/' + maxRetries + ')');
            await this._sleep(backoff, signal);
          }
          continue;
        }

        // Non-rate-limit errors are not retried
        if (err.type !== 'RATE_LIMIT') {
          throw err;
        }
      }
    }

    throw lastError;
  },

  /**
   * Sleep for a given duration, abortable via signal.
   * @param {number} ms - Duration in milliseconds.
   * @param {AbortSignal} signal
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal.aborted) {
        reject({ type: 'CANCELLED', message: 'Đã hủy chuyển đổi.' });
        return;
      }

      var timer = setTimeout(function () {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      function onAbort() {
        clearTimeout(timer);
        reject({ type: 'CANCELLED', message: 'Đã hủy chuyển đổi.' });
      }

      signal.addEventListener('abort', onAbort, { once: true });
    });
  },

  /**
   * Convert all segments sequentially.
   * @param {Array<{ id: number, text: string, charCount: number }>} segments
   * @param {Object} settings - From SettingsManager.getAll().
   * @param {Object} callbacks
   * @param {function(number, number)} callbacks.onProgress - Called with (currentIndex, totalCount).
   * @param {function(number, string)} callbacks.onSegmentDone - Called with (segmentId, base64Pcm).
   * @param {function(number, string)} callbacks.onSegmentError - Called with (segmentId, errorMessage).
   * @param {function(Array)} callbacks.onComplete - Called with results array.
   * @param {function()} callbacks.onCancel - Called when processing is cancelled.
   */
  async convertAll(segments, settings, callbacks) {
    this._abortController = new AbortController();
    this._isProcessing = true;
    var signal = this._abortController.signal;
    var results = [];

    try {
      for (var i = 0; i < segments.length; i++) {
        // Check for abort before processing each segment
        if (signal.aborted) {
          if (callbacks.onCancel) callbacks.onCancel();
          this._isProcessing = false;
          return;
        }

        var segment = segments[i];

        // Notify progress
        if (callbacks.onProgress) {
          callbacks.onProgress(i + 1, segments.length);
        }

        try {
          var result = await this._convertWithRetry(segment.text, settings, signal);
          results.push({
            id: segment.id,
            success: true,
            base64Pcm: result.base64Pcm
          });
          if (callbacks.onSegmentDone) {
            callbacks.onSegmentDone(segment.id, result.base64Pcm);
          }
        } catch (err) {
          if (err.type === 'CANCELLED') {
            if (callbacks.onCancel) callbacks.onCancel();
            this._isProcessing = false;
            return;
          }

          var errorMsg = err.message || 'Lỗi không xác định';
          results.push({
            id: segment.id,
            success: false,
            error: errorMsg
          });
          if (callbacks.onSegmentError) {
            callbacks.onSegmentError(segment.id, errorMsg);
          }
        }

        // Wait between segments (unless it's the last one or aborted)
        if (i < segments.length - 1 && !signal.aborted) {
          try {
            await this._sleep(settings.delay, signal);
          } catch (sleepErr) {
            if (sleepErr.type === 'CANCELLED') {
              if (callbacks.onCancel) callbacks.onCancel();
              this._isProcessing = false;
              return;
            }
          }
        }
      }

      // All segments processed
      if (callbacks.onComplete) {
        callbacks.onComplete(results);
      }
    } finally {
      this._isProcessing = false;
    }
  },

  /**
   * Cancel ongoing conversion.
   */
  cancel() {
    if (this._abortController) {
      this._abortController.abort();
    }
    this._isProcessing = false;
  },

  /**
   * Check if currently processing.
   * @returns {boolean}
   */
  isProcessing() {
    return this._isProcessing;
  }
};
