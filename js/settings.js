/**
 * Gemini Voice Studio - Settings Manager
 * Manages application settings with localStorage persistence.
 * Supports multiple API keys with automatic rotation.
 */
window.SettingsManager = {
  STORAGE_KEY: 'gemini_voice_studio_settings',
  _currentKeyIndex: 0,

  defaults: {
    apiKeys: [],
    model: '',
    voice: 'Kore',
    style: '',
    speed: 'normal',
    volume: 80,
    format: 'wav',
    delay: 500
  },

  /**
   * Load all settings from localStorage, merged with defaults.
   * Migrates old single apiKey to apiKeys array.
   * @returns {Object}
   */
  load() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Migrate old single apiKey to apiKeys array
        if (parsed.apiKey && !parsed.apiKeys) {
          parsed.apiKeys = [parsed.apiKey];
          delete parsed.apiKey;
        }
        return { ...this.defaults, ...parsed };
      }
    } catch (e) {
      console.warn('SettingsManager: Failed to load settings.', e);
    }
    return { ...this.defaults };
  },

  /**
   * Save all settings to localStorage.
   * @param {Object} settings
   */
  save(settings) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('SettingsManager: Failed to save settings.', e);
    }
  },

  /**
   * Get a single setting value.
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    const settings = this.load();
    // Backward compat: 'apiKey' returns the active key
    if (key === 'apiKey') {
      return this.getActiveKey();
    }
    return settings.hasOwnProperty(key) ? settings[key] : this.defaults[key];
  },

  /**
   * Set a single setting value and persist immediately.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    const settings = this.load();
    settings[key] = value;
    this.save(settings);
  },

  /**
   * Get all current settings.
   * @returns {Object}
   */
  getAll() {
    var settings = this.load();
    // Inject current active key as apiKey for backward compat with TTS engine
    settings.apiKey = this.getActiveKey();
    return settings;
  },

  /**
   * Get the currently active API key.
   * @returns {string}
   */
  getActiveKey() {
    var keys = this.getValidKeys();
    if (keys.length === 0) return '';
    var idx = this._currentKeyIndex % keys.length;
    return keys[idx];
  },

  /**
   * Get the current key index (0-based).
   * @returns {number}
   */
  getCurrentKeyIndex() {
    var keys = this.getValidKeys();
    if (keys.length === 0) return 0;
    return this._currentKeyIndex % keys.length;
  },

  /**
   * Rotate to the next API key. Returns true if there are more keys to try.
   * @returns {boolean}
   */
  rotateKey() {
    var keys = this.getValidKeys();
    if (keys.length <= 1) return false;
    this._currentKeyIndex = (this._currentKeyIndex + 1) % keys.length;
    return true;
  },

  /**
   * Reset key rotation to the first key.
   */
  resetKeyIndex() {
    this._currentKeyIndex = 0;
  },

  /**
   * Get all valid (non-empty) API keys.
   * @returns {string[]}
   */
  getValidKeys() {
    var settings = this.load();
    var keys = settings.apiKeys || [];
    return keys.filter(function (k) {
      return k && typeof k === 'string' && k.trim().length > 0;
    }).map(function (k) { return k.trim(); });
  },

  /**
   * Validate current settings.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const settings = this.load();
    const errors = [];

    var validKeys = this.getValidKeys();
    if (validKeys.length === 0) {
      errors.push('Cần ít nhất một API Key. Vui lòng nhập trong Cài đặt.');
    }

    if (typeof settings.volume !== 'number' || settings.volume < 0 || settings.volume > 100) {
      errors.push('Âm lượng phải nằm trong khoảng 0 đến 100.');
    }

    if (typeof settings.delay !== 'number' || settings.delay < 0) {
      errors.push('Thời gian chờ giữa các đoạn phải là số không âm.');
    }

    const validSpeeds = ['very-slow', 'slow', 'normal', 'fast', 'very-fast'];
    if (!validSpeeds.includes(settings.speed)) {
      errors.push('Tốc độ đọc không hợp lệ.');
    }

    const validFormats = ['wav', 'mp3'];
    if (!validFormats.includes(settings.format)) {
      errors.push('Định dạng âm thanh không hợp lệ.');
    }

    if (!settings.model || typeof settings.model !== 'string' || settings.model.trim() === '') {
      errors.push('Vui lòng tải danh sách model và chọn một model trong Cài đặt.');
    }

    if (!settings.voice || typeof settings.voice !== 'string' || settings.voice.trim() === '') {
      errors.push('Giọng đọc không được để trống.');
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }
};
