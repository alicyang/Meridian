console.log("Content script starting...");

// Utility functions (copied from utils.js to avoid module issues)
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] ** 2;
        normB += b[i] ** 2;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function sendMessageAsync(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(response);
        });
    });
}

const widgetHTML = `
    <div id="search-widget">
        <button id="widget-search-button">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21L16.514 16.506L21 21ZM19 10.5C19 15.194 15.194 19 10.5 19C5.806 19 2 15.194 2 10.5C2 5.806 5.806 2 10.5 2C15.194 2 19 5.806 19 10.5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
        <div id="widget-panel">
            <div id="widget-header">
                <div class="search-container">
                    <input type="text" id="widget-input" placeholder="Search in page...">
                    <button id="widget-search" class="search-btn">Search</button>
                </div>
                <div class="widget-buttons">
                    <button id="widget-prev" class="widget-btn">Prev</button>
                    <button id="widget-next" class="widget-btn">Next</button>
                    <button id="widget-panel-close" class="widget-btn">Close</button>
                </div>
            </div>
            <div id="widget-results"></div>
        </div>
    </div>
`;

let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function injectWidget() {
    if (document.getElementById('search-widget')) return;
    
    document.body.insertAdjacentHTML('beforeend', widgetHTML);
    setupWidgetEventListeners();
    setupDragFunctionality();
}

function setupWidgetEventListeners() {
    const searchButton = document.getElementById('widget-search-button');
    const panel = document.getElementById('widget-panel');
    const closeButton = document.getElementById('widget-panel-close');
    const input = document.getElementById('widget-input');
    const searchBtn = document.getElementById('widget-search');
    const prevBtn = document.getElementById('widget-prev');
    const nextBtn = document.getElementById('widget-next');
    
    searchButton?.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    
    closeButton?.addEventListener('click', () => {
        panel.style.display = 'none';
    });
    
    const handleSearch = async () => {
        const query = input.value.trim();
        if (query) {
            await performSearch(query);
        }
    };
    
    input?.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            await handleSearch();
        }
    });
    
    searchBtn?.addEventListener('click', handleSearch);
    
    prevBtn?.addEventListener('click', () => {
        navigateToMatch(-1);
    });
    
    nextBtn?.addEventListener('click', () => {
        navigateToMatch(1);
    });
}

function setupDragFunctionality() {
    const widget = document.getElementById('search-widget');
    const searchButton = document.getElementById('widget-search-button');
    
    if (!widget || !searchButton) return;
    
    let isMouseDown = false;
    let dragStarted = false;
    let startX, startY;
    
    function handleMouseDown(e) {
        isMouseDown = true;
        dragStarted = false;
        startX = e.clientX || e.touches[0].clientX;
        startY = e.clientY || e.touches[0].clientY;
    }
    
    function handleMouseMove(e) {
        if (!isMouseDown) return;
        
        const currentX = e.clientX || e.touches[0].clientX;
        const currentY = e.clientY || e.touches[0].clientY;
        const deltaX = Math.abs(currentX - startX);
        const deltaY = Math.abs(currentY - startY);
        
        if (!dragStarted && (deltaX > 5 || deltaY > 5)) {
            dragStarted = true;
            isDragging = true;
            widget.style.cursor = 'grabbing';
            searchButton.style.pointerEvents = 'none';
        }
        
        if (dragStarted) {
            e.preventDefault();
            const rect = widget.getBoundingClientRect();
            const newX = currentX - rect.width / 2;
            const newY = currentY - rect.height / 2;
            const maxX = window.innerWidth - rect.width;
            const maxY = window.innerHeight - rect.height;
            
            widget.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
            widget.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
            widget.style.right = 'auto';
        }
    }
    
    function handleMouseUp() {
        if (isDragging) {
            isDragging = false;
            widget.style.cursor = 'move';
            searchButton.style.pointerEvents = 'auto';
        }
        
        isMouseDown = false;
        dragStarted = false;
        
        // Get selected text for explain_in_context
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            lastSelectionRect = selection.getRangeAt(0).getBoundingClientRect();
            selectedText = selection.toString().trim();
        }
    }
    
    searchButton.addEventListener('mousedown', handleMouseDown);
    searchButton.addEventListener('touchstart', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);
}

