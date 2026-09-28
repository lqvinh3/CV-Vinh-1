/**
 * Frontend logic for CV Manager & PDF Generator
 */

// Global State
let currentSelectedCv = 'index3-VN-ENG-V5.html';
let currentLang = 'vi';
let cvFiles = [];
let excludedPages = []; // Danh sách số trang gốc (1-based) được đánh dấu xóa khi In/Tải về
let originalPageCount = 0;

// DOM Elements
const filesListContainer = document.getElementById('filesListContainer');
const fileCountBadge = document.getElementById('fileCountBadge');
const pipelineSelectedCvName = document.getElementById('pipelineSelectedCvName');
const pipelineViewCvBtn = document.getElementById('pipelineViewCvBtn');

const cvPreviewFrame = document.getElementById('cvPreviewFrame');
const previewFilenameBadge = document.getElementById('previewFilenameBadge');
const openNewTabBtn = document.getElementById('openNewTabBtn');
const refreshIframeBtn = document.getElementById('refreshIframeBtn');

const generatePdfBtn = document.getElementById('generatePdfBtn');
const genSpinner = document.getElementById('genSpinner');
const genIcon = document.getElementById('genIcon');
const genBtnText = document.getElementById('genBtnText');

const previewPdfBtn = document.getElementById('previewPdfBtn');
const pdfModalBackdrop = document.getElementById('pdfModalBackdrop');
const pdfModalLoading = document.getElementById('pdfModalLoading');
const pdfPreviewIframe = document.getElementById('pdfPreviewIframe');
const pdfPrintIframe = document.getElementById('pdfPrintIframe');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalDownloadBtn = document.getElementById('modalDownloadBtn');
const modalPrintBtn = document.getElementById('modalPrintBtn');
const modalResetPagesBtn = document.getElementById('modalResetPagesBtn');
const modalPageCounter = document.getElementById('modalPageCounter');
const pageDeletionBar = document.getElementById('pageDeletionBar');

const serverStatusBadge = document.getElementById('serverStatusBadge');
const statusText = document.getElementById('statusText');
const toastContainer = document.getElementById('toastContainer');

// ============================================================================
// Notification Toast
// ============================================================================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================================
// Server Health Check
// ============================================================================
async function checkServerStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const data = await res.json();
      const dot = serverStatusBadge.querySelector('.status-dot');
      dot.classList.add('online');
      statusText.textContent = `Server Online (Port ${data.port})`;
    }
  } catch (err) {
    statusText.textContent = 'Mất kết nối server';
    console.error('Lỗi kết nối server:', err);
  }
}

// ============================================================================
// Load HTML Files from Client Folder
// ============================================================================
async function loadCvFiles() {
  try {
    const res = await fetch('/api/cv-list');
    if (!res.ok) throw new Error('Không thể lấy danh sách CV từ server');

    const data = await res.json();
    cvFiles = data.files || [];

    // Cập nhật số lượng file
    fileCountBadge.textContent = `${cvFiles.length} file HTML`;

    // Nếu có file mặc định thì chọn
    if (data.defaultCv && cvFiles.some(f => f.filename === data.defaultCv)) {
      currentSelectedCv = data.defaultCv;
    } else if (cvFiles.length > 0) {
      currentSelectedCv = cvFiles[0].filename;
    }

    renderFilesList();
    updateSelectedState(currentSelectedCv, false);

  } catch (err) {
    console.error('Lỗi nạp file:', err);
    filesListContainer.innerHTML = `
      <div class="loading-state" style="color: #ef4444;">
        <i class="fa-solid fa-circle-exclamation"></i>
        <span>Lỗi tải danh sách file: ${err.message}</span>
      </div>
    `;
    showToast('Lỗi tải danh sách file: ' + err.message, 'error');
  }
}

