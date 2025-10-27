console.log("Content script starting...");

const widgetHTML = `
    <div id="search-widget" style="position: fixed; top: 20px; right: 20px; z-index: 9999; cursor: move;">
        <button id="widget-search-button" style="width: 50px; height: 50px; border-radius: 50%; background: #007bff; border: none; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21L16.514 16.506L21 21ZM19 10.5C19 15.194 15.194 19 10.5 19C5.806 19 2 15.194 2 10.5C2 5.806 5.806 2 10.5 2C15.194 2 19 5.806 19 10.5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>

        <div id="widget-panel" style="display: none; position: absolute; top: 60px; right: 0; width: 300px; background: white; border: 1px solid #ccc; box-shadow: 0px 2px 10px rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; box-sizing: border-box;">
            <div id="widget-header" style="box-sizing: border-box;">
                <input type="text" id="widget-input" placeholder="Search in page..." style="width: 100%; padding: 8px 12px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button id="widget-prev" style="padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa; cursor: pointer; font-size: 12px; flex: 1; min-width: 60px;">Prev</button>
                    <button id="widget-next" style="padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa; cursor: pointer; font-size: 12px; flex: 1; min-width: 60px;">Next</button>
                    <button id="widget-panel-close" style="padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa; cursor: pointer; font-size: 12px; flex: 1; min-width: 60px;">Close</button>
                </div>
            </div>
            <div id="widget-results" style="margin-top: 10px; max-height: 200px; overflow-y: auto;"></div>
        </div>
    </div>
`;

let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function injectWidget() {
    console.log("injectWidget called, document.body exists:", !!document.body);
    
    // Check if widget already exists
    if (document.getElementById('search-widget')) {
        console.log("Widget already exists, skipping injection");
        return;
    }
    
    console.log("Injecting search widget");
    document.body.insertAdjacentHTML('beforeend', widgetHTML);
    
    // Add event listeners
    setupWidgetEventListeners();
    setupDragFunctionality();
    console.log("Widget injection complete");
}

function setupWidgetEventListeners() {
    console.log("Setting up event listeners");
    const searchButton = document.getElementById('widget-search-button');
    const panel = document.getElementById('widget-panel');
    const closeButton = document.getElementById('widget-panel-close');
    
    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            // Prevent drag when clicking the button
            e.stopPropagation();
            console.log("Search button clicked");
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });
    }
    
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            console.log("Close button clicked");
            panel.style.display = 'none';
        });
    }
}

function setupDragFunctionality() {
    const widget = document.getElementById('search-widget');
    const searchButton = document.getElementById('widget-search-button');
    
    if (!widget || !searchButton) return;
    
    // Mouse events for dragging
    searchButton.addEventListener('mousedown', (e) => {
        // Only start drag if it's not a click (prevent accidental drags)
        const startTime = Date.now();
        const startX = e.clientX;
        const startY = e.clientY;
        
        const handleMouseMove = (e) => {
            const currentTime = Date.now();
            const deltaX = Math.abs(e.clientX - startX);
            const deltaY = Math.abs(e.clientY - startY);
            
            // Start dragging if mouse moved more than 5px or held for more than 200ms
            if (deltaX > 5 || deltaY > 5 || (currentTime - startTime) > 200) {
                if (!isDragging) {
                    isDragging = true;
                    widget.style.cursor = 'grabbing';
                    searchButton.style.pointerEvents = 'none';
                }
                
                const rect = widget.getBoundingClientRect();
                const newX = e.clientX - rect.width / 2;
                const newY = e.clientY - rect.height / 2;
                
                // Keep widget within viewport bounds
                const maxX = window.innerWidth - rect.width;
                const maxY = window.innerHeight - rect.height;
                
                widget.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
                widget.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
                widget.style.right = 'auto';
            }
        };
        
        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                widget.style.cursor = 'move';
                searchButton.style.pointerEvents = 'auto';
            }
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            /* explain_in_context get selected text from user */
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                lastSelectionRect = selection.getRangeAt(0).getBoundingClientRect();
                selectedText = selection.toString().trim(); // Store the text
            }
        };
                
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });
    
    // Touch events for mobile dragging
    searchButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const startTime = Date.now();
        const startX = touch.clientX;
        const startY = touch.clientY;
        
        const handleTouchMove = (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const currentTime = Date.now();
            const deltaX = Math.abs(touch.clientX - startX);
            const deltaY = Math.abs(touch.clientY - startY);
            
            if (deltaX > 5 || deltaY > 5 || (currentTime - startTime) > 200) {
                if (!isDragging) {
                    isDragging = true;
                    widget.style.cursor = 'grabbing';
                    searchButton.style.pointerEvents = 'none';
                }
                
                const rect = widget.getBoundingClientRect();
                const newX = touch.clientX - rect.width / 2;
                const newY = touch.clientY - rect.height / 2;
                
                const maxX = window.innerWidth - rect.width;
                const maxY = window.innerHeight - rect.height;
                
                widget.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
                widget.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
                widget.style.right = 'auto';
            }
        };
        
        const handleTouchEnd = () => {
            if (isDragging) {
                isDragging = false;
                widget.style.cursor = 'move';
                searchButton.style.pointerEvents = 'auto';
            }
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };
        
        document.addEventListener('touchmove', handleTouchMove);
        document.addEventListener('touchend', handleTouchEnd);
    });
}

console.log("Document ready state:", document.readyState);

// Try multiple injection strategies
if (document.readyState === 'loading') {
    console.log("Document still loading, waiting for DOMContentLoaded");
    document.addEventListener('DOMContentLoaded', () => {
        console.log("DOMContentLoaded fired");
        injectWidget();
    });
} else {
    console.log("Document already loaded, injecting immediately");
    injectWidget();
}

// Also try after a short delay to catch dynamic content
setTimeout(() => {
    console.log("Timeout injection attempt");
    injectWidget();
}, 1000);

// Listen for navigation changes (for SPAs)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        console.log("URL changed, re-injecting widget");
        lastUrl = url;
        setTimeout(injectWidget, 500);
    }
}).observe(document, { subtree: true, childList: true });

console.log("Content script setup complete");

/* ***explain_in_context*** */

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request);
    console.log('Sender:', sender);
    
    switch (request.action) {
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

// Open PDF in the custom viewer
function openPDFInViewer(pdfUrl) {
    chrome.runtime.sendMessage({
        action: "openPdfViewer",
        pdfUrl
      });
    
}

// Intercept default PDF function when side panel open
document.addEventListener('click', async (event) => {
    const target = event.target;
    const link = target.closest('a');
  
    if (link && link.href) {
        const result = await chrome.storage.sync.get(['analyzePDFs']);
        if (result.analyzePDFs && link.href.toLowerCase().endsWith('.pdf')) {
          event.preventDefault();
          event.stopPropagation();
          openPDFInViewer(link.href);
        }
      }
})

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









