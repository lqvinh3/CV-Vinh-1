const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

/**
 * Cache lưu trữ buffer PDF:
 * 1. renderCache: cache Cover Letter và CV riêng lẻ
 * 2. fullPdfCache: cache toàn bộ file PDF Full đã ghép (Cover + CV + Bằng Cấp)
 *    -> Giúp tải bản xem trước Full đạt tốc độ tức thì (~0ms)
 *    -> Khi bấm In/Tải về với các trang đã chọn xóa, server chỉ cần load từ fullPdfCache và cắt trang trong ~15ms!
 */
const renderCache = {
  cover: { mtime: 0, buffer: null },
  cv: {} // key: `${filename}_${lang}` -> { mtime: 0, buffer: null }
};

const fullPdfCache = {}; // key: `${filename}_${lang}` -> { coverMtime, cvMtime, bangCapMtime, pdfBytes, pageCount }

/**
 * Auto-detect Chrome or Edge executable on Windows/Linux/Mac
 */
function getBrowserExecutablePath() {
  const possiblePaths = [
    // Windows Chrome
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    
    // Windows Edge
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),

    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',

    // Mac
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error('Không tìm thấy trình duyệt Google Chrome hoặc Microsoft Edge trên máy tính để tạo PDF.');
}

/**
 * Lấy buffer PDF của Cover Letter (có cache theo mtime của file)
 */
async function getCoverLetterPdf(browser, coverLetterPath, baseUrl) {
  const stat = fs.statSync(coverLetterPath);
  if (renderCache.cover.buffer && renderCache.cover.mtime === stat.mtimeMs) {
    return renderCache.cover.buffer;
  }

  const coverPage = await browser.newPage();
  try {
    await coverPage.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
    const coverUrl = `${baseUrl}/client/cover-letter.html`;
    await coverPage.goto(coverUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    await coverPage.addStyleTag({
      content: `
        @page {
          size: A4 portrait;
          margin: 15mm 20mm 15mm 20mm;
        }
        body {
          background-color: #ffffff !important;
          padding: 0 !important;
          margin: 0 !important;
          display: block !important;
          font-family: 'Roboto', 'Segoe UI', Arial, sans-serif !important;
          color: #1e293b !important;
        }
        .lang-toggle-container {
          display: none !important;
        }
        .cover-letter-title h2 {
          font-size: 26px !important;
          font-weight: 700 !important;
          color: #0f172a !important;
          letter-spacing: 2px !important;
          margin-top: 10px !important;
          margin-bottom: 25px !important;
          padding-bottom: 12px !important;
          border-bottom: 2px solid #2563eb !important;
        }
        .cover-letter-text {
          font-size: 16.5px !important;
          line-height: 30px !important;
          color: #262626 !important;
        }
      `
    });

    const buffer = await coverPage.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '20mm', right: '20mm' }
    });

    renderCache.cover.mtime = stat.mtimeMs;
    renderCache.cover.buffer = buffer;
    return buffer;
  } finally {
    await coverPage.close();
  }
}

/**
 * Lấy buffer PDF của CV (có cache theo mtime của file và ngôn ngữ)
 */
async function getCvPdf(browser, cvPath, safeCvName, lang, baseUrl) {
  const stat = fs.statSync(cvPath);
  const cacheKey = `${safeCvName}_${lang}`;
  if (renderCache.cv[cacheKey] && renderCache.cv[cacheKey].mtime === stat.mtimeMs) {
    return renderCache.cv[cacheKey].buffer;
  }

  const cvPage = await browser.newPage();
  try {
    await cvPage.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
    const cvUrl = `${baseUrl}/client/${encodeURIComponent(safeCvName)}`;
    await cvPage.goto(cvUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    if (lang) {
      await cvPage.evaluate((targetLang) => {
        if (typeof STATE !== 'undefined' && typeof toggleLanguage === 'function') {
          if (STATE.current !== targetLang) {
            toggleLanguage();
          }
        }
      }, lang);
    }

    await cvPage.addStyleTag({
      content: `
        @page {
          size: A4 portrait;
          margin: 0;
        }
        body {
          background-color: #ffffff !important;
          padding: 0 !important;
          margin: 0 !important;
        }
        .lang-toggle-container {
          display: none !important;
        }
        .cv-container {
          box-shadow: none !important;
          margin: 0 auto !important;
          width: 210mm !important;
        }
      `
    });

    const buffer = await cvPage.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' }
    });

    renderCache.cv[cacheKey] = {
      mtime: stat.mtimeMs,
      buffer: buffer
    };
    return buffer;
  } finally {
    await cvPage.close();
  }
}

/**
 * Lấy hoặc tạo bản PDF FULL hoàn chỉnh (Cover Letter + CV + Bằng Cấp) có lưu cache.
 */