// ============================================================================
// Render List of HTML Files with Buttons and Arrow View Icons
// ============================================================================
function renderFilesList() {
  filesListContainer.innerHTML = '';

  if (cvFiles.length === 0) {
    filesListContainer.innerHTML = `
      <div class="loading-state">
        <span>Không tìm thấy file .html nào trong thư mục client</span>
      </div>
    `;
    return;
  }

  cvFiles.forEach(file => {
    const isSelected = file.filename === currentSelectedCv;
    const isCoverLetter = file.isCoverLetter;

    // Row container
    const row = document.createElement('div');
    row.className = `file-card-row ${isSelected ? 'is-active' : ''}`;
    row.id = `row-${file.filename.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    // 1. MAIN BUTTON: Bấm vào là tô xanh & chọn để tạo CV + preview
    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = `file-main-btn ${isSelected ? 'selected-cv' : ''}`;
    mainBtn.id = `btn-${file.filename.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    mainBtn.title = `Bấm chọn ${file.filename} để xuất PDF`;

    // Icon khác biệt cho Cover Letter vs CV
    const iconClass = isCoverLetter ? 'fa-file-lines' : 'fa-file-code';

    mainBtn.innerHTML = `
      <div class="file-icon">
        <i class="fa-solid ${iconClass}"></i>
      </div>
      <div class="file-details">
        <div class="file-title-row">
          <span class="file-filename">${file.filename}</span>
          <span class="file-badge-active"><i class="fa-solid fa-check"></i> Đang Chọn</span>
        </div>
        <div class="file-meta-row">
          <span class="file-label-tag">${file.label}</span>
          <span>•</span>
          <span class="file-size-tag">${file.sizeFormatted}</span>
        </div>
      </div>
      <div class="file-radio-indicator" title="Trạng thái chọn"></div>
    `;

    // Sự kiện khi bấm vào button: Tô xanh & chọn CV
    mainBtn.addEventListener('click', () => {
      selectCv(file.filename);
    });

    // 2. SMALL ARROW VIEW BUTTON: Mũi tên kế bên để vào page html xem cv
    const arrowBtn = document.createElement('a');
    arrowBtn.className = 'file-arrow-btn';
    arrowBtn.href = `/client/${file.filename}`;
    arrowBtn.target = '_blank';
    arrowBtn.rel = 'noopener noreferrer';
    arrowBtn.title = `Mở xem trực tiếp ${file.filename} trong tab mới`;
    arrowBtn.innerHTML = `
      <i class="fa-solid fa-arrow-up-right-from-square"></i>
      <span>Xem</span>
    `;

    arrowBtn.addEventListener('click', (e) => {
      selectCv(file.filename, false);
    });

    row.appendChild(mainBtn);
    row.appendChild(arrowBtn);
    filesListContainer.appendChild(row);
  });
}

// ============================================================================
// Select CV Handler (Tô xanh button đó coi như là chọn để tạo CV)
// ============================================================================
function selectCv(filename, notify = true) {
  if (currentSelectedCv !== filename) {
    excludedPages = []; // Reset danh sách xóa khi đổi sang CV khác
  }
  currentSelectedCv = filename;
  updateSelectedState(filename, notify);
}

function updateSelectedState(filename, notify = true) {
  // Cập nhật class tô xanh cho các button
  document.querySelectorAll('.file-main-btn').forEach(btn => {
    btn.classList.remove('selected-cv');
  });
  document.querySelectorAll('.file-card-row').forEach(row => {
    row.classList.remove('is-active');
  });

  const safeId = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
  const activeBtn = document.getElementById(`btn-${safeId}`);
  const activeRow = document.getElementById(`row-${safeId}`);

  if (activeBtn) {
    activeBtn.classList.add('selected-cv'); // TÔ XANH BUTTON ĐÃ CHỌN
  }
  if (activeRow) {
    activeRow.classList.add('is-active');
  }

  // Cập nhật thanh quy trình Pipeline ở trên
  pipelineSelectedCvName.textContent = filename;
  pipelineViewCvBtn.onclick = () => window.open(`/client/${filename}`, '_blank');

  // Cập nhật khung xem trước trực tiếp (Live Preview Iframe)
  previewFilenameBadge.textContent = filename;
  cvPreviewFrame.src = `/client/${filename}`;

  if (notify) {
    showToast(`Đã chọn CV: ${filename}`, 'success');
  }
}

// ============================================================================
// Language Selector Switcher
// ============================================================================
document.querySelectorAll('.segment-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentLang = btn.dataset.lang;
    excludedPages = []; // reset excluded pages khi đổi ngôn ngữ
    showToast(`Đã đổi ngôn ngữ xuất PDF sang: ${currentLang === 'vi' ? 'Tiếng Việt' : 'English'}`, 'info');
  });
});

// ============================================================================
// Toolbar Actions for Preview Pane
// ============================================================================
openNewTabBtn.addEventListener('click', () => {
  if (currentSelectedCv) {
    window.open(`/client/${currentSelectedCv}`, '_blank');
  }
});

refreshIframeBtn.addEventListener('click', () => {
  if (cvPreviewFrame) {
    cvPreviewFrame.contentWindow.location.reload();
    showToast('Đã tải lại khung xem trước', 'info');
  }
});

