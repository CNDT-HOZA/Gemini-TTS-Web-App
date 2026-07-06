/* =========================================================
 *  Gemini TTS – Voice Studio  |  Service Worker (background.js)
 *  Manifest V3 · ES5 only (var, function, no arrows/template literals)
 * ========================================================= */

// ── Global state ──────────────────────────────────────────
var state = {
  isPolling: false,
  isProcessing: false,
  currentJob: null,
  lastCheck: null,
  processedCount: 0,
  errorCount: 0,
  currentApiKeyIndex: 0
};

var ALARM_NAME = 'pollSheet';
var DEFAULT_DELAY_MS = 500;

// ── Lifecycle events ──────────────────────────────────────
chrome.runtime.onInstalled.addListener(function () {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  state.isPolling = true;
  chrome.storage.local.set({ enabled: true });

  // Enable side panel to open on icon click
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  console.log('[TTS] Extension installed – polling alarm created.');
});

chrome.runtime.onStartup.addListener(function () {
  chrome.storage.local.get(['enabled'], function (data) {
    if (data.enabled) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
      state.isPolling = true;
      console.log('[TTS] Startup – polling alarm restored.');
    }
  });

  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

// ── Alarm handler ─────────────────────────────────────────
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARM_NAME) {
    pollSheet();
  }
});

