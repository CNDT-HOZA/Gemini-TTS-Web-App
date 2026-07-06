(function () {
  "use strict";

  // ===== DOM Elements =====
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
  var folderName = document.getElementById("folderName");
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
    request.onsuccess = function (e) {
      callback(null, e.target.result);
    };
    request.onerror = function (e) {
      callback(e.target.error, null);
    };
  }

  function saveDirHandle(handle, callback) {
    openDB(function (err, db) {
      if (err) {
        if (callback) callback(err);
        return;
      }
      var tx = db.transaction(DB_STORE, "readwrite");
      var store = tx.objectStore(DB_STORE);
      store.put(handle, "saveDirHandle");
      tx.oncomplete = function () {
        if (callback) callback(null);
      };
      tx.onerror = function (e) {
        if (callback) callback(e.target.error);
      };
    });
  }

  function getDirHandle(callback) {
    openDB(function (err, db) {
      if (err) {
        callback(err, null);
        return;
      }
      var tx = db.transaction(DB_STORE, "readonly");
      var store = tx.objectStore(DB_STORE);
      var request = store.get("saveDirHandle");
      request.onsuccess = function (e) {
        callback(null, e.target.result || null);
      };
      request.onerror = function (e) {
        callback(e.target.error, null);
      };
    });
  }

  // ===== File System Access API =====
  function saveFilesToDir(dirHandle, subfolder, files, callback) {
    var targetDir;

    function getOrCreateSubfolder(parent, folderName, cb) {
      parent
        .getDirectoryHandle(folderName, { create: true })
        .then(function (dir) {
          cb(null, dir);
        })
        .catch(function (err) {
          cb(err, null);
        });
    }

    function writeFiles(dir, fileList, index) {
      if (index >= fileList.length) {
        if (callback) callback(null);
        return;
      }
      var file = fileList[index];
      dir
        .getFileHandle(file.name, { create: true })
        .then(function (fileHandle) {
          return fileHandle.createWritable();
        })
        .then(function (writable) {
          var data = file.data;
          // If data is a base64 string, convert to ArrayBuffer
          if (typeof data === "string") {
            var binaryString = atob(data);
            var bytes = new Uint8Array(binaryString.length);
            for (var i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            data = bytes.buffer;
          }
          return writable.write(data).then(function () {
            return writable.close();
          });
        })
        .then(function () {
          writeFiles(dir, fileList, index + 1);
        })
        .catch(function (err) {
          if (callback) callback(err);
        });
    }

    if (subfolder) {
      getOrCreateSubfolder(dirHandle, subfolder, function (err, dir) {
        if (err) {
          if (callback) callback(err);
          return;
        }
        writeFiles(dir, files, 0);
      });
    } else {
      writeFiles(dirHandle, files, 0);
    }
  }

  // ===== Toast =====
  var toastTimeout = null;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2500);
  }

  // ===== Time Formatting =====
  function formatTime(date) {
    if (!date) return "--:--:--";
    if (typeof date === "string" || typeof date === "number") {
      date = new Date(date);
    }
    var h = date.getHours();
    var m = date.getMinutes();
    var s = date.getSeconds();
    return (
      (h < 10 ? "0" : "") +
      h +
      ":" +
      (m < 10 ? "0" : "") +
      m +
      ":" +
      (s < 10 ? "0" : "") +
      s
    );
  }

  // ===== Status UI Update =====
  function updateStatusUI(state) {
    if (!state) return;

    // Polling status
    var isRunning = state.isPolling || false;
    if (isRunning) {
      statusDot.classList.add("active");
      statusText.textContent = "Đang quét...";
    } else {
      statusDot.classList.remove("active");
      statusText.textContent = "Đã dừng";
    }

    // Last check time
    if (state.lastCheckTime) {
      lastCheckTime.textContent =
        "Lần quét cuối: " + formatTime(state.lastCheckTime);
    }

    // Current job
    if (state.currentJob) {
      currentJob.classList.add("visible");
      currentJobInfo.textContent = state.currentJob;
    } else {
      currentJob.classList.remove("visible");
      currentJobInfo.textContent = "--";
    }

    // Stats
    if (state.processed !== undefined) {
      statProcessed.textContent = state.processed;
    }
    if (state.errors !== undefined) {
      statErrors.textContent = state.errors;
    }
  }

  // ===== Log Entries =====
  function addLogEntry(entry) {
    logEntries.unshift(entry);
    if (logEntries.length > 10) {
      logEntries = logEntries.slice(0, 10);
    }
    renderLog();
  }

  function renderLog() {
    if (logEntries.length === 0) {
      logEmpty.style.display = "block";
      // Remove all log-item elements
      var items = logList.querySelectorAll(".log-item");
      for (var i = 0; i < items.length; i++) {
        items[i].parentNode.removeChild(items[i]);
      }
      return;
    }

    logEmpty.style.display = "none";
    // Clear existing items
    var existingItems = logList.querySelectorAll(".log-item");
    for (var i = 0; i < existingItems.length; i++) {
      existingItems[i].parentNode.removeChild(existingItems[i]);
    }

    for (var j = 0; j < logEntries.length; j++) {
      var e = logEntries[j];
      var item = document.createElement("div");
      item.className = "log-item";

      var stt = document.createElement("span");
      stt.className = "log-stt";
      stt.textContent = e.stt || j + 1;

      var badge = document.createElement("span");
      badge.className = "log-badge";
      var statusLower = (e.status || "").toLowerCase();
      if (statusLower === "done") {
        badge.className += " badge-done";
        badge.textContent = "Done";
      } else if (statusLower === "error") {
        badge.className += " badge-error";
        badge.textContent = "Error";
      } else if (statusLower === "processing") {
        badge.className += " badge-processing";
        badge.textContent = "Process";
      } else {
        badge.className += " badge-run";
        badge.textContent = statusLower || "Run";
      }

      var note = document.createElement("span");
      note.className = "log-note";
      note.textContent = e.note || "";
      note.title = e.note || "";

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

  // ===== Load Settings =====
  function loadSettings() {
    chrome.storage.local.get(
      [
        "apiKeys",
        "appsScriptUrl",
        "model",
        "voice",
        "delay",
        "sheetUrl",
        "recentLog",
      ],
      function (data) {
        if (data.apiKeys) {
          inputApiKeys.value = data.apiKeys;
        }
        if (data.appsScriptUrl) {
          inputAppsScriptUrl.value = data.appsScriptUrl;
        }
        if (data.model) {
          // Add option if not present
          var found = false;
          for (var i = 0; i < selectModel.options.length; i++) {
            if (selectModel.options[i].value === data.model) {
              found = true;
              break;
            }
          }
          if (!found && data.model) {
            var opt = document.createElement("option");
            opt.value = data.model;
            opt.textContent = data.model;
            selectModel.appendChild(opt);
          }
          selectModel.value = data.model;
        }
        if (data.voice) {
          selectVoice.value = data.voice;
        }
        if (data.delay !== undefined) {
          inputDelay.value = data.delay;
        }
        if (data.sheetUrl) {
          linkSheet.href = data.sheetUrl;
        }
        if (data.recentLog && Array.isArray(data.recentLog)) {
          logEntries = data.recentLog.slice(0, 10);
          renderLog();
        }
      }
    );
  }

  // ===== Save Settings =====
  function saveSettings() {
    var settings = {
      apiKeys: inputApiKeys.value.trim(),
      appsScriptUrl: inputAppsScriptUrl.value.trim(),
      model: selectModel.value,
      voice: selectVoice.value,
      delay: parseInt(inputDelay.value, 10) || 500,
    };
    chrome.storage.local.set(settings, function () {
      showToast("✅ Đã lưu cài đặt");
      // Notify background of settings change
      chrome.runtime.sendMessage({ action: "settingsUpdated", settings: settings });
    });
  }

  // ===== Request Status from Background =====
  function requestStatus() {
    chrome.runtime.sendMessage({ action: "getStatus" }, function (response) {
      if (chrome.runtime.lastError) {
        // Background may not be ready
        return;
      }
      if (response && response.state) {
        updateStatusUI(response.state);
      }
    });
  }

  // ===== Verify Stored Directory Handle =====
  function verifyStoredHandle() {
    getDirHandle(function (err, handle) {
      if (err || !handle) {
        folderName.textContent = "Chưa chọn";
        btnFolder.classList.remove("has-folder");
        return;
      }

      handle
        .queryPermission({ mode: "readwrite" })
        .then(function (perm) {
          if (perm === "granted") {
            folderName.textContent = handle.name;
            btnFolder.classList.add("has-folder");
          } else {
            folderName.textContent = "Chưa chọn";
            btnFolder.classList.remove("has-folder");
          }
        })
        .catch(function () {
          folderName.textContent = "Chưa chọn";
          btnFolder.classList.remove("has-folder");
        });
    });
  }

  // ===== Event Handlers =====

  // Start polling
  btnStart.addEventListener("click", function () {
    chrome.runtime.sendMessage({ action: "startPolling" }, function (response) {
      if (chrome.runtime.lastError) return;
      showToast("▶ Đã bắt đầu quét");
      requestStatus();
    });
  });

  // Stop polling
  btnStop.addEventListener("click", function () {
    chrome.runtime.sendMessage({ action: "stopPolling" }, function (response) {
      if (chrome.runtime.lastError) return;
      showToast("⏹ Đã dừng quét");
      requestStatus();
    });
  });

  // Choose directory
  btnFolder.addEventListener("click", function () {
    if (typeof window.showDirectoryPicker !== "function") {
      showToast("❌ Trình duyệt không hỗ trợ chọn thư mục");
      return;
    }
    window
      .showDirectoryPicker({ mode: "readwrite" })
      .then(function (handle) {
        saveDirHandle(handle, function (err) {
          if (err) {
            showToast("❌ Lỗi lưu thư mục");
            return;
          }
          folderName.textContent = handle.name;
          btnFolder.classList.add("has-folder");
          showToast("📁 Đã chọn: " + handle.name);
        });
      })
      .catch(function (err) {
        // User cancelled or error
        if (err.name !== "AbortError") {
          showToast("❌ Lỗi chọn thư mục");
        }
      });
  });

  // Reload sheet
  btnReload.addEventListener("click", function () {
    chrome.runtime.sendMessage(
      { action: "refreshSheet" },
      function (response) {
        if (chrome.runtime.lastError) return;
        showToast("🔄 Đang tải lại Sheet...");
      }
    );
  });

  // Settings toggle
  settingsToggle.addEventListener("click", function () {
    var isOpen = settingsBody.classList.contains("open");
    if (isOpen) {
      settingsBody.classList.remove("open");
      settingsChevron.classList.remove("open");
    } else {
      settingsBody.classList.add("open");
      settingsChevron.classList.add("open");
    }
  });

  // Load models button
  btnLoadModels.addEventListener("click", function () {
    chrome.runtime.sendMessage(
      { action: "loadModels" },
      function (response) {
        if (chrome.runtime.lastError) return;
        if (response && response.models && Array.isArray(response.models)) {
          // Clear existing options except default
          selectModel.innerHTML = '<option value="">-- Chọn model --</option>';
          for (var i = 0; i < response.models.length; i++) {
            var opt = document.createElement("option");
            opt.value = response.models[i];
            opt.textContent = response.models[i];
            selectModel.appendChild(opt);
          }
          showToast("✅ Đã tải " + response.models.length + " model");
        } else {
          showToast("⚠️ Không tải được danh sách model");
        }
      }
    );
  });

  // Save settings
  btnSave.addEventListener("click", function () {
    saveSettings();
  });

  // ===== Listen for Messages from Background =====
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.action) return;

    switch (message.action) {
      case "statusUpdate":
        if (message.state) {
          updateStatusUI(message.state);
        }
        break;

      case "saveFiles":
        getDirHandle(function (err, handle) {
          if (err || !handle) {
            showToast("❌ Chưa chọn thư mục lưu");
            if (sendResponse) sendResponse({ success: false, error: "No directory handle" });
            return;
          }
          // Verify permission
          handle
            .requestPermission({ mode: "readwrite" })
            .then(function (perm) {
              if (perm !== "granted") {
                showToast("❌ Không có quyền ghi thư mục");
                if (sendResponse)
                  sendResponse({ success: false, error: "Permission denied" });
                return;
              }
              var files = message.files || [];
              var subfolder = message.subfolder || "";
              saveFilesToDir(handle, subfolder, files, function (writeErr) {
                if (writeErr) {
                  showToast("❌ Lỗi ghi file: " + writeErr.message);
                  if (sendResponse)
                    sendResponse({ success: false, error: writeErr.message });
                } else {
                  showToast("✅ Đã lưu " + files.length + " file");
                  if (sendResponse) sendResponse({ success: true });
                }
              });
            })
            .catch(function (permErr) {
              showToast("❌ Lỗi quyền truy cập thư mục");
              if (sendResponse)
                sendResponse({ success: false, error: permErr.message });
            });
        });
        return true; // Keep sendResponse channel open for async

      case "jobComplete":
        if (message.job) {
          addLogEntry({
            stt: message.job.stt || "",
            status: "done",
            note: message.job.note || "Hoàn thành",
            time: message.job.time || new Date(),
          });
          // Persist log
          chrome.storage.local.set({ recentLog: logEntries });
        }
        break;

      case "jobError":
        addLogEntry({
          stt: message.job ? message.job.stt : "",
          status: "error",
          note: message.error || "Lỗi không xác định",
          time: message.job ? message.job.time || new Date() : new Date(),
        });
        // Persist log
        chrome.storage.local.set({ recentLog: logEntries });
        break;

      default:
        break;
    }
  });

  // ===== Initialization =====
  document.addEventListener("DOMContentLoaded", function () {
    loadSettings();
    requestStatus();
    verifyStoredHandle();

    // Poll status every 2 seconds
    statusInterval = setInterval(function () {
      requestStatus();
    }, 2000);
  });

  // Clean up interval when popup closes
  window.addEventListener("unload", function () {
    if (statusInterval) {
      clearInterval(statusInterval);
    }
  });
})();