// ============================================================================
// Generate and Download PDF (Tạo file PDF ở sv xong gửi về cho user save lại)
// Bấm Tải về mới thực hiện cắt bỏ các trang đã chọn xóa
// ============================================================================
async function executeDownloadPdf() {
  if (!currentSelectedCv) {
    showToast('Vui lòng chọn một file CV trước!', 'error');
    return;
  }

  // Set Loading State
  generatePdfBtn.disabled = true;
  genSpinner.style.display = 'inline-block';
  genIcon.style.display = 'none';
  genBtnText.textContent = 'Server Đang Tạo PDF...';

  const excludeMsg = excludedPages.length > 0 ? ` (đã cắt bỏ trang: ${excludedPages.join(', ')})` : '';
  showToast(`Đang tạo PDF hoàn chỉnh để tải về${excludeMsg}...`, 'info');

  try {
    const res = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cvFile: currentSelectedCv,
        lang: currentLang,
        excludePages: excludedPages
      })
    });

    if (!res.ok) {
      const errorJson = await res.json().catch(() => null);
      throw new Error(errorJson?.error || `HTTP error ${res.status}`);
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    const downloadLink = document.createElement('a');
    downloadLink.href = blobUrl;
    
    const timestamp = new Date().toISOString().slice(0, 10);
    const cleanCvName = currentSelectedCv.replace('.html', '');
    const suffix = excludedPages.length > 0 ? `_cut_${excludedPages.join('-')}` : '';
    downloadLink.download = `CV_LamQuangVinh_${cleanCvName}${suffix}_${timestamp}.pdf`;
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);

    showToast('Tải file PDF về máy thành công!', 'success');
  } catch (err) {
    console.error('Lỗi khi tạo PDF:', err);
    showToast('Lỗi tạo PDF: ' + err.message, 'error');
  } finally {
    generatePdfBtn.disabled = false;
    genSpinner.style.display = 'none';
    genIcon.style.display = 'inline-block';
    genBtnText.textContent = 'Tạo & Tải PDF Về Máy';
  }
}

generatePdfBtn.addEventListener('click', executeDownloadPdf);

