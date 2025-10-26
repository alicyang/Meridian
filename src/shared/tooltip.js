let currentTooltip = null;
let selectedText = '';
let lastSelectionRect = null;


document.addEventListener('mouseup', () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        lastSelectionRect = selection.getRangeAt(0).getBoundingClientRect();
    }
});

function formatTextForTooltip(text) {
    return text
        .replace(/\n\n/g, '<br><br>') // preserve paragraph breaks
        .replace(/\n/g, '<br>');      // single line breaks
}

function showLoadingTooltip(text) {
    selectedText = text;
    removeExistingTooltip();

    currentTooltip = createTooltip(`
        <div class="meridian-tooltip loading">
        <div class="tooltip-header">
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

function showInlineLoadingTooltip(text) {
    selectedText = text;
    removeExistingTooltip();

    currentTooltip = createInlineTooltip(`
    <div class="meridian-inline-tooltip loading">
      <div class="inline-tooltip-header">
        <div class="inline-tooltip-title">Meridian</div>
        <div class="inline-tooltip-subtitle">AI Assistant</div>
      </div>
      <div class="inline-tooltip-content">
        <div class="loading-spinner"></div>
        <p>Analyzing your text...</p>
      </div>
    </div>
  `);

}

function showInlineExplanationTooltip(originalText, explanation) {
    removeExistingTooltip();

    currentTooltip = createInlineTooltip(`
    <div class="meridian-inline-tooltip explanation">
      <div class="inline-tooltip-header">
        <div class="inline-tooltip-title">Explanation</div>
        <div class="inline-tooltip-subtitle">Meridian</div>
      </div>
      <div class="inline-tooltip-content">
        <div class="original-text-section">
          <strong>Selected text:</strong>
          <p>"${originalText}"</p>
        </div>
        <div class="explanation-section">
          <strong>Explanation:</strong>
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

function showInlineErrorTooltip(text, errorMessage) {
    removeExistingTooltip();

    currentTooltip = createInlineTooltip(`
    <div class="meridian-inline-tooltip error">
      <div class="inline-tooltip-header">
        <div class="inline-tooltip-title">Error</div>
        <div class="inline-tooltip-subtitle">Meridian AI</div>
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

function createInlineTooltip(html) {
    const tooltip = document.createElement('div');
    tooltip.innerHTML = html;
    tooltip.className = 'meridian-inline-tooltip-container';
    document.body.appendChild(tooltip);
    return tooltip;
}

function positionInlineTooltip() {
    if (!currentTooltip) return;

    const selection = window.getSelection();
    let rect = null;

    if (selection.rangeCount > 0) {
        rect = selection.getRangeAt(0).getBoundingClientRect();
    } else if (lastSelectionRect) {
        rect = lastSelectionRect;
    } else {
        console.warn('No selection rect found; cannot position tooltip');
        return;
    }

    const tooltip = currentTooltip.querySelector('.meridian-inline-tooltip');
    if (!tooltip) {
        console.warn("Tooltip element not found — skipping position update.");
        return; // stop here safely
    }
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

function setupInlineTooltipEventListeners() {
    if (!currentTooltip) return;

    // Close button
    const closeBtn = currentTooltip.querySelector('#inline-close-btn');
    if (closeBtn) {
        // Clone the button to remove all event listeners
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

        newCloseBtn.addEventListener('click', () => {
            removeExistingTooltip();
        });
    }
}

function showExplanationTooltip(originalText, explanation) {
    removeExistingTooltip();

    currentTooltip = createTooltip(`
    <div class="meridian-tooltip explanation">
      <div class="tooltip-header">
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
    <div class="meridian-tooltip error">
      <div class="tooltip-header">
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

function createTooltip(html) {
    const tooltip = document.createElement('div');
    tooltip.innerHTML = html;
    tooltip.className = 'meridian-tooltip-container';
    document.body.appendChild(tooltip);
    return tooltip;
}

function positionTooltip() {
    if (!currentTooltip) return;

    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const tooltip = currentTooltip.querySelector('.meridian-tooltip');
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
}

export {
    showInlineExplanationTooltip,
    showInlineLoadingTooltip,
    showInlineErrorTooltip
};