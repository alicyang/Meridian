
// Utility functions (copied from utils.js to avoid module issues)
function cosineSimilarity(a, b) {
    const va = normalizeEmbedding(a || []);
    const vb = normalizeEmbedding(b || []);
    const len = Math.min(va.length, vb.length);
    let dot = 0;
    for (let i = 0; i < len; i++) dot += va[i] * vb[i];
    return dot; // unit vectors → dot == cosine
}

function sendMessageAsync(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(response);
        });
    });
}

function normalizeEmbedding(vec) {
    if (!Array.isArray(vec) || vec.length === 0) return vec || [];
    let sum = 0;
    for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    const norm = Math.sqrt(sum) || 1;
    if (norm === 1) return vec.slice();
    const out = new Array(vec.length);
    for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
    return out;
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
                    <button id="widget-search" class="search-btn" aria-label="Search">Search</button>
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
        
        showSearchResults(`Showing ${searchMatches.length} matches`);
        
    } catch (error) {
        // Search error
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
    if (searchMatches.length === 0) {
        return;
    }
    
    clearHighlights();
    
    currentMatchIndex += direction;
    if (currentMatchIndex < 0) currentMatchIndex = searchMatches.length - 1;
    if (currentMatchIndex >= searchMatches.length) currentMatchIndex = 0;
    
    const match = searchMatches[currentMatchIndex];
    const content = JSON.parse(match.content);
    
    const element = findElementByText(content.text, match.type, content.href);
    
    if (!element) {
        showSearchResults(`Match ${currentMatchIndex + 1}/${searchMatches.length}: Element not found`);
        return;
    }
    
    // Highlight the element itself
    element.classList.add('search-match');
    
    // Find the most visible parent container to highlight
    let parent = element.parentElement;
    let mostVisibleParent = null;
    
    while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        
        // Check if parent is visible (has dimensions and is displayed)
        const isVisible = style.display !== 'none' && 
                         style.visibility !== 'hidden' &&
                         rect.width > 0 && 
                         rect.height > 0 &&
                         !parent.hasAttribute('hidden');
        
        // Prefer containers that are actually visible and have meaningful size
        if (isVisible && (rect.width > 50 || rect.height > 50)) {
            // Check if it's a container type worth highlighting
            if (parent.tagName === 'LI' || 
                parent.tagName === 'UL' || 
                parent.tagName === 'OL' ||
                parent.tagName === 'DIV' ||
                parent.classList.contains('menu') ||
                parent.classList.contains('submenu') ||
                parent.classList.contains('dropdown') ||
                parent.classList.contains('accordion') ||
                (parent.hasAttribute('role') && parent.getAttribute('role') === 'menu')) {
                mostVisibleParent = parent;
                break; // Found visible container, stop here
            }
        }
        
        parent = parent.parentElement;
    }
    
    // Highlight the most visible parent if found (in addition to the element)
    if (mostVisibleParent) {
        mostVisibleParent.classList.add('search-match', 'search-match-parent');
    }
    
    // Scroll to element
    try {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (e) {
        // Fallback: manual scroll
        const rect = element.getBoundingClientRect();
        const scrollY = window.scrollY || window.pageYOffset;
        const centerY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
        window.scrollTo({ top: Math.max(0, centerY), behavior: 'smooth' });
    }
    
    // Also scroll scrollable parent containers
    let scrollableParent = element.parentElement;
    while (scrollableParent && scrollableParent !== document.body) {
        const style = window.getComputedStyle(scrollableParent);
        if (style.overflow === 'auto' || style.overflow === 'scroll' || 
            style.overflowY === 'auto' || style.overflowY === 'scroll') {
            const parentRect = scrollableParent.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            const scrollTop = scrollableParent.scrollTop + 
                             (elementRect.top - parentRect.top) - 
                             (parentRect.height / 2) + 
                             (elementRect.height / 2);
            scrollableParent.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
        }
        scrollableParent = scrollableParent.parentElement;
    }
    
    // Remove highlights after 5 seconds
    setTimeout(() => {
        element.classList.remove('search-match');
        if (mostVisibleParent && mostVisibleParent.isConnected) {
            mostVisibleParent.classList.remove('search-match', 'search-match-parent');
        }
        document.querySelectorAll('.search-match').forEach(el => el.classList.remove('search-match'));
    }, 5000);
    
    showSearchResults(`Match ${currentMatchIndex + 1}/${searchMatches.length}: ${content.text}`);
}