// ── Message handler ───────────────────────────────────────
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  var cmd = msg.action || msg.command || '';

  if (cmd === 'startPolling') {
    chrome.storage.local.set({ enabled: true });
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    state.isPolling = true;
    console.log('[TTS] Polling started – triggering immediate poll');
    pollSheet(); // Poll immediately, don't wait for alarm
    sendResponse({ ok: true });
    return true;
  }

  if (cmd === 'stopPolling') {
    chrome.storage.local.set({ enabled: false });
    chrome.alarms.clear(ALARM_NAME);
    state.isPolling = false;
    sendResponse({ ok: true });
    return true;
  }

  if (cmd === 'getStatus') {
    sendResponse({
      ok: true,
      state: {
        isPolling: state.isPolling,
        isProcessing: state.isProcessing,
        currentJob: state.currentJob ? (state.currentJob.note || 'Dòng ' + state.currentJob.row) : null,
        lastCheckTime: state.lastCheck,
        processed: state.processedCount,
        errors: state.errorCount
      }
    });
    return true;
  }

  if (cmd === 'refreshSheet' || cmd === 'processJobs') {
    pollSheet();
    sendResponse({ ok: true });
    return true;
  }

  if (cmd === 'loadModels') {
    chrome.storage.local.get(['apiKeys'], function (data) {
      var keysRaw = data.apiKeys || '';
      var keys = keysRaw.split('\n').map(function (k) { return k.trim(); }).filter(function (k) { return k.length > 0; });
      if (keys.length === 0) {
        sendResponse({ ok: false, error: 'Chưa có API Key' });
        return;
      }
      var apiKey = keys[0];
      var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey;
      fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var models = [];
          if (data && data.models) {
            for (var i = 0; i < data.models.length; i++) {
              var m = data.models[i];
              var name = m.name || '';
              // Only include TTS-capable models
              if (name.indexOf('tts') !== -1 || name.indexOf('flash') !== -1) {
                var id = name.replace('models/', '');
                models.push(id);
              }
            }
          }
          sendResponse({ ok: true, models: models });
        })
        .catch(function (err) {
          sendResponse({ ok: false, error: err.message });
        });
    });
    return true;
  }

  if (cmd === 'settingsUpdated') {
    // Settings were updated, nothing special to do
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

// ── Poll Sheet ────────────────────────────────────────────
function pollSheet() {
  if (state.isProcessing) {
    console.log('[TTS] Already processing – skip this poll.');
    return;
  }

  chrome.storage.local.get(
    ['appsScriptUrl', 'apiKeys', 'enabled', 'model', 'voice', 'speed', 'segmentDelay'],
    function (settings) {
      if (!settings.appsScriptUrl || !settings.enabled) {
        console.log('[TTS] Polling skipped (no URL or disabled). URL:', settings.appsScriptUrl, 'Enabled:', settings.enabled);
        return;
      }

      // Parse apiKeys from string to array
      var keysRaw = settings.apiKeys || '';
      var keysArray = keysRaw.split('\n').map(function (k) { return k.trim(); }).filter(function (k) { return k.length > 0; });
      settings._apiKeysArray = keysArray;

      state.lastCheck = new Date().toISOString();
      console.log('[TTS] Polling sheet...', settings.appsScriptUrl);

      var url = settings.appsScriptUrl + '?action=get_pending';

      fetch(url, { redirect: 'follow' })
        .then(function (res) {
          console.log('[TTS] Apps Script response status:', res.status);
          return res.json();
        })
        .then(function (data) {
          console.log('[TTS] Apps Script data:', JSON.stringify(data).substring(0, 200));
          var jobs = (data && data.pending) ? data.pending : [];

          // Update badge
          var badgeText = jobs.length > 0 ? String(jobs.length) : '';
          chrome.action.setBadgeText({ text: badgeText });
          chrome.action.setBadgeBackgroundColor({ color: '#4285F4' });

          console.log('[TTS] Found', jobs.length, 'pending jobs');
          if (jobs.length > 0) {
            processJob(jobs[0], settings);
          }
        })
        .catch(function (err) {
          console.error('[TTS] Poll error:', err.message || err);
          state.errorCount++;
        });
    }
  );
}

// ── Process a single job ──────────────────────────────────
function processJob(job, settings) {
  state.isProcessing = true;
  state.currentJob = job;

  var appsScriptUrl = settings.appsScriptUrl;
  var apiKeys = settings._apiKeysArray || [];
  if (apiKeys.length === 0) {
    // Fallback: try parsing from string
    var raw = settings.apiKeys || '';
    apiKeys = raw.split('\n').map(function (k) { return k.trim(); }).filter(function (k) { return k.length > 0; });
  }
  if (apiKeys.length === 0) {
    console.error('[TTS] No API keys configured!');
    handleJobError(appsScriptUrl, job.row, 'Chưa cài đặt API Key');
    return;
  }
  console.log('[TTS] Processing job row', job.row, 'with', apiKeys.length, 'API keys');
  var model = settings.model || 'gemini-2.5-flash-preview-tts';
  var voice = settings.voice || 'Kore';
  var speed = settings.speed || 'normal';
  var segmentDelay = (settings.segmentDelay !== undefined) ? settings.segmentDelay : DEFAULT_DELAY_MS;

  var row = job.row;
  var docUrl = job.linkDoc || '';
  var note = job.note || '';

  // Override voice/speed from sheet if specified
  if (job.voice && job.voice.trim().length > 0) {
    voice = job.voice.trim();
  }
  if (job.speed && job.speed.toString().trim().length > 0) {
    speed = job.speed.toString().trim();
  }

  // 1. Update status → Đang chạy
  updateSheetStatus(appsScriptUrl, row, 'Đang chạy');

  // 2. Extract Doc ID and fetch content
  var docId = extractDocId(docUrl);
  if (!docId) {
    handleJobError(appsScriptUrl, row, 'Không tìm thấy Doc ID từ URL');
    return;
  }

  var exportUrl = 'https://docs.google.com/document/d/' + docId + '/export?format=txt';

  fetch(exportUrl)
    .then(function (res) {
      if (!res.ok) throw new Error('Fetch doc failed: ' + res.status);
      return res.text();
    })
    .then(function (text) {
      // 3. Split into segments
      var lines = text.split('\n');
      var segments = [];
      for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].trim();
        if (trimmed.length > 0) {
          segments.push(trimmed);
        }
      }

      if (segments.length === 0) {
        handleJobError(appsScriptUrl, row, 'Document trống – không có đoạn nào');
        return;
      }

      // 4. Process segments sequentially
      var allPcmBase64 = [];
      var segmentFiles = [];
      var folderName = sanitizeFolderName(row, note);

      processSegmentsSequentially(
        segments, 0, allPcmBase64, segmentFiles,
        apiKeys, model, voice, speed, segmentDelay, folderName,
        function onComplete() {
          // 5. Concatenate all PCM → full.wav
          var fullPcmBase64 = concatenateBase64Pcm(allPcmBase64);
          var fullWavDataUrl = createWavDataUrl(fullPcmBase64);

          // Store all files for popup to save
          var filesToSave = segmentFiles.slice();
          filesToSave.push({
            dataUrl: fullWavDataUrl,
            filename: 'full.wav',
            subfolder: folderName
          });

          storePendingFiles(filesToSave);

          // Notify popup about pending saves
          chrome.runtime.sendMessage({
            action: 'saveFiles',
            files: filesToSave,
            folder: folderName
          }, function () {
            // Ignore if popup is not open
            if (chrome.runtime.lastError) {
              console.log('[TTS] Popup not open – files stored for later.');
            }
          });

          // 6. Update sheet → Đã Xong
          updateSheetStatus(appsScriptUrl, row, 'Đã Xong');

          // 7. Notification
          chrome.notifications.create('job-done-' + row, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Gemini TTS – Hoàn thành!',
            message: 'Đã tạo xong ' + segments.length + ' đoạn cho hàng ' + row
          });

          state.processedCount++;
          state.isProcessing = false;
          state.currentJob = null;
        },
        function onError(errMsg) {
          handleJobError(appsScriptUrl, row, errMsg);
        }
      );
    })
    .catch(function (err) {
      handleJobError(appsScriptUrl, row, err.message || String(err));
    });
}

