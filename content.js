// Content script for HelpMyMom extension

let module = null;
(async function init() {
  module = await import('./shared/tooltip.js');
  console.log('Module loaded');
  /* so the function calls itself () */
})();

console.log('HelpMyMom content script loaded!');

let currentTooltip = null;
let lastSelectionRect = null;
let lastSelectedText = '';

document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    lastSelectionRect = selection.getRangeAt(0).getBoundingClientRect();
    lastSelectedText = selection.toString().trim(); // Store the text
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  console.log('Sender:', sender);
  
  switch (request.action) {
    case 'showLoading':
      console.log('Showing loading tooltip for:', request.text);
      module.showLoadingTooltip(request.text);
      break;
    case 'showExplanation':
      console.log('Showing explanation tooltip for:', request.text);
      module.showExplanationTooltip(request.text, request.explanation);
      break;
    case 'showError':
      console.log('Showing error tooltip for:', request.text);
      module.showErrorTooltip(request.text, request.error);
      break;
    case 'showInlineExplanation':
      console.log('Showing inline explanation for:', request.text);
      handleInlineExplanation(request.text);
      break;
      case 'showInlineLoadingTooltip':
        console.log('Showing inline loading tooltip for:', request.text);
        module.showInlineLoadingTooltip(request.text);
        break;
  
      case 'showInlineExplanationTooltip':
        console.log('Showing inline explanation tooltip for:', request.text);
        module.showInlineExplanationTooltip(request.text, request.explanation);
        break;
      
      case 'getStoredSelection':
        console.log('Sending text to popup file:', request.text);
        sendResponse({text: lastSelectedText});
        break;
  
      case 'showInlineErrorTooltip':
        console.log('Showing inline error tooltip for:', request.text);
        module.showInlineErrorTooltip(request.text, request.error);
        break;
    default:
      console.log('Unknown action:', request.action);
      
  }
});

async function handleInlineExplanation(text) {
  try {
    const language = await getCurrentLanguage();
    chrome.runtime.sendMessage({
      action: 'explainText',
      text: text,
      language: language
    });
  } catch (error) {
    console.error('Error getting language or sending message:', error);
    // Fallback without language
    chrome.runtime.sendMessage({
      action: 'explainText',
      text: text
    });
  }
}

// Add helper function:
async function getCurrentLanguage() {
  const result = await chrome.storage.sync.get(['targetLanguage']);
  return result.targetLanguage || 'en';
}

// Clean up tooltips when page changes (click outside to dismiss)
document.addEventListener('click', (e) => {
  if (currentTooltip && !currentTooltip.contains(e.target)) {
    module.removeExistingTooltip();
  }
});

// Handle escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentTooltip) {
    module.removeExistingTooltip();
  }
});

// Handle scroll to reposition tooltip
window.addEventListener('scroll', () => {
  if (currentTooltip) {
    module.positionTooltip();
  }
});

// Handle window resize
window.addEventListener('resize', () => {
  if (currentTooltip) {
    module.positionTooltip();
  }
});
