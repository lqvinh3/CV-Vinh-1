const express = require('express');
const path = require('path');
const fs = require('fs');
const { generateMergedPdf, getBrowserExecutablePath, clearRenderCache } = require('./pdfService');

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.resolve(__dirname, '../client');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phục vụ giao diện Quản lý (Dashboard)
app.use(express.static(path.join(__dirname, 'public')));

// Phục vụ thư mục client (HTML, CSS, JS, ảnh, bằng cấp...)
app.use('/client', express.static(CLIENT_DIR));

/**
 * Helper: Trích xuất tiêu đề HTML từ thẻ <title>
 */
function extractTitleFromHtml(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : path.basename(filePath);
  } catch {
    return path.basename(filePath);
  }
}

/**
 * Helper: Chuẩn hóa tham số excludePages từ request
 */
function parseExcludePages(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(Number).filter(n => !isNaN(n) && n > 0);
  }
  if (typeof input === 'string') {
    return input.split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n > 0);
  }
  return [];
}

/**
 * API: Lấy danh sách các file HTML trong folder client
 */
app.get('/api/cv-list', (req, res) => {
  try {
    if (!fs.existsSync(CLIENT_DIR)) {
      return res.status(404).json({ error: 'Không tìm thấy thư mục client' });
    }

    const allEntries = fs.readdirSync(CLIENT_DIR, { withFileTypes: true });
    
    // Lọc các file .html
    const htmlFiles = allEntries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
      .map(entry => {
        const filePath = path.join(CLIENT_DIR, entry.name);
        const stats = fs.statSync(filePath);
        const isCover = entry.name === 'cover-letter.html';
        const isDefault = entry.name === 'index3-VN-ENG-V5.html';

        let label = entry.name;
        if (entry.name === 'index3-VN-ENG-V5.html') label = 'Bản ERP & Logistics (Song Ngữ V5)';
        else if (entry.name === 'index3-VN-ENG-V4.html') label = 'Bản Mới Nhất (Song Ngữ V4)';
        else if (entry.name === 'index3-VN-ENG-V3.html') label = 'Bản Song Ngữ V3';
        else if (entry.name === 'index3-VN-ENG-V2.html') label = 'Bản Song Ngữ V2';
        else if (entry.name === 'index3-VN-ENG-V1.html') label = 'Bản Song Ngữ V1';
        else if (entry.name === 'index2.html') label = 'Bản CV V2';
        else if (entry.name === 'index.html') label = 'Bản CV Gốc V1';
        else if (entry.name === 'cover-letter.html') label = 'Cover Letter (Thư Giới Thiệu)';

        return {
          filename: entry.name,
          title: extractTitleFromHtml(filePath),
          label: label,
          sizeBytes: stats.size,
          sizeFormatted: (stats.size / 1024).toFixed(1) + ' KB',
          modified: stats.mtime,
          isCoverLetter: isCover,
          isDefault: isDefault
        };
      })
      .sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        if (a.filename === 'index3-VN-ENG-V4.html') return -1;
        if (b.filename === 'index3-VN-ENG-V4.html') return 1;
        if (a.isCoverLetter) return 1;
        if (b.isCoverLetter) return -1;
        return a.filename.localeCompare(b.filename);
      });

    const coverLetterExists = fs.existsSync(path.join(CLIENT_DIR, 'cover-letter.html'));
    const bangCapPath = path.join(CLIENT_DIR, 'BANG_CAP.pdf');
    const bangCapExists = fs.existsSync(bangCapPath);
    let bangCapSize = '0 KB';
    if (bangCapExists) {
      bangCapSize = (fs.statSync(bangCapPath).size / 1024).toFixed(1) + ' KB';
    }

    res.json({
      success: true,
      files: htmlFiles,
      coverLetter: {
        filename: 'cover-letter.html',
        exists: coverLetterExists
      },
      bangCap: {
        filename: 'BANG_CAP.pdf',
        exists: bangCapExists,
        size: bangCapSize
      },
      defaultCv: 'index3-VN-ENG-V5.html'
    });
  } catch (error) {
    console.error('Lỗi khi đọc danh sách file:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Lấy thông tin cấu trúc trang của PDF (tổng số trang gốc, số trang cover, cv, bằng cấp)
 */
app.get('/api/pdf-info', async (req, res) => {
  try {
    const cvFile = req.query.cvFile || 'index3-VN-ENG-V4.html';
    const lang = req.query.lang || 'vi';
    const safeCvName = path.basename(cvFile);
    const baseUrl = `http://127.0.0.1:${PORT}`;

    const result = await generateMergedPdf({
      cvFileName: safeCvName,
      lang: lang,
      baseUrl: baseUrl,
      excludePages: []
    });

    res.json({
      success: true,
      originalPageCount: result.originalPageCount,
      coverPages: result.coverPages,
      cvPages: result.cvPages,
      bangCapPages: result.bangCapPages
    });
  } catch (error) {
    console.error('[PDF-INFO LỖI]', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Tạo PDF gộp (Cover Letter + CV + BANG_CAP.pdf), có hỗ trợ xóa trang theo yêu cầu
 */
app.post('/api/generate-pdf', async (req, res) => {
  try {
    const { cvFile = 'index3-VN-ENG-V4.html', lang = 'vi', excludePages = [] } = req.body;
    const safeCvName = path.basename(cvFile);
    const parsedExcludes = parseExcludePages(excludePages);

    console.log(`[TẠO PDF] Đang xử lý: CV=${safeCvName}, Ngôn ngữ=${lang}, Xóa trang: [${parsedExcludes.join(', ')}]`);

    const baseUrl = `http://127.0.0.1:${PORT}`;
    const result = await generateMergedPdf({
      cvFileName: safeCvName,
      lang: lang,
      baseUrl: baseUrl,
      excludePages: parsedExcludes
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const suffix = parsedExcludes.length > 0 ? `_cut_${parsedExcludes.join('-')}` : '';
    const cleanFileName = `CV_LamQuangVinh_${safeCvName.replace('.html', '')}${suffix}_${timestamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName}"`);
    res.setHeader('Content-Length', result.pdfBytes.length);
    res.setHeader('X-Original-Page-Count', result.originalPageCount);
    res.setHeader('X-Current-Page-Count', result.pageCount);
    res.send(result.pdfBytes);

    console.log(`[TẠO PDF] Hoàn tất! Đã gửi ${result.pageCount}/${result.originalPageCount} trang, dung lượng: ${(result.pdfBytes.length / 1024).toFixed(1)} KB`);
  } catch (error) {
    console.error('[TẠO PDF LỖI]', error);
    res.status(500).json({
      error: 'Không thể tạo file PDF: ' + error.message
    });
  }
});

/**
 * API: Xem trước (preview) file PDF gộp: LUÔN LÀ FILE FULL GỐC TỪ CACHE
 */
app.get('/api/preview-pdf', async (req, res) => {
  try {
    const cvFile = req.query.cvFile || 'index3-VN-ENG-V5.html';
    const lang = req.query.lang || 'vi';
    const safeCvName = path.basename(cvFile);

    const baseUrl = `http://127.0.0.1:${PORT}`;
    // Luôn tải bản Full không cắt bỏ trang nào để người dùng đối chiếu số trang gốc
    const result = await generateMergedPdf({
      cvFileName: safeCvName,
      lang: lang,
      baseUrl: baseUrl,
      excludePages: []
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview_full.pdf"');
    res.setHeader('Content-Length', result.pdfBytes.length);
    res.setHeader('X-Original-Page-Count', result.originalPageCount);
    res.setHeader('X-Current-Page-Count', result.pageCount);
    res.setHeader('Access-Control-Expose-Headers', 'X-Original-Page-Count, X-Current-Page-Count');
    res.send(result.pdfBytes);
  } catch (error) {
    console.error('[PREVIEW PDF LỖI]', error);
    res.status(500).send('Lỗi tạo bản xem trước: ' + error.message);
  }
});

/**
 * API: In PDF (print) - Cắt bỏ các trang đã chỉnh sửa và trả về để trình duyệt in ngay
 */
app.get('/api/print-pdf', async (req, res) => {
  try {
    const cvFile = req.query.cvFile || 'index3-VN-ENG-V5.html';
    const lang = req.query.lang || 'vi';
    const excludePages = parseExcludePages(req.query.excludePages);
    const safeCvName = path.basename(cvFile);

    const baseUrl = `http://127.0.0.1:${PORT}`;
    const result = await generateMergedPdf({
      cvFileName: safeCvName,
      lang: lang,
      baseUrl: baseUrl,
      excludePages: excludePages
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="CV_Print.pdf"');
    res.setHeader('Content-Length', result.pdfBytes.length);
    res.send(result.pdfBytes);
  } catch (error) {
    console.error('[PRINT PDF LỖI]', error);
    res.status(500).send('Lỗi in PDF: ' + error.message);
  }
});

/**
 * API: Kiểm tra trạng thái hệ thống
 */
app.get('/api/status', (req, res) => {
  let browser = 'Không xác định';
  try {
    browser = getBrowserExecutablePath();
  } catch (e) {
    browser = e.message;
  }

  res.json({
    nodeVersion: process.version,
    port: PORT,
    clientDir: CLIENT_DIR,
    browserExecutable: browser,
    uptime: Math.round(process.uptime()) + 's'
  });
});

app.listen(PORT, () => {
  console.log('========================================================');
  console.log(`🚀 CV Server Node.js đang chạy tại: http://localhost:${PORT}`);
  console.log(`📁 Thư mục Client: ${CLIENT_DIR}`);
  console.log('========================================================');
});