// ── Process segments one by one ───────────────────────────
function processSegmentsSequentially(
  segments, index, allPcmBase64, segmentFiles,
  apiKeys, model, voice, speed, delay, folderName,
  onComplete, onError
) {
  if (index >= segments.length) {
    onComplete();
    return;
  }

  var segmentText = segments[index];
  var speedPrefix = buildSpeedPrefix(speed);
  var textToSend = speedPrefix + segmentText;

  callGeminiTTS(textToSend, apiKeys, model, voice, 0, 3, function (err, base64Pcm) {
    if (err) {
      onError('Segment ' + (index + 1) + ': ' + err);
      return;
    }

    allPcmBase64.push(base64Pcm);

    // Create individual segment WAV
    var wavDataUrl = createWavDataUrl(base64Pcm);
    var segNum = String(index + 1);
    while (segNum.length < 3) segNum = '0' + segNum;

    segmentFiles.push({
      dataUrl: wavDataUrl,
      filename: 'segment_' + segNum + '.wav',
      subfolder: folderName
    });

    // Notify popup of segment progress
    chrome.runtime.sendMessage({
      action: 'segmentProgress',
      current: index + 1,
      total: segments.length,
      folder: folderName
    }, function () {
      if (chrome.runtime.lastError) { /* popup closed – ignore */ }
    });

    // Delay then process next segment
    setTimeout(function () {
      processSegmentsSequentially(
        segments, index + 1, allPcmBase64, segmentFiles,
        apiKeys, model, voice, speed, delay, folderName,
        onComplete, onError
      );
    }, delay);
  });
}

// ── Call Gemini TTS API (with key rotation & retry) ───────
function callGeminiTTS(text, apiKeys, model, voice, keyOffset, maxRetries, callback) {
  if (maxRetries <= 0) {
    callback('Hết lượt retry – tất cả API key đều bị 429');
    return;
  }

  var keyIndex = (state.currentApiKeyIndex + keyOffset) % apiKeys.length;
  var apiKey = apiKeys[keyIndex];

  var apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    model + ':generateContent?key=' + apiKey;

  var body = {
    contents: [{
      parts: [{ text: text }]
    }],
    generationConfig: {
      response_modalities: ['AUDIO'],
      speech_config: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice
          }
        }
      }
    }
  };

  fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function (res) {
      if (res.status === 429) {
        console.warn('[TTS] 429 on key index ' + keyIndex + ' – rotating...');
        state.currentApiKeyIndex = (keyIndex + 1) % apiKeys.length;
        setTimeout(function () {
          callGeminiTTS(text, apiKeys, model, voice, keyOffset + 1, maxRetries - 1, callback);
        }, 2000);
        return null;
      }
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error('API ' + res.status + ': ' + t); });
      }
      return res.json();
    })
    .then(function (data) {
      if (data === null) return; // 429 handled above

      // Extract base64 audio
      var base64Pcm = null;
      try {
        var candidates = data.candidates || [];
        for (var c = 0; c < candidates.length; c++) {
          var parts = (candidates[c].content && candidates[c].content.parts) || [];
          for (var p = 0; p < parts.length; p++) {
            if (parts[p].inlineData && parts[p].inlineData.data) {
              base64Pcm = parts[p].inlineData.data;
              break;
            }
          }
          if (base64Pcm) break;
        }
      } catch (e) {
        callback('Parse response error: ' + e.message);
        return;
      }

      if (!base64Pcm) {
        callback('Không tìm thấy audio data trong response');
        return;
      }

      callback(null, base64Pcm);
    })
    .catch(function (err) {
      callback(err.message || String(err));
    });
}

// ── Build speed prefix ────────────────────────────────────
function buildSpeedPrefix(speed) {
  if (speed === undefined || speed === null || speed === '' || speed === 'normal') {
    return '';
  }

  var speedMap = {
    'very-slow': 'Speak very slowly: ',
    'slow': 'Speak slowly: ',
    'normal': '',
    'fast': 'Speak quickly: ',
    'very-fast': 'Speak very quickly: '
  };

  if (speedMap.hasOwnProperty(speed)) {
    return speedMap[speed];
  }

  // Numeric speed value
  var numSpeed = parseFloat(speed);
  if (!isNaN(numSpeed)) {
    return 'Speak at ' + numSpeed + 'x speed: ';
  }

  return '';
}

