// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered', reg))
      .catch(err => console.error('Service Worker registration failed', err));
  });
}

// Global state
let originalImage = null;
let currentImageState = null; // Stores image data after edits (like chroma key)
let isDrawing = false;
let currentTool = 'chroma'; // 'chroma' or 'eraser'
let originalFileSize = 0;
let fileType = 'image/jpeg';

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const workspace = document.getElementById('workspace');
const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Tabs & Panels
const tabs = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');

// Compress controls
const compQuality = document.getElementById('compress-quality');
const qualityVal = document.getElementById('quality-val');
const compScale = document.getElementById('compress-scale');
const scaleVal = document.getElementById('scale-val');
const compFormat = document.getElementById('compress-format');
const origSizeText = document.getElementById('original-size');
const estSizeText = document.getElementById('estimated-size');

// Remover controls
const toolChroma = document.getElementById('tool-chroma');
const toolEraser = document.getElementById('tool-eraser');
const chromaSettings = document.getElementById('chroma-settings');
const eraserSettings = document.getElementById('eraser-settings');
const chromaTolerance = document.getElementById('chroma-tolerance');
const toleranceVal = document.getElementById('tolerance-val');
const eraserBrushSize = document.getElementById('eraser-brush-size');
const brushVal = document.getElementById('brush-val');
const btnRevert = document.getElementById('btn-revert');

// Actions
const btnReset = document.getElementById('btn-reset');
const btnDownload = document.getElementById('btn-download');
const toastMsg = document.getElementById('toast-msg');

// PWA Install Elements
const installBtn = document.getElementById('install-btn');
const pwaModal = document.getElementById('pwa-modal');
const modalClose = document.getElementById('modal-close');

let deferredPrompt;

// PWA Installation handling
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'block';
});

// Detect iOS
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
if (isIOS) {
  installBtn.style.display = 'block'; // Always show button on iOS to trigger guide
}

installBtn.addEventListener('click', () => {
  if (isIOS) {
    pwaModal.style.display = 'flex';
  } else if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        showToast('App 安裝成功！');
      }
      deferredPrompt = null;
    });
  } else {
    showToast('您的瀏覽器已安裝或不支援自動安裝，請手動加入主畫面。');
  }
});

modalClose.addEventListener('click', () => {
  pwaModal.style.display = 'none';
});

// Toast Utility
function showToast(msg) {
  toastMsg.textContent = msg;
  toastMsg.classList.add('show');
  setTimeout(() => {
    toastMsg.classList.remove('show');
  }, 2500);
}

// Drag & Drop
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--primary)';
});
dropZone.addEventListener('dragleave', () => {
  dropZone.style.borderColor = 'var(--border)';
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--border)';
  if (e.dataTransfer.files.length > 0) {
    loadImage(e.dataTransfer.files[0]);
  }
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    loadImage(e.target.files[0]);
  }
});

// Load Image to Canvas
function loadImage(file) {
  originalFileSize = file.size;
  fileType = file.type;
  origSizeText.textContent = formatBytes(originalFileSize);
  
  const reader = new FileReader();
  reader.onload = (e) => {
    originalImage = new Image();
    originalImage.onload = () => {
      setupCanvas();
      dropZone.style.display = 'none';
      workspace.style.display = 'flex';
      showToast('照片載入成功！');
      updateCompressionPreview();
    };
    originalImage.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupCanvas() {
  canvas.width = originalImage.naturalWidth;
  canvas.height = originalImage.naturalHeight;
  ctx.drawImage(originalImage, 0, 0);
  // Keep active edits state
  currentImageState = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Tabs switching
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    
    tab.classList.add('active');
    const activePanel = document.getElementById(tab.dataset.panel);
    activePanel.classList.add('active');
    
    // Switch tools logic
    if (tab.dataset.panel === 'compress-panel') {
      currentTool = 'compress';
      updateCompressionPreview();
    } else {
      currentTool = toolChroma.classList.contains('active') ? 'chroma' : 'eraser';
      restoreWorkspaceState();
    }
  });
});

// Restore canvas to current edits state
function restoreWorkspaceState() {
  if (!currentImageState) return;
  canvas.width = originalImage.naturalWidth;
  canvas.height = originalImage.naturalHeight;
  ctx.putImageData(currentImageState, 0, 0);
}

// Tool Selection within Remover Panel
toolChroma.addEventListener('click', () => {
  currentTool = 'chroma';
  toolChroma.classList.add('active');
  toolEraser.classList.remove('active');
  chromaSettings.style.display = 'block';
  eraserSettings.style.display = 'none';
});