function clearHighlights() {
    const highlighted = document.querySelectorAll('.search-match');
    highlighted.forEach(el => el.classList.remove('search-match'));
}

function findElementByText(text, type, href) {
    const normalize = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedText = normalize(text);
    
    if (type === 'link') {
        const links = Array.from(document.querySelectorAll('a[href]'));
        
        // Try href match first
        if (href) {
            try {
                const targetPath = new URL(href, window.location.origin).pathname.replace(/\/+$/, '');
                
                const byHref = links.find(a => {
                    const aHref = a.getAttribute('href');
                    if (!aHref) return false;
                    try {
                        const aPath = new URL(a.href).pathname.replace(/\/+$/, '');
                        return aPath === targetPath;
                    } catch {
                        return aHref.replace(/\/+$/, '') === href.replace(/\/+$/, '');
                    }
                });
                
                if (byHref) {
                    return byHref;
                }
            } catch (e) {
                // Href matching failed, fall through to text match
            }
        }
        
        // Fallback to text match (handles nested structures like <a><h3>Text</h3></a>)
        const byText = links.find(a => {
            const aText = normalize(a.innerText);
            return aText === normalizedText;
        });
        
        return byText;
    }
    
    if (type === 'header') {
        const headers = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        const found = headers.find(h => normalize(h.innerText) === normalizedText);
        return found;
    }
    
    return null;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        injectWidget();
    });
} else {
    injectWidget();
}

setTimeout(() => {
    injectWidget();
}, 1000);

// Listen for navigation changes (for SPAs)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(injectWidget, 500);
    }
}).observe(document, { subtree: true, childList: true });


/* ***explain_in_context*** */

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    switch (request.action) {
      case 'showInlineExplanation':
        if (window.showInlineLoadingTooltip) {
          window.showInlineLoadingTooltip(request.text);
        }
        handleInlineExplanation(request.text);
        break;
        case 'showInlineLoadingTooltip':
          if (window.showInlineLoadingTooltip) {
            window.showInlineLoadingTooltip(request.text);
          }
          break;
    
        case 'showInlineExplanationTooltip':
          if (window.showInlineExplanationTooltip) {
            window.showInlineExplanationTooltip(request.text, request.explanation);
          }
          break;
        
        case 'getStoredSelection':
          sendResponse({text: selectedText});
          break;
    
      case 'showInlineErrorTooltip':
          if (window.showInlineErrorTooltip) {
            window.showInlineErrorTooltip(request.text, request.error);
          }
          break;
      
      case 'performWidgetSearch':
          (async () => {
              const panel = document.getElementById('widget-panel');
              const input = document.getElementById('widget-input');
              if (panel) panel.style.display = 'block';
              if (input && request.displayText) {
                  input.value = request.displayText;
              }
              await performSearch(request.query);
              if (searchMatches.length > 0) {
                  navigateToMatch(1);
              }
          })();
          break;
      default:
        
    }
});

// Open PDF in the custom viewer
function openPDFInViewer(pdfUrl) {
    chrome.runtime.sendMessage({
        action: "openPdfViewer",
        pdfUrl
    }).catch(() => {});
}

// Check if URL is a PDF
function isPdfUrl(url) {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    // Check for .pdf extension (handles query params too)
    return lowerUrl.includes('.pdf');
}

// Intercept default PDF function when side panel open
// Use capture phase to catch events early, before navigation
document.addEventListener('click', async (event) => {
    const target = event.target;
    const link = target.closest('a');
  
    if (link && link.href) {
        try {
            const result = await chrome.storage.sync.get(['analyzePDFs']);
            // Default to true if not set (matches panel.js default behavior)
            if (result.analyzePDFs !== false && isPdfUrl(link.href)) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                openPDFInViewer(link.href);
            }
        } catch (error) {
            // Error checking PDF setting
        }
    }
}, true); // Use capture phase to intercept early

async function handleInlineExplanation(text) {
    try {
      chrome.runtime.sendMessage({
        action: 'explainText',
        text: text
      });
    } catch (error) {
      // Error sending message
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
      positionInlineTooltip();
    }
});

// Handle window resize
window.addEventListener('resize', () => {
    if (currentTooltip) {
      positionInlineTooltip();
    }
  });