// ── WAV helpers ───────────────────────────────────────────
function createWavBlob(base64Pcm) {
  var raw = atob(base64Pcm);
  var pcmLength = raw.length;
  var buffer = new ArrayBuffer(44 + pcmLength);
  var view = new DataView(buffer);
  var uint8 = new Uint8Array(buffer);

  var sampleRate = 24000;
  var numChannels = 1;
  var bitsPerSample = 16;
  var byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  var blockAlign = numChannels * (bitsPerSample / 8);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);            // SubChunk1Size (PCM = 16)
  view.setUint16(20, 1, true);             // AudioFormat (PCM = 1)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, pcmLength, true);

  // PCM data
  for (var i = 0; i < pcmLength; i++) {
    uint8[44 + i] = raw.charCodeAt(i);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function createWavDataUrl(base64Pcm) {
  var raw = atob(base64Pcm);
  var pcmLength = raw.length;
  var buffer = new ArrayBuffer(44 + pcmLength);
  var view = new DataView(buffer);
  var uint8 = new Uint8Array(buffer);

  var sampleRate = 24000;
  var numChannels = 1;
  var bitsPerSample = 16;
  var byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  var blockAlign = numChannels * (bitsPerSample / 8);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmLength, true);

  for (var i = 0; i < pcmLength; i++) {
    uint8[44 + i] = raw.charCodeAt(i);
  }

  // Convert to base64 data URL
  var binary = '';
  for (var j = 0; j < uint8.length; j++) {
    binary += String.fromCharCode(uint8[j]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

function writeString(view, offset, str) {
  for (var i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ── Concatenate base64 PCM segments ───────────────────────
function concatenateBase64Pcm(base64Array) {
  var allBytes = [];
  for (var i = 0; i < base64Array.length; i++) {
    var raw = atob(base64Array[i]);
    for (var j = 0; j < raw.length; j++) {
      allBytes.push(raw.charCodeAt(j));
    }
  }
  // Convert back to base64
  var binaryStr = '';
  for (var k = 0; k < allBytes.length; k++) {
    binaryStr += String.fromCharCode(allBytes[k]);
  }
  return btoa(binaryStr);
}

// ── Extract Google Doc ID ─────────────────────────────────
function extractDocId(url) {
  if (!url) return null;
  var match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ── Sanitize folder name ──────────────────────────────────
function sanitizeFolderName(row, note) {
  var name = 'row_' + row;
  if (note) {
    var clean = note.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1E00-\u1EFF]/g, '');
    if (clean.length > 0) {
      name = name + '_' + clean.substring(0, 50);
    }
  }
  return name;
}

// ── Sheet status update ───────────────────────────────────
function updateSheetStatus(appsScriptUrl, row, status) {
  var url = appsScriptUrl +
    '?action=update_status&row=' + encodeURIComponent(row) +
    '&status=' + encodeURIComponent(status);

  fetch(url, { redirect: 'follow' })
    .then(function (res) { return res.text(); })
    .then(function (body) {
      console.log('[TTS] Status updated → row ' + row + ': ' + status);
    })
    .catch(function (err) {
      console.error('[TTS] Status update failed:', err);
    });
}

// ── Error handler for job ─────────────────────────────────
function handleJobError(appsScriptUrl, row, errMsg) {
  console.error('[TTS] Job error row ' + row + ':', errMsg);

  updateSheetStatus(appsScriptUrl, row, 'Lỗi');

  chrome.notifications.create('job-error-' + row, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Gemini TTS – Lỗi!',
    message: 'Hàng ' + row + ': ' + errMsg
  });

  state.errorCount++;
  state.isProcessing = false;
  state.currentJob = null;
}

// ── Store pending files in storage for popup retrieval ────
function storePendingFiles(files) {
  chrome.storage.local.get(['pendingFiles'], function (data) {
    var pending = data.pendingFiles || [];
    for (var i = 0; i < files.length; i++) {
      pending.push(files[i]);
    }
    chrome.storage.local.set({ pendingFiles: pending }, function () {
      console.log('[TTS] Stored ' + files.length + ' files for popup to save.');
    });
  });
}

// ── Get next API key (rotate) ─────────────────────────────
function getNextApiKey(settings) {
  var keys = settings.apiKeys || [];
  if (keys.length === 0) return null;
  state.currentApiKeyIndex = (state.currentApiKeyIndex + 1) % keys.length;
  return keys[state.currentApiKeyIndex];
}

console.log('[TTS] Service worker loaded.');
