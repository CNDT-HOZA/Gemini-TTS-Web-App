(function () {
  "use strict";

  var DB_NAME = "gemini-tts-ext";
  var DB_STORE = "handles";
  var DB_VERSION = 1;
  var statusInterval = null;
  var logEntries = [];

  // ===== IndexedDB Helpers =====
  function openDB(callback) {
    var request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = function (e) { callback(null, e.target.result); };
    request.onerror = function (e) { callback(e.target.error, null); };
  }

  function saveDirHandle(handle, callback) {
    openDB(function (err, db) {
      if (err) { if (callback) callback(err); return; }
      var tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(handle, "saveDirHandle");
      tx.oncomplete = function () { if (callback) callback(null); };
      tx.onerror = function (e) { if (callback) callback(e.target.error); };
    });
  }

  function getDirHandle(callback) {
    openDB(function (err, db) {
      if (err) { callback(err, null); return; }
      var tx = db.transaction(DB_STORE, "readonly");
      var req = tx.objectStore(DB_STORE).get("saveDirHandle");
      req.onsuccess = function (e) { callback(null, e.target.result || null); };
      req.onerror = function (e) { callback(e.target.error, null); };
    });
  }

  // ===== File System Access API =====
  function saveFilesToDir(dirHandle, subfolder, files, callback) {
    function writeFiles(dir, list, idx) {
      if (idx >= list.length) { if (callback) callback(null); return; }
      var f = list[idx];
      dir.getFileHandle(f.name, { create: true })
        .then(function (fh) { return fh.createWritable(); })
        .then(function (w) {
          var data = f.data;
          if (typeof data === "string") {
            var bin = atob(data);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            data = bytes.buffer;
          }
          return w.write(data).then(function () { return w.close(); });
        })
        .then(function () { writeFiles(dir, list, idx + 1); })
        .catch(function (err) { if (callback) callback(err); });
    }
    if (subfolder) {
      dirHandle.getDirectoryHandle(subfolder, { create: true })
        .then(function (dir) { writeFiles(dir, files, 0); })
        .catch(function (err) { if (callback) callback(err); });
    } else {
      writeFiles(dirHandle, files, 0);
    }
  }

  // ===== Time Formatting =====
  function formatTime(date) {
    if (!date) return "--:--:--";
    if (typeof date === "string" || typeof date === "number") date = new Date(date);
    var h = date.getHours();
    var m = date.getMinutes();
    var s = date.getSeconds();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ===== DOMContentLoaded =====
  document.addEventListener("DOMContentLoaded", function () {
    var statusDot = document.getElementById("statusDot");
    var statusText = document.getElementById("statusText");
    var lastCheckTime = document.getElementById("lastCheckTime");
    var currentJob = document.getElementById("currentJob");
    var currentJobInfo = document.getElementById("currentJobInfo");
    var statProcessed = document.getElementById("statProcessed");
    var statErrors = document.getElementById("statErrors");
    var btnStart = document.getElementById("btnStart");
    var btnStop = document.getElementById("btnStop");
    var btnFolder = document.getElementById("btnFolder");
    var folderNameEl = document.getElementById("folderName");
    var btnReload = document.getElementById("btnReload");
    var settingsToggle = document.getElementById("settingsToggle");
    var settingsChevron = document.getElementById("settingsChevron");
    var settingsBody = document.getElementById("settingsBody");
    var inputApiKeys = document.getElementById("inputApiKeys");
    var inputAppsScriptUrl = document.getElementById("inputAppsScriptUrl");
    var selectModel = document.getElementById("selectModel");
    var btnLoadModels = document.getElementById("btnLoadModels");
    var selectVoice = document.getElementById("selectVoice");
    var inputDelay = document.getElementById("inputDelay");
    var btnSave = document.getElementById("btnSave");
    var logList = document.getElementById("logList");
    var logEmpty = document.getElementById("logEmpty");
    var linkSheet = document.getElementById("linkSheet");
    var toastEl = document.getElementById("toast");

    // Toast
    var toastTimeout = null;
    function showToast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(function () { toastEl.classList.remove("show"); }, 2500);
    }

    // Status UI
    function updateStatusUI(st) {
      if (!st) return;
      if (st.isPolling) {
        statusDot.classList.add("active");
        statusText.textContent = st.isProcessing ? "Đang xử lý..." : "Đang quét...";
      } else {
        statusDot.classList.remove("active");
        statusText.textContent = "Đã dừng";
      }
      if (st.lastCheckTime) lastCheckTime.textContent = "Lần quét cuối: " + formatTime(st.lastCheckTime);
      if (st.currentJob) {
        currentJob.classList.add("visible");
        currentJobInfo.textContent = st.currentJob;
      } else {
        currentJob.classList.remove("visible");
      }
      if (st.processed !== undefined) statProcessed.textContent = st.processed;
      if (st.errors !== undefined) statErrors.textContent = st.errors;
    }

    // Log
    function addLogEntry(entry) {
      logEntries.unshift(entry);
      if (logEntries.length > 10) logEntries = logEntries.slice(0, 10);
      renderLog();
    }

    function renderLog() {
      var items = logList.querySelectorAll(".log-item");
      for (var i = 0; i < items.length; i++) items[i].remove();
      if (logEntries.length === 0) { logEmpty.style.display = "block"; return; }
      logEmpty.style.display = "none";
      for (var j = 0; j < logEntries.length; j++) {
        var e = logEntries[j];
        var item = document.createElement("div");
        item.className = "log-item";
        var stt = document.createElement("span");
        stt.className = "log-stt";
        stt.textContent = e.stt || (j + 1);
        var badge = document.createElement("span");
        var sl = (e.status || "").toLowerCase();
        badge.className = "log-badge " + (sl === "done" ? "badge-done" : sl === "error" ? "badge-error" : sl === "processing" ? "badge-processing" : "badge-run");
        badge.textContent = sl === "done" ? "Xong" : sl === "error" ? "Lỗi" : sl === "processing" ? "Đang chạy" : "Run";
        var note = document.createElement("span");
        note.className = "log-note";
        note.textContent = e.note || "";
        var time = document.createElement("span");
        time.className = "log-time";
        time.textContent = formatTime(e.time);
        item.appendChild(stt);
        item.appendChild(badge);
        item.appendChild(note);
        item.appendChild(time);
        logList.appendChild(item);
      }
    }

    // Load settings
    function loadSettings() {
      chrome.storage.local.get(["apiKeys", "appsScriptUrl", "model", "voice", "segmentDelay", "recentLog"], function (data) {
        if (data.apiKeys) inputApiKeys.value = data.apiKeys;
        if (data.appsScriptUrl) inputAppsScriptUrl.value = data.appsScriptUrl;
        if (data.model) {
          var found = false;
          for (var i = 0; i < selectModel.options.length; i++) {
            if (selectModel.options[i].value === data.model) { found = true; break; }
          }
          if (!found) {
            var opt = document.createElement("option");
            opt.value = data.model;
            opt.textContent = data.model;
            selectModel.appendChild(opt);
          }
          selectModel.value = data.model;
        }
        if (data.voice) selectVoice.value = data.voice;
        if (data.segmentDelay !== undefined) inputDelay.value = data.segmentDelay;
        if (data.recentLog && Array.isArray(data.recentLog)) {
          logEntries = data.recentLog.slice(0, 10);
          renderLog();
        }
      });
    }

    // Save settings
    function saveSettings() {
      chrome.storage.local.set({
        apiKeys: inputApiKeys.value.trim(),
        appsScriptUrl: inputAppsScriptUrl.value.trim(),
        model: selectModel.value,
        voice: selectVoice.value,
        segmentDelay: parseInt(inputDelay.value, 10) || 500
      }, function () { showToast("✅ Đã lưu cài đặt"); });
    }

    // Request status
    function requestStatus() {
      chrome.runtime.sendMessage({ action: "getStatus" }, function (res) {
        if (chrome.runtime.lastError) return;
        if (res && res.state) updateStatusUI(res.state);
      });
    }

    // Verify stored folder
    function verifyStoredHandle() {
      getDirHandle(function (err, handle) {
        if (err || !handle) { folderNameEl.textContent = "Chưa chọn"; return; }
        handle.queryPermission({ mode: "readwrite" })
          .then(function (perm) {
            if (perm === "granted") {
              folderNameEl.textContent = handle.name;
              btnFolder.classList.add("has-folder");
            } else { folderNameEl.textContent = "Chưa chọn"; }
          })
          .catch(function () { folderNameEl.textContent = "Chưa chọn"; });
      });
    }

    // ===== Event Handlers =====
    btnStart.addEventListener("click", function () {
      chrome.runtime.sendMessage({ action: "startPolling" }, function () {
        if (chrome.runtime.lastError) return;
        showToast("▶ Đã bắt đầu quét");
        requestStatus();
      });
    });

    btnStop.addEventListener("click", function () {
      chrome.runtime.sendMessage({ action: "stopPolling" }, function () {
        if (chrome.runtime.lastError) return;
        showToast("⏹ Đã dừng quét");
        requestStatus();
      });
    });

    btnFolder.addEventListener("click", function () {
      if (typeof window.showDirectoryPicker !== "function") {
        showToast("❌ Trình duyệt không hỗ trợ");
        return;
      }
      window.showDirectoryPicker({ mode: "readwrite" })
        .then(function (handle) {
          saveDirHandle(handle, function (err) {
            if (err) { showToast("❌ Lỗi lưu thư mục"); return; }
            folderNameEl.textContent = handle.name;
            btnFolder.classList.add("has-folder");
            showToast("📁 Đã chọn: " + handle.name);
          });
        })
        .catch(function (err) {
          if (err.name !== "AbortError") showToast("❌ Lỗi chọn thư mục");
        });
    });

    btnReload.addEventListener("click", function () {
      chrome.runtime.sendMessage({ action: "refreshSheet" }, function () {
        if (chrome.runtime.lastError) return;
        showToast("🔄 Đang tải lại...");
      });
    });

    settingsToggle.addEventListener("click", function () {
      settingsBody.classList.toggle("open");
      settingsChevron.classList.toggle("open");
    });

    btnLoadModels.addEventListener("click", function () {
      showToast("⏳ Đang tải models...");
      chrome.runtime.sendMessage({ action: "loadModels" }, function (response) {
        if (chrome.runtime.lastError) { showToast("❌ Lỗi kết nối"); return; }
        if (response && response.models && response.models.length > 0) {
          selectModel.innerHTML = '<option value="">-- Chọn model --</option>';
          for (var i = 0; i < response.models.length; i++) {
            var opt = document.createElement("option");
            opt.value = response.models[i];
            opt.textContent = response.models[i];
            selectModel.appendChild(opt);
          }
          showToast("✅ Đã tải " + response.models.length + " models");
        } else {
          showToast("⚠️ " + (response && response.error ? response.error : "Không tải được"));
        }
      });
    });

    btnSave.addEventListener("click", function () { saveSettings(); });

    // ===== Listen messages from background =====
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || !message.action) return;
      if (message.action === "statusUpdate" && message.state) updateStatusUI(message.state);
      if (message.action === "saveFiles") {
        getDirHandle(function (err, handle) {
          if (err || !handle) { showToast("❌ Chưa chọn thư mục lưu"); return; }
          handle.requestPermission({ mode: "readwrite" })
            .then(function (perm) {
              if (perm !== "granted") { showToast("❌ Không có quyền ghi"); return; }
              saveFilesToDir(handle, message.folder || "", message.files || [], function (writeErr) {
                if (writeErr) showToast("❌ Lỗi ghi: " + writeErr.message);
                else showToast("✅ Đã lưu " + (message.files || []).length + " file");
              });
            })
            .catch(function () { showToast("❌ Lỗi quyền thư mục"); });
        });
        return true;
      }
      if (message.action === "jobComplete" && message.job) {
        addLogEntry({ stt: message.job.row || "", status: "done", note: message.job.note || "Hoàn thành", time: new Date() });
        chrome.storage.local.set({ recentLog: logEntries });
      }
      if (message.action === "jobError") {
        addLogEntry({ stt: message.job ? message.job.row : "", status: "error", note: message.error || "Lỗi", time: new Date() });
        chrome.storage.local.set({ recentLog: logEntries });
      }
      if (message.action === "segmentProgress") {
        showToast("📝 Đoạn " + message.current + "/" + message.total);
      }
    });

    // ===== Init =====
    loadSettings();
    requestStatus();
    verifyStoredHandle();
    statusInterval = setInterval(function () { requestStatus(); }, 2000);
    window.addEventListener("unload", function () { if (statusInterval) clearInterval(statusInterval); });
  });
})();
