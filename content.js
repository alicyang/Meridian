// Content script for HelpMyMom extension

console.log('HelpMyMom content script loaded!');

document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    lastSelectionRect = selection.getRangeAt(0).getBoundingClientRect();
    selectedText = selection.toString().trim(); // Store the text
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  console.log('Sender:', sender);
  
  switch (request.action) {
    case 'showLoading':
      console.log('Showing loading tooltip for:', request.text);
      showLoadingTooltip(request.text);
      break;
    case 'showExplanation':
      console.log('Showing explanation tooltip for:', request.text);
      showExplanationTooltip(request.text, request.explanation);
      break;
    case 'showError':
      console.log('Showing error tooltip for:', request.text);
      showErrorTooltip(request.text, request.error);
      break;
    case 'showInlineExplanation':
      console.log('Showing inline explanation for:', request.text);
      handleInlineExplanation(request.text);
      break;
      case 'showInlineLoadingTooltip':
        console.log('Showing inline loading tooltip for:', request.text);
        showInlineLoadingTooltip(request.text);
        break;
  
      case 'showInlineExplanationTooltip':
        console.log('Showing inline explanation tooltip for:', request.text);
        showInlineExplanationTooltip(request.text, request.explanation);
        break;
      
      case 'getStoredSelection':
        console.log('Sending text to popup file:', request.text);
        sendResponse({text: selectedText});
        break;
  
      case 'showInlineErrorTooltip':
        console.log('Showing inline error tooltip for:', request.text);
        showInlineErrorTooltip(request.text, request.error);
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
    removeExistingTooltip();
  }
});

// Handle escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentTooltip) {
    removeExistingTooltip();
  }
});

// Handle scroll to reposition tooltip
window.addEventListener('scroll', () => {
  if (currentTooltip) {
    positionInlineTooltip();
  }
});

// Handle window resize
window.addEventListener('resize', () => {
  if (currentTooltip) {
    positionInlineTooltip();
  }
});
