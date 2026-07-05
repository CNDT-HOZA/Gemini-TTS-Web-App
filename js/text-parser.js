/**
 * Gemini Voice Studio - Text Parser
 * Handles text parsing, splitting, file reading, and HTML paste processing.
 */
window.TextParser = {
  MAX_CHUNK_SIZE: 3000,

  /**
   * Parse text into segments suitable for TTS processing.
   * 1. Split by newline (supports both \n and \n\n from Google Docs export)
   * 2. Trim and filter empty lines
   * 3. Merge consecutive short lines (< MIN_MERGE_SIZE) into bigger chunks
   * 4. Split oversized segments by sentence boundaries
   * 5. Assign sequential IDs starting from 1
   *
   * @param {string} text - The raw input text.
   * @returns {Array<{ id: number, text: string, charCount: number }>}
   */
  MIN_MERGE_SIZE: 200,

  parseText(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // Split by any newline (handles both \n and \n\n)
    var rawLines = text.split(/\n/);

    // Trim and filter empty lines
    var lines = rawLines
      .map(function (p) { return p.trim(); })
      .filter(function (p) { return p.length > 0; });

    if (lines.length === 0) return [];

    // Merge consecutive short lines to avoid too many tiny segments
    var merged = [];
    var buffer = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // If buffer + line is still small, merge them
      if (buffer.length > 0 && (buffer.length + line.length + 1) <= this.MIN_MERGE_SIZE) {
        buffer = buffer + '\n' + line;
      } else if (buffer.length === 0) {
        buffer = line;
      } else {
        // Buffer is big enough, push it and start new
        merged.push(buffer);
        buffer = line;
      }
    }
    if (buffer.length > 0) {
      merged.push(buffer);
    }

    // Expand oversized segments
    var allChunks = [];
    for (var j = 0; j < merged.length; j++) {
      var para = merged[j];
      if (para.length > this.MAX_CHUNK_SIZE) {
        var subChunks = this._splitLongSegment(para);
        for (var k = 0; k < subChunks.length; k++) {
          allChunks.push(subChunks[k]);
        }
      } else {
        allChunks.push(para);
      }
    }

    // Assign sequential IDs
    var segments = [];
    for (var m = 0; m < allChunks.length; m++) {
      segments.push({
        id: m + 1,
        text: allChunks[m],
        charCount: allChunks[m].length
      });
    }

    return segments;
  },

  /**
   * Split a long segment by sentence boundaries, then by word boundaries.
   * @param {string} text - Text longer than MAX_CHUNK_SIZE.
   * @returns {string[]} Array of smaller text chunks.
   * @private
   */
  _splitLongSegment(text) {
    var chunks = [];
    // Try splitting by sentence-ending punctuation followed by space or newline
    var sentences = text.split(/(?<=[.!?;])\s+/);

    var currentChunk = '';
    for (var i = 0; i < sentences.length; i++) {
      var sentence = sentences[i];

      // If a single sentence is still too long, force-split it
      if (sentence.length > this.MAX_CHUNK_SIZE) {
        // Flush current chunk first
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        // Force-split by word boundary at MAX_CHUNK_SIZE
        var forceSplit = this._forceSplitAtWordBoundary(sentence);
        for (var j = 0; j < forceSplit.length; j++) {
          chunks.push(forceSplit[j]);
        }
        continue;
      }

      // Check if adding this sentence exceeds the limit
      var combined = currentChunk.length > 0
        ? currentChunk + ' ' + sentence
        : sentence;

      if (combined.length > this.MAX_CHUNK_SIZE) {
        // Push current chunk and start a new one
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      } else {
        currentChunk = combined;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  },

  /**
   * Force-split text at word boundaries near MAX_CHUNK_SIZE.
   * @param {string} text
   * @returns {string[]}
   * @private
   */
  _forceSplitAtWordBoundary(text) {
    var chunks = [];
    var remaining = text;

    while (remaining.length > this.MAX_CHUNK_SIZE) {
      // Find last space before MAX_CHUNK_SIZE
      var cutPoint = remaining.lastIndexOf(' ', this.MAX_CHUNK_SIZE);
      if (cutPoint <= 0) {
        // No space found, hard cut
        cutPoint = this.MAX_CHUNK_SIZE;
      }
      chunks.push(remaining.substring(0, cutPoint).trim());
      remaining = remaining.substring(cutPoint).trim();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  },

  /**
   * Read file content as text.
   * Supports .txt files via FileReader.readAsText().
   * @param {File} file - The File object to read.
   * @returns {Promise<string>} The file content as text.
   */
  readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('Không có tệp nào được chọn.'));
        return;
      }

      var reader = new FileReader();

      reader.onload = function (e) {
        resolve(e.target.result);
      };

      reader.onerror = function () {
        reject(new Error('Không thể đọc tệp: ' + file.name));
      };

      reader.readAsText(file, 'UTF-8');
    });
  },

  /**
   * Parse HTML paste content (e.g., from Google Docs).
   * Converts block elements to paragraph breaks, strips tags,
   * decodes entities, and cleans up whitespace.
   * @param {string} html - The raw HTML string.
   * @returns {string} Cleaned plain text with paragraph breaks.
   */
  parseHtmlPaste(html) {
    if (!html || typeof html !== 'string') {
      return '';
    }

    var text = html;

    // Replace block-closing tags with double newlines
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n\n');
    text = text.replace(/<br\s*\/?>/gi, '\n\n');

    // Strip all remaining HTML tags
    text = text.replace(/<[^>]*>/g, '');

    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');

    // Collapse 3+ consecutive newlines to 2
    text = text.replace(/\n{3,}/g, '\n\n');

    // Trim leading/trailing whitespace
    text = text.trim();

    return text;
  },

  /**
   * Get statistics for an array of segments.
   * @param {Array<{ id: number, text: string, charCount: number }>} segments
   * @returns {{ totalSegments: number, totalChars: number, estimatedDuration: string }}
   */
  getStats(segments) {
    if (!segments || !Array.isArray(segments)) {
      return {
        totalSegments: 0,
        totalChars: 0,
        estimatedDuration: '0:00'
      };
    }

    var totalChars = 0;
    for (var i = 0; i < segments.length; i++) {
      totalChars += segments[i].charCount;
    }

    // Rough estimation: ~15 characters per second for Vietnamese/English TTS
    var estimatedSeconds = Math.ceil(totalChars / 15);
    var minutes = Math.floor(estimatedSeconds / 60);
    var seconds = estimatedSeconds % 60;
    var estimatedDuration = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;

    return {
      totalSegments: segments.length,
      totalChars: totalChars,
      estimatedDuration: estimatedDuration
    };
  },

  /**
   * Extract Google Docs document ID from a URL.
   * Supports various URL formats:
   *   - https://docs.google.com/document/d/DOC_ID/edit
   *   - https://docs.google.com/document/d/DOC_ID/view
   *   - https://docs.google.com/document/d/DOC_ID/
   *   - https://docs.google.com/document/d/DOC_ID
   * @param {string} url
   * @returns {string|null} The document ID, or null if not a valid Google Docs URL.
   */
  extractGoogleDocId(url) {
    if (!url || typeof url !== 'string') return null;
    var match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  },

  /**
   * Fetch plain text content from a public Google Docs document.
   * Uses the export endpoint: /document/d/{ID}/export?format=txt
   * @param {string} url - The Google Docs URL.
   * @returns {Promise<string>} The document text content.
   */
  async fetchGoogleDoc(url) {
    var docId = this.extractGoogleDocId(url);
    if (!docId) {
      throw new Error('Link không hợp lệ. Vui lòng dán link Google Docs (ví dụ: https://docs.google.com/document/d/...)');
    }

    var exportUrl = 'https://docs.google.com/document/d/' + docId + '/export?format=txt';

    var response;
    try {
      response = await fetch(exportUrl);
    } catch (err) {
      throw new Error('Lỗi kết nối. Kiểm tra kết nối mạng hoặc tài liệu có thể không công khai.');
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Không tìm thấy tài liệu. Kiểm tra lại link.');
      }
      if (response.status === 403 || response.status === 401) {
        throw new Error('Tài liệu không công khai. Hãy bật chia sẻ "Bất kỳ ai có link".');
      }
      throw new Error('Lỗi tải tài liệu: ' + response.status);
    }

    var text = await response.text();
    if (!text || text.trim().length === 0) {
      throw new Error('Tài liệu trống, không có nội dung.');
    }

    return text.trim();
  }
};