// Search functionality
let searchMatches = [];
let currentMatchIndex = -1;

async function performSearch(query) {
    if (!query) return;
    
    // Clear any existing highlights
    clearHighlights();
    
    const searchBtn = document.getElementById('widget-search');
    const input = document.getElementById('widget-input');
    
    // Show loading state
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    input.disabled = true;
    showSearchResults('Searching...');
    
    try {
        // Get embeddings for current page
        const resp = await sendMessageAsync({ 
            type: "FETCH_DB_EMBEDDING", 
            url: window.location.href 
        });
        let storedEmbeddings = resp.embeddings || [];
        
        if (storedEmbeddings.length === 0) {
            showSearchResults("Page not processed yet. Processing page data...");
            
            // Try to trigger page processing
            try {
                await sendMessageAsync({ 
                    type: "PROCESS_PAGE", 
                    url: window.location.href 
                });
                
                // Wait a moment for processing to complete
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Try to fetch embeddings again
                const retryResp = await sendMessageAsync({ 
                    type: "FETCH_DB_EMBEDDING", 
                    url: window.location.href 
                });
                const retryEmbeddings = retryResp.embeddings || [];
                
                if (retryEmbeddings.length === 0) {
                    showSearchResults("Still processing... Please wait a moment and try again.");
                    return;
                }
                
                // Use the retry embeddings
                storedEmbeddings = retryEmbeddings;
                showSearchResults("Page processed! Searching...");
                
            } catch (error) {
                showSearchResults("Unable to process page. Please refresh and try again.");
                return;
            }
        }
        
        // Get embedding for search query
        const queryResp = await sendMessageAsync({ 
            type: "EMBEDDING_REQUEST", 
            text: query 
        });
        const queryEmbedding = queryResp.embedding;
        
        // Find matches using cosine similarity
        const matches = storedEmbeddings.map(stored => {
            const storedVector = JSON.parse(stored.embedding);
            const similarity = cosineSimilarity(queryEmbedding, storedVector);
            return { ...stored, similarity };
        });
        
        matches.sort((a, b) => b.similarity - a.similarity);
        searchMatches = matches.slice(0, 10);
        currentMatchIndex = -1;
        
        showSearchResults(`Found ${searchMatches.length} matches`);
        
    } catch (error) {
        console.error("Search error:", error);
        showSearchResults("Search failed");
    } finally {
        // Reset button state
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
        input.disabled = false;
    }
}

function showSearchResults(message) {
    const results = document.getElementById('widget-results');
    results.textContent = message;
}

function navigateToMatch(direction) {
    if (searchMatches.length === 0) return;
    
    // Clear previous highlights
    clearHighlights();
    
    currentMatchIndex += direction;
    if (currentMatchIndex < 0) currentMatchIndex = searchMatches.length - 1;
    if (currentMatchIndex >= searchMatches.length) currentMatchIndex = 0;
    
    const match = searchMatches[currentMatchIndex];
    const content = JSON.parse(match.content);
    
    const element = findElementByText(content.text, match.type);
    if (element) {
        // Add highlighting class
        element.classList.add('search-match');
        
        // Scroll to element with some padding
        element.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
        });
        
        // Auto-remove highlight after 5 seconds
        setTimeout(() => {
            element.classList.remove('search-match');
        }, 5000);
    }
    
    showSearchResults(`Match ${currentMatchIndex + 1}/${searchMatches.length}: ${content.text}`);
}

function clearHighlights() {
    const highlighted = document.querySelectorAll('.search-match');
    highlighted.forEach(el => el.classList.remove('search-match'));
}

function findElementByText(text, type) {
    if (type === 'link') {
        return Array.from(document.querySelectorAll('a')).find(a => 
            a.innerText.trim() === text
        );
    } else if (type === 'header') {
        return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(h => 
            h.innerText.trim() === text
        );
    }
    return null;
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