toolEraser.addEventListener('click', () => {
  currentTool = 'eraser';
  toolEraser.classList.add('active');
  toolChroma.classList.remove('active');
  chromaSettings.style.display = 'none';
  eraserSettings.style.display = 'block';
});

// Revert All Edits
btnRevert.addEventListener('click', () => {
  setupCanvas();
  showToast('已還原為原始狀態');
});

// Reset upload
btnReset.addEventListener('click', () => {
  workspace.style.display = 'none';
  dropZone.style.display = 'flex';
  fileInput.value = '';
  originalImage = null;
  currentImageState = null;
});

// Interactive operations on Canvas (Chroma / Eraser)
canvas.addEventListener('click', (e) => {
  if (currentTool !== 'chroma') return;
  
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  const x = Math.floor((e.clientX - rect.left) * scaleX);
  const y = Math.floor((e.clientY - rect.top) * scaleY);
  
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  
  const targetIdx = (y * canvas.width + x) * 4;
  const targetR = data[targetIdx];
  const targetG = data[targetIdx + 1];
  const targetB = data[targetIdx + 2];
  
  const tolerance = parseInt(chromaTolerance.value);
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Euclidean distance in RGB color space
    const distance = Math.sqrt(
      Math.pow(r - targetR, 2) +
      Math.pow(g - targetG, 2) +
      Math.pow(b - targetB, 2)
    );
    
    if (distance <= tolerance * 2.5) {
      data[i + 3] = 0; // Transparent
    }
  }
  
  ctx.putImageData(imgData, 0, 0);
  currentImageState = imgData; // Save state
  showToast('已移除指定色彩背景');
});

// Eraser Functionality
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  let clientX = e.clientX;
  let clientY = e.clientY;
  
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  }
  
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function startErase(e) {
  if (currentTool !== 'eraser') return;
  isDrawing = true;
  erase(e);
}

function erase(e) {
  if (!isDrawing || currentTool !== 'eraser') return;
  e.preventDefault();
  
  const coords = getCanvasCoords(e);
  const brushSize = parseInt(eraserBrushSize.value);
  
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(coords.x, coords.y, brushSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function stopErase() {
  if (isDrawing) {
    isDrawing = false;
    currentImageState = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
}

// Touch & Mouse Events for Eraser
canvas.addEventListener('mousedown', startErase);
canvas.addEventListener('mousemove', erase);
canvas.addEventListener('mouseup', stopErase);
canvas.addEventListener('mouseleave', stopErase);

canvas.addEventListener('touchstart', startErase, { passive: false });
canvas.addEventListener('touchmove', erase, { passive: false });
canvas.addEventListener('touchend', stopErase);

// Compression Updates
compQuality.addEventListener('input', (e) => {
  qualityVal.textContent = e.target.value + '%';
  updateCompressionPreview();
});

compScale.addEventListener('input', (e) => {
  scaleVal.textContent = e.target.value + '%';
  updateCompressionPreview();
});

compFormat.addEventListener('change', () => {
  updateCompressionPreview();
});

chromaTolerance.addEventListener('input', (e) => {
  toleranceVal.textContent = e.target.value;
});

eraserBrushSize.addEventListener('input', (e) => {
  brushVal.textContent = e.target.value + 'px';
});

// Update preview and size estimate for compression
function updateCompressionPreview() {
  if (currentTool !== 'compress' || !originalImage) return;
  
  const quality = parseInt(compQuality.value) / 100;
  const scale = parseInt(compScale.value) / 100;
  const format = compFormat.value;
  
  const w = originalImage.naturalWidth * scale;
  const h = originalImage.naturalHeight * scale;
  
  canvas.width = w;
  canvas.height = h;
  
  // Re-draw the current state (with edits) resized
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = originalImage.naturalWidth;
  tempCanvas.height = originalImage.naturalHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(currentImageState, 0, 0);
  
  ctx.drawImage(tempCanvas, 0, 0, w, h);
  
  // Calculate size
  canvas.toBlob((blob) => {
    if (blob) {
      estSizeText.textContent = formatBytes(blob.size);
    }
  }, format, quality);
}

// Download image
btnDownload.addEventListener('click', () => {
  const format = compFormat.value;
  const quality = parseInt(compQuality.value) / 100;
  
  const link = document.createElement('a');
  // Determine filename
  const formatExt = format.split('/')[1];
  link.download = `smart-edited.${formatExt}`;
  
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    showToast('檔案已成功下載！');
  }, format, quality);
});

// Byte Formatter Utility
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
