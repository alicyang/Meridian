import * as pdfjsLib from './pdf.min.mjs';

// 1) Grab the URL param FIRST
const urlParams = new URLSearchParams(window.location.search);
const pdfUrl = decodeURIComponent(urlParams.get('file') || '');
console.log('PDF file URL:', pdfUrl);
if (!pdfUrl) {
  const pageContainer = document.getElementById('page-container');
  if (pageContainer) pageContainer.textContent = '⚠️ No PDF URL provided.';
  throw new Error('No URL');
}

// 2) Then configure the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('PDF_VIEWER/pdf.worker.min.mjs');
console.log('Worker source:', pdfjsLib.GlobalWorkerOptions.workerSrc);

// 3) Now safely query the DOM (these existed in your file already)
const pageContainer = document.getElementById('page-container');
const pageInfo = document.getElementById('page-info');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const canvas = document.getElementById('pdf-canvas');
const canvasCtx = canvas.getContext('2d');

let pdfDoc = null; // Will hold the loaded PDF document
let currentPage = 1; // Track which page we’re on

// ------------------------------
// Main async function: load the PDF and render first page
// ------------------------------
(async () => {
  try {
    // Ask background script to fetch PDF bytes (bypass CORS)
    const bytesResp = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'FETCH_PDF_BYTES', pdfUrl },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(res);
          }
        }
      );
    });

    if (!bytesResp?.ok) throw new Error(bytesResp?.error || 'Failed to fetch PDF');
    const uint8 = new Uint8Array(bytesResp.data);

    // Load the PDF from fetched bytes
    pdfDoc = await pdfjsLib.getDocument({ data: uint8 }).promise;
    console.log(`Loaded PDF with ${pdfDoc.numPages} pages`);

    await renderPage(currentPage);
    updatePageInfo();
  } catch (error) {
    console.error('Error loading PDF:', error);
    pageContainer.textContent = '⚠️ Failed to load PDF. Check the URL or permissions.';
  }
})();

// ------------------------------
// Function: Render a single PDF page
// ------------------------------
async function renderPage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);

  // Compute scale to fit container width
  const desiredWidth = Math.min(window.innerWidth * 0.9, 900); // up to 900px wide
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = desiredWidth / unscaledViewport.width;
  const viewport = page.getViewport({ scale });
  // Resize canvas to match the viewport
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // Render page into the canvas
  await page.render({ canvasContext: canvasCtx, viewport }).promise;

  // Render selectable text layer (universal version — works on all PDF.js builds)
try {
  const textContent = await page.getTextContent();
  const textLayerDiv = document.getElementById('text-layer');

  if (textLayerDiv) {
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;

    // Manual render loop (no need for TextLayer / TextLayerRenderTask imports)
    for (const item of textContent.items) {
      const span = document.createElement('span');
      span.textContent = item.str;
      span.style.position = 'absolute';
      span.style.whiteSpace = 'pre';
      span.style.fontSize = `${item.height}px`;
      span.style.transformOrigin = '0 0';

      // Compute transform to align text correctly
      const tx = pdfjsLib.Util.transform(
        pdfjsLib.Util.transform(viewport.transform, item.transform),
        [1, 0, 0, -1, 0, 0]
      );
      const [a, b, c, d, e, f] = tx;
      span.style.transform = `matrix(${a},${b},${c},${d},${e},${f})`;

      textLayerDiv.appendChild(span);
    }

    console.log('Rendered text layer with', textContent.items.length, 'items');
  }
} catch (e) {
  console.warn('Text layer render failed:', e);
}

  updatePageInfo();
  console.log(`Rendered page ${pageNum}`);
}

// ------------------------------
// Function: Update the toolbar info text
// ------------------------------
function updatePageInfo() {
  pageInfo.textContent = `Page ${currentPage} of ${pdfDoc.numPages}`;
}

// ------------------------------
// Event listeners for navigation
// ------------------------------
prevBtn.addEventListener('click', async () => {
  if (currentPage <= 1) return;
  currentPage--;
  await renderPage(currentPage);
});

nextBtn.addEventListener('click', async () => {
  if (currentPage >= pdfDoc.numPages) return;
  currentPage++;
  await renderPage(currentPage);
});

// Make the page responsive to window resize
window.addEventListener('resize', async () => {
  if (pdfDoc) {
    await renderPage(currentPage); // Re-render with new scale
  }
});

// ------------------------------
// Handle text selection + inline AI tooltip
// ------------------------------
let lastSelectedText = '';

document.addEventListener('mouseup', async () => {
  const selectedText = window.getSelection().toString().trim();
  if (!selectedText || selectedText === lastSelectedText) return;
  lastSelectedText = selectedText;

  console.log('User highlighted:', selectedText);

  // ✅ Show immediate loading tooltip while waiting for response
  if (window.showInlineLoadingTooltip) {
    window.showInlineLoadingTooltip(selectedText);
  }

  try {
    // Ask background to fetch AI explanation
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'explainText', text: selectedText, source: 'pdf_viewer' },
        (res) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(res);
        }
      );
    });

    // ✅ Display explanation or error
    if (response && response.explanation && window.showInlineExplanationTooltip) {
      window.showInlineExplanationTooltip(selectedText, response.explanation);
    } else if (window.showInlineErrorTooltip) {
      window.showInlineErrorTooltip(selectedText, 'No explanation available.');
    }
  } catch (error) {
    console.error('AI tooltip error:', error);
    if (window.showInlineErrorTooltip) {
      window.showInlineErrorTooltip(selectedText, 'AI service failed to respond.');
    }
  }
});

// ------------------------------
// Optional: handle messages from background if it replies asynchronously
// ------------------------------
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'showExplanation') {
    console.log('Received explanation:', request.explanation);
    if (window.showInlineExplanationTooltip) {
      window.showInlineExplanationTooltip(request.text, request.explanation);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sendResponse) => {
  if (request.action === 'getSelectedText') {
    const selectedText = window.getSelection().toString().trim();
    sendResponse({ text: selectedText });
  }
});