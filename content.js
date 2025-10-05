// Content script for HelpMyMom extension
// Handles text selection, tooltip display, and user interactions

console.log('HelpMyMom content script loaded!');

let currentTooltip = null;
let selectedText = '';

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
    default:
      console.log('Unknown action:', request.action);
  }
});


// Show loading state while AI processes
function showLoadingTooltip(text) {
  selectedText = text;
  removeExistingTooltip();
  
  currentTooltip = createTooltip(`
    <div class="helpmymom-tooltip loading">
      <div class="tooltip-header">
        <span class="tooltip-icon">🤖</span>
        <span class="tooltip-title">Explaining...</span>
      </div>
      <div class="tooltip-content">
        <div class="loading-spinner"></div>
        <p>AI is analyzing your text...</p>
      </div>
    </div>
  `);
  
  positionTooltip();
}

// Show explanation tooltip
function showExplanationTooltip(originalText, explanation) {
  removeExistingTooltip();
  
  currentTooltip = createTooltip(`
    <div class="helpmymom-tooltip explanation">
      <div class="tooltip-header">
        <span class="tooltip-icon">💡</span>
        <span class="tooltip-title">Explanation</span>
        <button class="close-btn" id="close-btn">×</button>
      </div>
      <div class="tooltip-content">
        <div class="original-text">
          <strong>Selected text:</strong>
          <p>"${originalText}"</p>
        </div>
        <div class="explanation-text">
          <strong>Simple explanation:</strong>
          <p>${explanation}</p>
        </div>
        <div class="tooltip-actions">
          <button class="action-btn" id="better-explanation-btn">
            Get better explanation
          </button>
          <button class="action-btn secondary" id="close-tooltip-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  `);
  
  // Add event listeners for buttons
  setupTooltipEventListeners();
  
  positionTooltip();
}

// Show error tooltip
function showErrorTooltip(text, errorMessage) {
  removeExistingTooltip();
  
  // Add helpful instructions for Chrome Built-in AI
  let helpText = '';
  if (errorMessage.includes('Chrome Built-in AI is not available')) {
    helpText = `
      <div class="help-section">
        <strong>How to enable Chrome Built-in AI:</strong>
        <ol>
          <li>Update Chrome to version 126 or later</li>
          <li>Go to <code>chrome://flags/</code></li>
          <li>Search for "AI" and enable AI features</li>
          <li>Restart Chrome and try again</li>
        </ol>
      </div>
    `;
  }
  
  currentTooltip = createTooltip(`
    <div class="helpmymom-tooltip error">
      <div class="tooltip-header">
        <span class="tooltip-icon">⚠️</span>
        <span class="tooltip-title">Error</span>
        <button class="close-btn" id="close-btn">×</button>
      </div>
      <div class="tooltip-content">
        <p>${errorMessage}</p>
        ${helpText}
        <div class="tooltip-actions">
          <button class="action-btn" id="try-again-btn">
            Try again
          </button>
        </div>
      </div>
    </div>
  `);
  
  // Add event listeners for buttons
  setupTooltipEventListeners();
  
  positionTooltip();
}

// Create tooltip element
function createTooltip(html) {
  const tooltip = document.createElement('div');
  tooltip.innerHTML = html;
  tooltip.className = 'helpmymom-tooltip-container';
  document.body.appendChild(tooltip);
  return tooltip;
}

// Position tooltip near selected text
function positionTooltip() {
  if (!currentTooltip) return;
  
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return;
  
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  const tooltip = currentTooltip.querySelector('.helpmymom-tooltip');
  const tooltipRect = tooltip.getBoundingClientRect();
  
  // Position tooltip above selection, centered
  let top = rect.top - tooltipRect.height - 10;
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  
  // Adjust if tooltip goes off screen
  if (top < 10) {
    top = rect.bottom + 10; // Show below instead
  }
  
  if (left < 10) {
    left = 10;
  } else if (left + tooltipRect.width > window.innerWidth - 10) {
    left = window.innerWidth - tooltipRect.width - 10;
  }
  
  tooltip.style.position = 'fixed';
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.style.zIndex = '10000';
}

// Remove existing tooltip
function removeExistingTooltip() {
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
}

// Setup event listeners for tooltip buttons
function setupTooltipEventListeners() {
  if (!currentTooltip) return;
  
  // Close button (X)
  const closeBtn = currentTooltip.querySelector('#close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      removeExistingTooltip();
    });
  }
  
  // Close tooltip button
  const closeTooltipBtn = currentTooltip.querySelector('#close-tooltip-btn');
  if (closeTooltipBtn) {
    closeTooltipBtn.addEventListener('click', () => {
      removeExistingTooltip();
    });
  }
  
  // Try again button
  const tryAgainBtn = currentTooltip.querySelector('#try-again-btn');
  if (tryAgainBtn) {
    tryAgainBtn.addEventListener('click', async () => {
      removeExistingTooltip();
      // Trigger the explanation again
      if (selectedText) {
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'explainText',
            text: selectedText
          });
          console.log('Try again response:', response);
        } catch (error) {
          console.error('Try again error:', error);
          // Show error tooltip if the message fails
          showErrorTooltip(selectedText, `Failed to retry explanation: ${error.message}`);
        }
      }
    });
  }
  
  // Better explanation button
  const betterExplanationBtn = currentTooltip.querySelector('#better-explanation-btn');
  if (betterExplanationBtn) {
    betterExplanationBtn.addEventListener('click', async () => {
      if (selectedText) {
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'explainText',
            text: selectedText,
            useRemote: true
          });
          console.log('Better explanation response:', response);
        } catch (error) {
          console.error('Better explanation error:', error);
          // Show error tooltip if the message fails
          showErrorTooltip(selectedText, `Failed to get better explanation: ${error.message}`);
        }
      }
    });
  }
}

// Clean up tooltips when page changes
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
    positionTooltip();
  }
});

// Handle window resize
window.addEventListener('resize', () => {
  if (currentTooltip) {
    positionTooltip();
  }
});
