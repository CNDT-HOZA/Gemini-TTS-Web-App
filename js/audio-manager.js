/**
 * Gemini Voice Studio - Audio Manager
 * Handles WAV creation, MP3 encoding, audio merging, playback, and downloads.
 */
window.AudioManager = {
  SAMPLE_RATE: 24000,
  NUM_CHANNELS: 1,
  BITS_PER_SAMPLE: 16,

  _currentAudio: null,
  _audioElements: {},

  /**
   * Create a WAV Blob from base64-encoded PCM data.
   * Adds a proper 44-byte WAV header (RIFF, fmt, data chunks).
   * PCM format: 16-bit signed little-endian, 24kHz, mono.
   * @param {string} base64Pcm - Base64-encoded raw PCM data.
   * @returns {Blob} WAV audio blob.
   */
  createWavBlob(base64Pcm) {
    var binaryString = atob(base64Pcm);
    var pcmBytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
      pcmBytes[i] = binaryString.charCodeAt(i);
    }

    var dataLength = pcmBytes.length;
    var buffer = new ArrayBuffer(44 + dataLength);
    var view = new DataView(buffer);

    // RIFF header
    this._writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this._writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    this._writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);                          // Subchunk1Size (PCM = 16)
    view.setUint16(20, 1, true);                            // AudioFormat (PCM = 1)
    view.setUint16(22, this.NUM_CHANNELS, true);            // NumChannels
    view.setUint32(24, this.SAMPLE_RATE, true);             // SampleRate
    view.setUint32(28, this.SAMPLE_RATE * this.NUM_CHANNELS * this.BITS_PER_SAMPLE / 8, true); // ByteRate
    view.setUint16(32, this.NUM_CHANNELS * this.BITS_PER_SAMPLE / 8, true); // BlockAlign
    view.setUint16(34, this.BITS_PER_SAMPLE, true);         // BitsPerSample

    // data sub-chunk
    this._writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // PCM data
    new Uint8Array(buffer, 44).set(pcmBytes);

    return new Blob([buffer], { type: 'audio/wav' });
  },

  /**
   * Write an ASCII string into a DataView at a given offset.
   * @param {DataView} view
   * @param {number} offset
   * @param {string} string
   * @private
   */
  _writeString(view, offset, string) {
    for (var i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  },

  /**
   * Convert a WAV Blob to an MP3 Blob using lamejs.
   * @param {Blob} wavBlob - A WAV audio blob.
   * @returns {Promise<Blob>} MP3 audio blob.
   * @throws {Error} If lamejs is not loaded.
   */
  async convertToMp3(wavBlob) {
    if (!this.isMp3Available()) {
      throw new Error('Thư viện MP3 chưa được tải. Vui lòng sử dụng định dạng WAV.');
    }

    var arrayBuffer = await wavBlob.arrayBuffer();
    var pcmData = new Int16Array(arrayBuffer, 44); // skip 44-byte WAV header

    var mp3Encoder = new lamejs.Mp3Encoder(1, this.SAMPLE_RATE, 128); // mono, 24kHz, 128kbps
    var mp3Buffers = [];
    var sampleBlockSize = 1152;

    for (var i = 0; i < pcmData.length; i += sampleBlockSize) {
      var chunk = pcmData.subarray(i, Math.min(i + sampleBlockSize, pcmData.length));
      var mp3buf = mp3Encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        mp3Buffers.push(mp3buf);
      }
    }

    var last = mp3Encoder.flush();
    if (last.length > 0) {
      mp3Buffers.push(last);
    }

    return new Blob(mp3Buffers, { type: 'audio/mp3' });
  },

  /**
   * Check if MP3 encoding is available (lamejs loaded).
   * @returns {boolean}
   */
  isMp3Available() {
    return typeof lamejs !== 'undefined' && lamejs && typeof lamejs.Mp3Encoder === 'function';
  },

  /**
   * Merge multiple base64 PCM strings into one WAV blob.
   * Concatenates the raw PCM data, then wraps with a single WAV header.
   * @param {string[]} base64PcmArray - Array of base64-encoded PCM strings.
   * @returns {Blob} Merged WAV blob.
   */
  mergeSegments(base64PcmArray) {
    if (!base64PcmArray || base64PcmArray.length === 0) {
      return this.createWavBlob('');
    }

    // Decode all PCM data
    var allPcmChunks = [];
    var totalLength = 0;

    for (var i = 0; i < base64PcmArray.length; i++) {
      var binaryString = atob(base64PcmArray[i]);
      var pcmBytes = new Uint8Array(binaryString.length);
      for (var j = 0; j < binaryString.length; j++) {
        pcmBytes[j] = binaryString.charCodeAt(j);
      }
      allPcmChunks.push(pcmBytes);
      totalLength += pcmBytes.length;
    }

    // Concatenate all PCM data
    var mergedPcm = new Uint8Array(totalLength);
    var offset = 0;
    for (var k = 0; k < allPcmChunks.length; k++) {
      mergedPcm.set(allPcmChunks[k], offset);
      offset += allPcmChunks[k].length;
    }

    // Build WAV with merged PCM
    var dataLength = mergedPcm.length;
    var buffer = new ArrayBuffer(44 + dataLength);
    var view = new DataView(buffer);

    this._writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this._writeString(view, 8, 'WAVE');
    this._writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, this.NUM_CHANNELS, true);
    view.setUint32(24, this.SAMPLE_RATE, true);
    view.setUint32(28, this.SAMPLE_RATE * this.NUM_CHANNELS * this.BITS_PER_SAMPLE / 8, true);
    view.setUint16(32, this.NUM_CHANNELS * this.BITS_PER_SAMPLE / 8, true);
    view.setUint16(34, this.BITS_PER_SAMPLE, true);
    this._writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);
    new Uint8Array(buffer, 44).set(mergedPcm);

    return new Blob([buffer], { type: 'audio/wav' });
  },

  /**
   * Merge segments and convert to the specified format.
   * @param {string[]} base64PcmArray - Array of base64-encoded PCM strings.
   * @param {string} format - Output format ('wav' or 'mp3').
   * @returns {Promise<Blob>}
   */
  async mergeAndConvert(base64PcmArray, format) {
    var wavBlob = this.mergeSegments(base64PcmArray);

    if (format === 'mp3') {
      return await this.convertToMp3(wavBlob);
    }

    return wavBlob;
  },

  /**
   * Play an audio blob. Stops any currently playing audio first.
   * @param {Blob} blob - The audio blob to play.
   * @param {number|string} segmentId - Segment identifier for tracking.
   * @returns {HTMLAudioElement}
   */
  play(blob, segmentId) {
    // Stop currently playing audio for this segment if any
    this.pause(segmentId);

    var url = URL.createObjectURL(blob);
    var audio = new Audio(url);

    // Apply current volume
    var volume = 80;
    if (window.SettingsManager) {
      volume = window.SettingsManager.get('volume');
    }
    audio.volume = Math.max(0, Math.min(1, volume / 100));

    // Track the audio element
    this._audioElements[segmentId] = audio;
    this._currentAudio = audio;

    // Clean up object URL when done
    audio.addEventListener('ended', function () {
      URL.revokeObjectURL(url);
    }, { once: true });

    audio.play().catch(function (err) {
      console.error('AudioManager: Playback failed:', err);
    });

    return audio;
  },

  /**
   * Pause audio for a specific segment.
   * @param {number|string} segmentId
   */
  pause(segmentId) {
    var audio = this._audioElements[segmentId];
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  },

  /**
   * Stop all currently playing audio.
   */
  stopAll() {
    var ids = Object.keys(this._audioElements);
    for (var i = 0; i < ids.length; i++) {
      var audio = this._audioElements[ids[i]];
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
    this._audioElements = {};
    this._currentAudio = null;
  },

  /**
   * Set volume for all tracked audio elements (0–100).
   * @param {number} volume
   */
  setVolume(volume) {
    var normalizedVolume = Math.max(0, Math.min(1, volume / 100));
    var ids = Object.keys(this._audioElements);
    for (var i = 0; i < ids.length; i++) {
      var audio = this._audioElements[ids[i]];
      if (audio) {
        audio.volume = normalizedVolume;
      }
    }
  },

  /**
   * Download a blob as a file.
   * Creates a temporary anchor element and triggers a click.
   * @param {Blob} blob - The blob to download.
   * @param {string} filename - The desired filename.
   */
  download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke after a short delay to ensure the download starts
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  },

  /**
   * Download all segments merged into one file.
   * @param {string[]} base64PcmArray - Array of base64 PCM strings.
   * @param {string} filename - The desired filename.
   * @param {string} format - Output format ('wav' or 'mp3').
   */
  async downloadAll(base64PcmArray, filename, format) {
    var blob = await this.mergeAndConvert(base64PcmArray, format);
    this.download(blob, filename);
  },

  /**
   * Convert a single segment to the specified format.
   * @param {string} base64Pcm - Base64-encoded PCM data.
   * @param {string} format - Output format ('wav' or 'mp3').
   * @returns {Promise<Blob>}
   */
  async getSegmentBlob(base64Pcm, format) {
    var wavBlob = this.createWavBlob(base64Pcm);

    if (format === 'mp3') {
      return await this.convertToMp3(wavBlob);
    }

    return wavBlob;
  },

  /**
   * Get the duration of audio in seconds from base64 PCM data.
   * @param {string} base64Pcm - Base64-encoded PCM data.
   * @returns {number} Duration in seconds.
   */
  getDuration(base64Pcm) {
    var byteLength = atob(base64Pcm).length;
    var bytesPerSecond = this.SAMPLE_RATE * this.NUM_CHANNELS * (this.BITS_PER_SAMPLE / 8);
    return byteLength / bytesPerSecond;
  },

  /**
   * Format a duration in seconds as mm:ss.
   * @param {number} seconds
   * @returns {string}
   */
  formatDuration(seconds) {
    var totalSeconds = Math.round(seconds);
    var mins = Math.floor(totalSeconds / 60);
    var secs = totalSeconds % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }
};