// ============================================================================
// Render Page Deletion Buttons (xóa page 1, xóa page 2, ...)
// ============================================================================
function renderPageDeletionButtons() {
  pageDeletionBar.innerHTML = '';

  if (originalPageCount <= 0) return;

  for (let p = 1; p <= originalPageCount; p++) {
    const isExcluded = excludedPages.includes(p);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn-page-delete ${isExcluded ? 'is-excluded' : ''}`;
    btn.dataset.page = p;

    if (isExcluded) {
      btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> <span class="del-text">Đã chọn xóa P${p}</span>`;
      btn.title = `Trang ${p} sẽ bị loại bỏ khi In hoặc Tải về. Bấm lại để giữ lại trang!`;
    } else {
      btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> <span class="del-text">Xóa Page ${p}</span>`;
      btn.title = `Bấm để chọn loại bỏ Trang ${p} khi In hoặc Tải về`;
    }

    btn.addEventListener('click', () => {
      togglePageExclusion(p);
    });

    pageDeletionBar.appendChild(btn);
  }

  // Cập nhật bộ đếm trang
  if (excludedPages.length === 0) {
    modalPageCounter.textContent = `${originalPageCount} Trang gốc`;
  } else {
    modalPageCounter.textContent = `${originalPageCount - excludedPages.length} / ${originalPageCount} Trang (Sẽ xóa: P${excludedPages.join(', P')})`;
  }

  // Ẩn/hiện nút khôi phục
  if (modalResetPagesBtn) {
    modalResetPagesBtn.style.display = excludedPages.length > 0 ? 'inline-flex' : 'none';
  }
}

/**
 * Xử lý khi user bấm nút xóa / giữ lại 1 trang
 * LƯU Ý: Không reload iframe! Iframe luôn giữ file Full để người dùng dễ nhìn và đối chiếu trang.
 */
function togglePageExclusion(pageNum) {
  if (excludedPages.includes(pageNum)) {
    // Bỏ đánh dấu xóa -> Giữ lại trang
    excludedPages = excludedPages.filter(p => p !== pageNum);
    showToast(`Đã giữ lại Trang ${pageNum} khi in / tải về`, 'success');
  } else {
    // Đánh dấu xóa trang (đảm bảo không xóa toàn bộ)
    if (excludedPages.length >= originalPageCount - 1) {
      showToast('Cần giữ lại ít nhất 1 trang trong tài liệu!', 'error');
      return;
    }
    excludedPages.push(pageNum);
    excludedPages.sort((a, b) => a - b);
    showToast(`Đã chọn xóa Trang ${pageNum} (sẽ loại bỏ khi bấm In hoặc Tải về)`, 'info');
  }

  renderPageDeletionButtons();
}

// ============================================================================
// Preview PDF Modal: LUÔN XEM BẢN FULL GỐC TỪ CACHE
// ============================================================================
previewPdfBtn.addEventListener('click', async () => {
  if (!currentSelectedCv) {
    showToast('Vui lòng chọn một file CV trước!', 'error');
    return;
  }

  pdfModalBackdrop.style.display = 'flex';
  pdfModalLoading.style.display = 'flex';
  pdfPreviewIframe.src = 'about:blank';
  pageDeletionBar.innerHTML = '<span style="color:#94a3b8; font-size:12px;">Đang chuẩn bị danh sách trang...</span>';

  try {
    // 1. Lấy thông tin số trang từ API
    const res = await fetch(`/api/pdf-info?cvFile=${encodeURIComponent(currentSelectedCv)}&lang=${currentLang}`);
    if (res.ok) {
      const data = await res.json();
      originalPageCount = data.originalPageCount || 0;
      renderPageDeletionButtons();
    }
  } catch (e) {
    console.error('Lỗi lấy pdf-info:', e);
  }

  // 2. Luôn nạp bản FULL gốc từ Cache (không truyền excludePages)
  const fullPreviewUrl = `/api/preview-pdf?cvFile=${encodeURIComponent(currentSelectedCv)}&lang=${currentLang}&t=${Date.now()}`;
  pdfPreviewIframe.src = fullPreviewUrl;

  pdfPreviewIframe.onload = () => {
    pdfModalLoading.style.display = 'none';
  };
});

// ============================================================================
// In PDF (Print): Bấm in mới thực hiện in file PDF đã chỉnh sửa cắt bỏ các trang
// ============================================================================
async function executePrintPdf() {
  if (!currentSelectedCv) return;

  const excludeMsg = excludedPages.length > 0 ? ` (đã cắt bỏ trang: ${excludedPages.join(', ')})` : '';
  showToast(`Đang chuẩn bị file in PDF${excludeMsg}...`, 'info');

  try {
    const excludeParam = excludedPages.length > 0 ? `&excludePages=${excludedPages.join(',')}` : '';
    const printUrl = `/api/print-pdf?cvFile=${encodeURIComponent(currentSelectedCv)}&lang=${currentLang}${excludeParam}&t=${Date.now()}`;

    // Tải blob PDF đã chỉnh sửa
    const res = await fetch(printUrl);
    if (!res.ok) throw new Error('Không thể tải file in từ server');

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    if (pdfPrintIframe) {
      pdfPrintIframe.src = blobUrl;
      pdfPrintIframe.onload = () => {
        setTimeout(() => {
          try {
            pdfPrintIframe.contentWindow.focus();
            pdfPrintIframe.contentWindow.print();
          } catch {
            window.open(blobUrl, '_blank');
          }
        }, 300);
      };
    } else {
      window.open(blobUrl, '_blank');
    }
  } catch (err) {
    console.error('Lỗi in PDF:', err);
    showToast('Lỗi khi in: ' + err.message, 'error');
  }
}

if (modalPrintBtn) {
  modalPrintBtn.addEventListener('click', executePrintPdf);
}

// Nút khôi phục (bỏ chọn xóa tất cả các trang)
if (modalResetPagesBtn) {
  modalResetPagesBtn.addEventListener('click', () => {
    if (excludedPages.length === 0) return;
    excludedPages = [];
    showToast('Đã giữ lại tất cả các trang (không xóa trang nào)', 'success');
    renderPageDeletionButtons();
  });
}

modalCloseBtn.addEventListener('click', () => {
  pdfModalBackdrop.style.display = 'none';
  pdfPreviewIframe.src = 'about:blank';
});

modalDownloadBtn.addEventListener('click', () => {
  executeDownloadPdf();
});

// Close modal when clicking backdrop
pdfModalBackdrop.addEventListener('click', (e) => {
  if (e.target === pdfModalBackdrop) {
    pdfModalBackdrop.style.display = 'none';
    pdfPreviewIframe.src = 'about:blank';
  }
});

// ============================================================================
// Initial Initialization
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  checkServerStatus();
  loadCvFiles();
});