async function getFullMergedPdf({ cvFileName, lang = 'vi', baseUrl = 'http://localhost:3000' }) {
  const clientDir = path.resolve(__dirname, '../client');
  const safeCvName = path.basename(cvFileName);
  const cvPath = path.join(clientDir, safeCvName);
  const coverLetterPath = path.join(clientDir, 'cover-letter.html');
  const bangCapPath = path.join(clientDir, 'BANG_CAP.pdf');

  if (!fs.existsSync(cvPath)) {
    throw new Error(`Không tìm thấy file CV: ${safeCvName}`);
  }
  if (!fs.existsSync(coverLetterPath)) {
    throw new Error('Không tìm thấy file cover-letter.html trong thư mục client');
  }

  const coverStat = fs.statSync(coverLetterPath);
  const cvStat = fs.statSync(cvPath);
  const bangCapStat = fs.existsSync(bangCapPath) ? fs.statSync(bangCapPath) : { mtimeMs: 0 };
  const fullCacheKey = `${safeCvName}_${lang}`;

  // Kiểm tra cache Full PDF
  const cached = fullPdfCache[fullCacheKey];
  if (
    cached &&
    cached.coverMtime === coverStat.mtimeMs &&
    cached.cvMtime === cvStat.mtimeMs &&
    cached.bangCapMtime === bangCapStat.mtimeMs
  ) {
    return cached;
  }

  // Nếu chưa có hoặc file nguồn bị sửa, render lại các thành phần cần thiết
  const needCoverRender = !renderCache.cover.buffer || renderCache.cover.mtime !== coverStat.mtimeMs;
  const cvCacheKey = `${safeCvName}_${lang}`;
  const needCvRender = !renderCache.cv[cvCacheKey] || renderCache.cv[cvCacheKey].mtime !== cvStat.mtimeMs;

  let coverPdfBytes = renderCache.cover.buffer;
  let cvPdfBytes = renderCache.cv[cvCacheKey]?.buffer;

  if (needCoverRender || needCvRender) {
    const browserPath = getBrowserExecutablePath();
    const browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    try {
      if (needCoverRender) {
        coverPdfBytes = await getCoverLetterPdf(browser, coverLetterPath, baseUrl);
      }
      if (needCvRender) {
        cvPdfBytes = await getCvPdf(browser, cvPath, safeCvName, lang, baseUrl);
      }
    } finally {
      await browser.close();
    }
  }

  // Ghép toàn bộ thành Master Full Document
  const mergedDoc = await PDFDocument.create();

  // 1. Nạp Cover Letter
  const coverDoc = await PDFDocument.load(coverPdfBytes);
  const coverPages = await mergedDoc.copyPages(coverDoc, coverDoc.getPageIndices());
  coverPages.forEach(p => mergedDoc.addPage(p));

  // 2. Nạp CV
  const cvDoc = await PDFDocument.load(cvPdfBytes);
  const cvPages = await mergedDoc.copyPages(cvDoc, cvDoc.getPageIndices());
  cvPages.forEach(p => mergedDoc.addPage(p));

  // 3. Nạp Bằng Cấp
  if (fs.existsSync(bangCapPath)) {
    const bangCapBytes = fs.readFileSync(bangCapPath);
    const bangCapDoc = await PDFDocument.load(bangCapBytes);
    const bangCapPages = await mergedDoc.copyPages(bangCapDoc, bangCapDoc.getPageIndices());
    bangCapPages.forEach(p => mergedDoc.addPage(p));
  }

  const mergedBytes = await mergedDoc.save();
  const result = {
    coverMtime: coverStat.mtimeMs,
    cvMtime: cvStat.mtimeMs,
    bangCapMtime: bangCapStat.mtimeMs,
    pdfBytes: Buffer.from(mergedBytes),
    pageCount: mergedDoc.getPageCount(),
    coverPages: coverDoc.getPageCount(),
    cvPages: cvDoc.getPageCount()
  };

  // Lưu vào cache Full PDF
  fullPdfCache[fullCacheKey] = result;
  return result;
}

/**
 * Tạo file PDF theo yêu cầu:
 * - Nếu excludePages rỗng: trả về file Full từ cache (cực nhanh).
 * - Nếu excludePages có trang cần xóa: lấy từ cache Full PDF, gỡ các trang đó và trả về (mất ~15ms).
 */
async function generateMergedPdf({ cvFileName, lang = 'vi', baseUrl = 'http://localhost:3000', excludePages = [] }) {
  const fullResult = await getFullMergedPdf({ cvFileName, lang, baseUrl });

  // Nếu không yêu cầu xóa trang nào -> trả về luôn bản Full từ cache
  if (!Array.isArray(excludePages) || excludePages.length === 0) {
    return {
      pdfBytes: fullResult.pdfBytes,
      pageCount: fullResult.pageCount,
      originalPageCount: fullResult.pageCount,
      excludedPages: []
    };
  }

  // Khi có yêu cầu xóa trang (lúc bấm In / Tải về): cắt bỏ các trang chỉ định từ bản Full
  const editedDoc = await PDFDocument.load(fullResult.pdfBytes);
  const originalPageCount = fullResult.pageCount;

  const sortedExcludes = [...new Set(excludePages.map(Number))]
    .filter(p => !isNaN(p) && p >= 1 && p <= originalPageCount)
    .sort((a, b) => b - a); // Xóa từ trang lớn nhất đến nhỏ nhất để không lệch index

  // Giữ lại ít nhất 1 trang
  if (sortedExcludes.length < originalPageCount) {
    for (const pageNum of sortedExcludes) {
      editedDoc.removePage(pageNum - 1);
    }
  }

  const editedBytes = await editedDoc.save();
  return {
    pdfBytes: Buffer.from(editedBytes),
    pageCount: editedDoc.getPageCount(),
    originalPageCount: originalPageCount,
    excludedPages: sortedExcludes
  };
}

/**
 * Xóa cache nếu cần force refresh
 */
function clearRenderCache() {
  renderCache.cover = { mtime: 0, buffer: null };
  renderCache.cv = {};
  for (const k in fullPdfCache) delete fullPdfCache[k];
}

module.exports = {
  getFullMergedPdf,
  generateMergedPdf,
  clearRenderCache,
  getBrowserExecutablePath
};
