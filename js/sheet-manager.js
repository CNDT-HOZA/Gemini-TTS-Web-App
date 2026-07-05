/**
 * SheetManager - Quản lý giao tiếp với Google Apps Script Web App
 * để đọc/ghi dữ liệu Google Sheet.
 */
(function() {
  "use strict";

  window.SheetManager = {

    /**
     * Helper nội bộ: Xây dựng URL Apps Script với các query params.
     * @param {Object} params - Đối tượng chứa các cặp key/value cho query string.
     * @returns {string} URL đầy đủ.
     */
    _buildUrl: function(params) {
      var baseUrl = window.SettingsManager.get('appsScriptUrl');
      if (!baseUrl) {
        throw new Error('Chưa cấu hình URL Apps Script. Vui lòng kiểm tra lại cài đặt.');
      }

      var queryParts = [];
      for (var key in params) {
        if (params.hasOwnProperty(key)) {
          queryParts.push(
            encodeURIComponent(key) + '=' + encodeURIComponent(params[key])
          );
        }
      }

      var separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
      return baseUrl + separator + queryParts.join('&');
    },

    /**
     * Lấy danh sách các job đang chờ xử lý (status = pending).
     * @returns {Promise<Array>} Mảng các đối tượng job: {row, stt, status, voice, speed, linkDoc, note}
     */
    fetchPendingJobs: async function() {
      var url = this._buildUrl({ action: 'get_pending' });

      try {
        var response = await fetch(url, { redirect: 'follow' });

        if (!response.ok) {
          throw new Error(
            'Lỗi khi tải danh sách job chờ xử lý. Mã lỗi HTTP: ' + response.status
          );
        }

        var data = await response.json();
        if (data && data.pending) return data.pending;
        return [];
      } catch (error) {
        if (error.message && error.message.indexOf('Lỗi khi tải') === 0) {
          throw error;
        }
        throw new Error(
          'Không thể kết nối đến Google Sheet. Vui lòng kiểm tra kết nối mạng và URL Apps Script. Chi tiết: ' + error.message
        );
      }
    },

    /**
     * Lấy toàn bộ danh sách job từ Google Sheet.
     * @returns {Promise<Array>} Mảng tất cả các đối tượng job.
     */
    fetchAllJobs: async function() {
      var url = this._buildUrl({ action: 'get_all' });

      try {
        var response = await fetch(url, { redirect: 'follow' });

        if (!response.ok) {
          throw new Error(
            'Lỗi khi tải toàn bộ danh sách job. Mã lỗi HTTP: ' + response.status
          );
        }

        var data = await response.json();
        if (data && data.rows) return data.rows;
        return [];
      } catch (error) {
        if (error.message && error.message.indexOf('Lỗi khi tải') === 0) {
          throw error;
        }
        throw new Error(
          'Không thể kết nối đến Google Sheet. Vui lòng kiểm tra kết nối mạng và URL Apps Script. Chi tiết: ' + error.message
        );
      }
    },

    /**
     * Cập nhật trạng thái của một job theo số dòng (row).
     * @param {number} row - Số dòng trong Google Sheet cần cập nhật.
     * @param {string} status - Trạng thái mới (ví dụ: 'done', 'error', 'processing').
     * @returns {Promise<Object>} Kết quả trả về từ Apps Script.
     */
    updateJobStatus: async function(row, status) {
      var url = this._buildUrl({
        action: 'update_status',
        row: row,
        status: status
      });

      try {
        var response = await fetch(url, { redirect: 'follow' });

        if (!response.ok) {
          throw new Error(
            'Lỗi khi cập nhật trạng thái dòng ' + row + '. Mã lỗi HTTP: ' + response.status
          );
        }

        var data = await response.json();
        return data;
      } catch (error) {
        if (error.message && error.message.indexOf('Lỗi khi cập nhật') === 0) {
          throw error;
        }
        throw new Error(
          'Không thể cập nhật trạng thái job (dòng ' + row + '). Vui lòng kiểm tra kết nối mạng và URL Apps Script. Chi tiết: ' + error.message
        );
      }
    }
  };
})();
