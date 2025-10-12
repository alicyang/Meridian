// Content script for HelpMyMom extension
// Handles text selection, tooltip display, and user interactions

console.log('HelpMyMom content script loaded!');

let currentTooltip = null;
let selectedText = '';

function formatTextForTooltip(text) {
  return text
    .replace(/\n\n/g, '<br><br>') // preserve paragraph breaks
    .replace(/\n/g, '<br>');      // single line breaks
}

// Third-party Origin Trial token for content script (you'll need to get this separately)
const THIRD_PARTY_TOKEN = "A9MnSBAMijg6fw2OqxYOjhIPOi2IrmNIzoNRWqzGPRFPYtGlezUKQ1dtf5Wm/nEceqENv1WHE3Cd1SksdhzMRQ4AAACMeyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vYXBqY3Bvb2ppZWxpZGRnbmlqZXBkbGdscGNoY2dsY28iLCJmZWF0dXJlIjoiQUlQcm9tcHRBUElGb3JFeHRlbnNpb24iLCJleHBpcnkiOjE3NjA0ODYzOTksImlzVGhpcmRQYXJ0eSI6dHJ1ZX0="; // Set this when you get the third-party token

// Inject Origin Trial token for content script context
function injectOriginTrialToken(token) {
  if (!token || !document.head) return;
  
  // Check if token already exists
  const existing = document.head.querySelector('meta[http-equiv="origin-trial"]');
  if (existing?.content === token) return;
  
  // Remove existing token if different
  if (existing) existing.remove();
  
  // Inject new token
  const meta = document.createElement('meta');
  meta.httpEquiv = 'origin-trial';
  meta.content = token;
  document.head.appendChild(meta);
  
  console.log('Origin Trial token injected for content script');
}

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
    default:
      console.log('Unknown action:', request.action);
  }
});

function handleInlineExplanation(text) {
  chrome.runtime.sendMessage({
    action: 'explainText',
    text: text
  });
}

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

// Show inline loading tooltip (Wikipedia-style)
function showInlineLoadingTooltip(text) {
  selectedText = text;
  removeExistingTooltip();
  
  currentTooltip = createInlineTooltip(`
    <div class="helpmymom-inline-tooltip loading">
      <div class="inline-tooltip-header">
        <div class="inline-tooltip-icon">🤖</div>
        <div class="inline-tooltip-title">HelpMyMom</div>
        <div class="inline-tooltip-subtitle">AI Assistant</div>
      </div>
      <div class="inline-tooltip-content">
        <div class="loading-spinner"></div>
        <p>Analyzing your text...</p>
      </div>
    </div>
  `);
  
  positionInlineTooltip();
}

// Show inline explanation tooltip (Wikipedia-style)
function showInlineExplanationTooltip(originalText, explanation) {
  removeExistingTooltip();
  
  currentTooltip = createInlineTooltip(`
    <div class="helpmymom-inline-tooltip explanation">
      <div class="inline-tooltip-header">
        <div class="inline-tooltip-icon">💡</div>
        <div class="inline-tooltip-title">Simple Explanation</div>
        <div class="inline-tooltip-subtitle">HelpMyMom AI</div>
      </div>
      <div class="inline-tooltip-content">
        <div class="original-text-section">
          <strong>Selected text:</strong>
          <p>"${originalText}"</p>
        </div>
        <div class="explanation-section">
          <strong>Simple explanation:</strong>
          <p>${formatTextForTooltip(explanation)}</p>
        </div>
      </div>
      <div class="inline-tooltip-footer">
        <button class="inline-close-btn" id="inline-close-btn">×</button>
      </div>
    </div>
  `);
  
  setupInlineTooltipEventListeners();
  positionInlineTooltip();
}

// Show inline error tooltip (Wikipedia-style)
function showInlineErrorTooltip(text, errorMessage) {
  removeExistingTooltip();
  
  currentTooltip = createInlineTooltip(`
    <div class="helpmymom-inline-tooltip error">
      <div class="inline-tooltip-header">
        <div class="inline-tooltip-icon">⚠️</div>
        <div class="inline-tooltip-title">Error</div>
        <div class="inline-tooltip-subtitle">HelpMyMom AI</div>
      </div>
      <div class="inline-tooltip-content">
        <p>${errorMessage}</p>
        <div class="help-section">
          <strong>Try this instead:</strong>
          <ol>
            <li>Use the extension popup to download the AI model first</li>
            <li>Make sure you have Chrome 126+ with AI features enabled</li>
            <li>Try again after the model is downloaded</li>
          </ol>
        </div>
      </div>
      <div class="inline-tooltip-footer">
        <button class="inline-close-btn" id="inline-close-btn">×</button>
      </div>
    </div>
  `);
  
  setupInlineTooltipEventListeners();
  positionInlineTooltip();
}

// Create inline tooltip element
function createInlineTooltip(html) {
  const tooltip = document.createElement('div');
  tooltip.innerHTML = html;
  tooltip.className = 'helpmymom-inline-tooltip-container';
  document.body.appendChild(tooltip);
  return tooltip;
}

// Position inline tooltip near selected text
function positionInlineTooltip() {
  if (!currentTooltip) return;
  
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return;
  
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  const tooltip = currentTooltip.querySelector('.helpmymom-inline-tooltip');
  const tooltipRect = tooltip.getBoundingClientRect();
  
  // Position tooltip above selection, centered
  let top = rect.top - tooltipRect.height - 15;
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  
  // Adjust if tooltip goes off screen
  if (top < 10) {
    top = rect.bottom + 15; // Show below instead
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

// Setup event listeners for inline tooltip buttons
function setupInlineTooltipEventListeners() {
  if (!currentTooltip) return;
  
  // Close button
  const closeBtn = currentTooltip.querySelector('#inline-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      removeExistingTooltip();
    });
  }
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
          <p>${formatTextForTooltip(explanation)}</p>
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
    positionTooltip();
  }
});

// Handle window resize
window.addEventListener('resize', () => {
  if (currentTooltip) {
    positionTooltip();
  }
});
