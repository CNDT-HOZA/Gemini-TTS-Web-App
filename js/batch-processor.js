/* batch-processor.js – Batch TTS processing from Google Sheet data */
(function () {
  "use strict";

  window.BatchProcessor = {
    _pollingTimer: null,
    _isPolling: false,
    _isProcessing: false,
    _abortController: null,
    _onStatusChange: null,
    _lastCheck: null,
    _currentJob: null,
    _lastError: null,

    /* ───────── public api ───────── */

    setStatusCallback: function (fn) {
      this._onStatusChange = fn;
    },

    startPolling: function (intervalMs) {
      var self = this;
      var interval = intervalMs || 20000;

      if (this._isPolling) return;

      this._isPolling = true;
      this._checkForJobs();
      this._pollingTimer = setInterval(function () {
        self._checkForJobs();
      }, interval);

      this._notifyStatus();
    },

    stopPolling: function () {
      if (this._pollingTimer) {
        clearInterval(this._pollingTimer);
        this._pollingTimer = null;
      }
      this._isPolling = false;

      if (this._isProcessing && this._abortController) {
        this._abortController.abort();
      }

      this._notifyStatus();
    },

    /* ───────── internal ───────── */

    _checkForJobs: async function () {
      if (this._isProcessing) return;

      try {
        this._lastCheck = new Date().toLocaleTimeString();
        this._notifyStatus();

        var jobs = await window.SheetManager.fetchPendingJobs();
        if (jobs && jobs.length > 0) {
          await this._processJob(jobs[0]);
        }
      } catch (err) {
        this._lastError = err.message || String(err);
        this._notifyStatus();
      }
    },

    _processJob: async function (job) {
      var self = this;

      this._isProcessing = true;
      this._currentJob = job;
      this._lastError = null;
      this._abortController = new AbortController();
      this._notifyStatus();

      try {
        /* (b) mark as running */
        await window.SheetManager.updateJobStatus(job.row, "Đang chạy");

        /* (c) fetch doc content */
        if (!job.linkDoc) {
          throw new Error("linkDoc trống – bỏ qua job dòng " + job.row);
        }
        var docText = await window.TextParser.fetchGoogleDoc(job.linkDoc);

        /* (d) parse into segments */
        var segments = window.TextParser.parseText(docText);
        if (!segments || segments.length === 0) {
          throw new Error("Không tìm thấy đoạn văn nào trong tài liệu");
        }

        /* (e) build settings */
        var allSettings = window.SettingsManager.getAll();
        var settings = {};
        var key;
        for (key in allSettings) {
          if (allSettings.hasOwnProperty(key)) {
            settings[key] = allSettings[key];
          }
        }
        if (job.voice) {
          settings.voice = job.voice;
        }
        if (job.speed) {
          var parsed = parseFloat(job.speed);
          if (!isNaN(parsed)) {
            settings.speed = parsed;
          }
        }

        var delayMs = settings.delay || 500;
        var wavBlobs = [];
        var allBase64Pcm = [];

        /* (f-g) convert each segment */
        for (var i = 0; i < segments.length; i++) {
          /* check abort */
          if (self._abortController.signal.aborted) {
            throw new Error("Đã huỷ bởi người dùng");
          }

          var result = await window.TTSEngine._convertWithRetry(
            segments[i].text,
            settings,
            self._abortController.signal
          );

          allBase64Pcm.push(result.base64Pcm);

          var wavBlob = window.AudioManager.createWavBlob(result.base64Pcm);
          wavBlobs.push(wavBlob);

          /* delay between segments (skip after last) */
          if (i < segments.length - 1) {
            await self._delay(delayMs);
          }
        }

        /* (h) create ZIP */
        var zip = new window.JSZip();
        var folderName = self._sanitizeFolderName(job.stt, job.note);
        var folder = zip.folder(folderName);

        for (var j = 0; j < wavBlobs.length; j++) {
          var padded = self._padNumber(j + 1, 3);
          folder.file(padded + ".wav", wavBlobs[j]);
        }

        /* merged full.wav – concatenate raw PCM base64 strings */
        var mergedBase64 = allBase64Pcm.join("");
        var fullWavBlob = window.AudioManager.createWavBlob(mergedBase64);
        folder.file("full.wav", fullWavBlob);

        /* (i) generate ZIP blob */
        var zipBlob = await zip.generateAsync({ type: "blob" });

        /* (j) trigger download */
        self._triggerDownload(zipBlob, folderName + ".zip");

        /* (k) mark as done */
        await window.SheetManager.updateJobStatus(job.row, "Đã Xong");
      } catch (err) {
        /* (m) handle error */
        self._lastError = err.message || String(err);
        try {
          await window.SheetManager.updateJobStatus(job.row, "Lỗi");
        } catch (_ignored) {
          /* swallow secondary error */
        }
        window.UIController.showToast(
          "Lỗi batch: " + self._lastError,
          "error",
          5000
        );
      } finally {
        /* (l) reset state */
        self._isProcessing = false;
        self._currentJob = null;
        self._abortController = null;
        self._notifyStatus();
      }
    },

    /* ───────── helpers ───────── */

    _sanitizeFolderName: function (stt, note) {
      var raw = (stt || "") + "_" + (note || "");
      var sanitized = raw
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, "")
        .replace(/_{2,}/g, "_")
        .replace(/^_|_$/g, "");
      return sanitized || "batch";
    },

    _triggerDownload: function (blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    _notifyStatus: function () {
      if (typeof this._onStatusChange === "function") {
        this._onStatusChange({
          isPolling: this._isPolling,
          isProcessing: this._isProcessing,
          currentJob: this._currentJob,
          lastCheck: this._lastCheck,
          error: this._lastError
        });
      }
    },

    _padNumber: function (num, digits) {
      var s = String(num);
      while (s.length < digits) {
        s = "0" + s;
      }
      return s;
    },

    _delay: function (ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    }
  };
})();
