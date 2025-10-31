import * as pdfjsLib from 'pdfjs-dist';
// Import the official PDF viewer components (handles text layer + rendering)
import { EventBus, PDFPageView } from 'pdfjs-dist/web/pdf_viewer.mjs';


// Chrome extensions cannot load remote files directly,
// so use chrome.runtime.getURL() to point to our local worker file.
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf_viewer/pdf.worker.min.mjs');

const pageContainer = document.getElementById('page-container');
const pageInfo = document.getElementById('page-info'); // Displays current page info
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');

// ------------------------------
// Read the PDF file URL from query parameters
// ------------------------------
const urlParams = new URLSearchParams(window.location.search);
const pdfUrl = decodeURIComponent(urlParams.get('file'));

let pdfDoc = null;     // Will hold the loaded PDF document
let currentPage = 1;   // Track which page we’re on             
const eventBus = new EventBus();  // Internal event system PDF.js uses

// ------------------------------
// Main async function: load the PDF and render first page
// ------------------------------
(async () => {
  try {
    // Load the PDF document
    pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
    console.log(`Loaded PDF with ${pdfDoc.numPages} pages`);

    // Render the first page immediately
    await renderPage(currentPage);

    // Update toolbar display
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
  // Clear any previously rendered content
  pageContainer.innerHTML = '';

  // Fetch the requested page from the PDF
  const page = await pdfDoc.getPage(pageNum);

  // Compute scale dynamically based on container width
  const containerWidth = pageContainer.clientWidth;
  const containerHeight = pageContainer.clientHeight;
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scaleX = containerWidth / unscaledViewport.width;
  const scaleY = containerHeight / unscaledViewport.height;
  const scale = Math.min(scaleX, scaleY); // Use the smaller scale to fit both dimensions

  console.log('Container width:', pageContainer.clientWidth);

  // Get viewport (defines dimensions and scale)
  const viewport = page.getViewport({ scale });

  // Create a new PDFPageView instance (handles rendering + text layer)
  const pageView = new PDFPageView({
    container: pageContainer,   // The parent element that holds the page
    id: pageNum,                // Page ID (1-indexed)
    scale: scale,               // Zoom scale
    defaultViewport: viewport,  // PDF.js viewport for this page
    eventBus: eventBus,         // Connects internal viewer events
    textLayerMode: 2,           // Enables selectable text layer
    annotationMode: 2,          // Enables annotations (like links)
    renderer: 'canvas',         // Render to canvas
  });

  // Bind this page’s PDF data and draw it
  pageView.setPdfPage(page);
  await pageView.draw();

  const textLayer = pageView.textLayer;
  if (textLayer) {
    // Make sure text layer is visible and selectable
    textLayer.render();
  }

  // Update toolbar text
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

//make the page responsive to window resize
window.addEventListener('resize', async () => {
  if (pdfDoc) {
    await renderPage(currentPage); // Re-render with new scale
  }
});


// ------------------------------
// Handle text selection (for your AI logic later)
// ------------------------------
// When the user highlights text, this captures it so you can
// send it to your AI model for explanation or translation.
document.addEventListener('mouseup', () => {
  const selectedText = window.getSelection().toString().trim();
  if (selectedText) {
    console.log('User highlighted:', selectedText);
    // send message to background script
    chrome.runtime.sendMessage({ action: 'explainText', text: selectedText, source: 'pdf_viewer' });
  }
});

// ------------------------------
// Listen for responses from background script
// ------------------------------
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'showInlineLoadingTooltip') {
    if (window.showInlineLoadingTooltip) {
      window.showInlineLoadingTooltip(request.text);
    }
  } else if (request.action === 'showExplanation') {
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