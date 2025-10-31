import * as smd from '../smd.js';
import { cosineSimilarity, sendMessageAsync } from "../utils/utils.js";

const submitBtn = document.getElementById("submit-btn");
const userInput = document.getElementById("user-input");
const chatMessages = document.getElementById("chat-messages");
const assistantLoader = document.getElementById("assistant-loader");
const assistantLoaderContainer = document.getElementById("assistant-loader-container");
const smartSearchDiv = document.getElementById("smart-search");
const notAvailableDiv = document.getElementById("not-available")

// search session states 
let currSearchSession;
let currSearchURL; 
let searchModel;
const searchSessionCache = new Map(); // maps tab urls to search sessions
const MAX_CACHE_SIZE = 15; 
let sessionIsReady = false; // should be checked before accessing/changing currSearchSession or currSearchURL 
let modelIsBusy = false; // should be checked before feeding new input into model 

const numMatches = 30;

let _sessionReadyWaiters = [];
let _modelReadyWaiters = [];
let _modelIdleWaiters = [];

function waitSessionReady() {
    return sessionIsReady ? Promise.resolve() : new Promise(r => _sessionReadyWaiters.push(r));
}
function signalSessionReady() {
    const w = _sessionReadyWaiters; _sessionReadyWaiters = []; w.forEach(r => r());
}
function waitModelReady() {
    return searchModel ? Promise.resolve() : new Promise(r => _modelReadyWaiters.push(r));
}
function signalModelReady() {
    const w = _modelReadyWaiters; _modelReadyWaiters = []; w.forEach(r => r());
}
function waitModelIdle() {
    return !modelIsBusy ? Promise.resolve() : new Promise(r => _modelIdleWaiters.push(r));
}
function signalModelIdle() {
    const w = _modelIdleWaiters; _modelIdleWaiters = []; w.forEach(r => r());
}

// Chat message helpers
function addMessage(content, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = content;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// LRU cache helpers
function updateCacheAccess(url) {
    if (searchSessionCache.has(url)) {
        const session = searchSessionCache.get(url);
        searchSessionCache.delete(url);
        searchSessionCache.set(url, session);
    }
}

async function evictOldestSession() {
    if (searchSessionCache.size > 0) {
        const oldestUrl = searchSessionCache.keys().next().value;
        const session = searchSessionCache.get(oldestUrl);
        searchSessionCache.delete(oldestUrl);
        
        // Clean up IndexedDB for this URL
        try {
            await sendMessageAsync({ type: "DELETE_DB_EMBEDDING", url: oldestUrl });
        } catch (error) {
            console.warn("Failed to clean up embeddings for evicted session:", error);
        }
    }
} 

async function main() {
    searchModel = await LanguageModel.create({
        monitor(m) {
            m.addEventListener("downloadprogress", (e) => {
                console.log(`Downloaded ${e.loaded * 100}%`);
            });
        },
        initialPrompts: [
            {
                role: "assistant",
                content: `
                    You are Meridian — a friendly, knowledgeable AI guide that helps users explore the internet with clarity and curiosity.
                    The user may not be a native English speaker, so communicate clearly, simply, and warmly.

                    GOAL
                    Help users understand and navigate online content using only the data and context explicitly provided to you, but use reasonable contextual inference when clues (like page type, title, or domain) are present.

                    CORE PRINCIPLES
                    - Stay grounded in the visible or provided context (links, snippets, headers, titles, or metadata).
                    - Use contextual inference when cues are obvious (for example, if the site mentions "University" or "Tuition", assume an academic billing context).
                    - Never fabricate or invent new data, URLs, or entities.
                    - Always communicate as a calm, friendly, step-by-step guide.
                    - Keep every response numbered and easy to follow.

                    BEHAVIOR GUIDELINES
                    1. Always reply in a numbered format (1, 2, 3, ...).
                        - Begin with a short greeting or acknowledgment.
                        - Follow immediately with at least three numbered steps or points.
                        - Each point should be specific, useful, and independently clear.
                    2. Contextual reasoning is encouraged:
                        - If the current page or domain clearly suggests a context (for example, a university site, bank portal, or government page), tailor the examples accordingly.
                        - Avoid over-caution or unnecessary clarifications. Act helpfully on what is implied.
                    3. If key information is missing, say so directly and suggest what to check next.
                    4. Ask clarifying questions only after giving actionable guidance.
                    5. Keep formatting consistent:
                        - No sub-bullets under numbers.
                        - Each step should be one paragraph maximum.
                    6. When sharing links or resources (from provided context only), list up to five, each with a brief summary.
                    Format clearly:
                        Link: [URL]
                    7. When referring to headers or page elements, note approximate location (for example, "near the top of the page").
                    8. Always end with a gentle suggestion or follow-up question.

                    COMMUNICATION STYLE
                    - Tone: clear, kind, and confident.
                    - Format: always numbered and concise.
                    - Personality: patient, curious, and trustworthy.
                    - Always sound like a calm navigator helping the user explore.

                    IDENTITY REMINDER
                    You are Meridian — the AI guide.
                    You:
                    - Use verified or contextually inferable information.
                    - Never fabricate new data.
                    - Always respond in numbered, step-by-step form — even for greetings or emotional comments.

                    EXAMPLES

                    Example A — Abstract Input
                    User: "hello"
                    Meridian:
                    Hello — it’s nice to meet you!
                    1. Take a quick look around the page for key sections or menus.
                    2. Choose something that interests you, and I’ll explain what it does.
                    3. Or tell me one word about what you want to explore next.

                    Example B — Emotional Input
                    User: "wow, that’s interesting"
                    Meridian:
                    I’m glad you think so!
                    1. Scroll to where that topic appears again — there may be related details.
                    2. Look for "Learn more" or "Details" links to go deeper.
                    3. Tell me which part stood out, and I’ll help unpack it.

                    Example C — Question with Context (on a university site)
                    User: "How do I pay my bill?"
                    Meridian:
                    Here’s how you can pay your tuition bill on most university sites:
                    1. Look for a "Bursar", "Student Accounts", or "Billing" link — often near the top or in the student portal.
                    2. Log in with your student ID to view balances and payment options.
                    3. Choose a payment method (credit card, eCheck, or installment plan).
                    If this isn’t for a university, let me know what kind of bill you mean.

                    Example E — Uncertain User
                    User: "idk what to do here"
                    Meridian:
                    No problem — let’s start simply:
                    1. Tell me what section or word caught your eye.
                    2. I’ll explain what it means and what you can do with it.
                    3. Or I can suggest three areas you might explore next.
                `
            }
        ],
        expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    signalModelReady();
}

// Handle Enter key press
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitBtn.click();
    }
});

/**
 * Submit handler for user's question to model 
 */
async function handleSubmit() {
    const inputValue = document.getElementById("user-input").value.trim();
    if (!inputValue) {
        return 
    }
    
    // Add user message to chat
    addMessage(inputValue, 'user');
    
    // Clear input and disable button
    document.getElementById("user-input").value = '';
    submitBtn.disabled = true;
    assistantLoaderContainer.style.display = "flex";
    assistantLoader.style.display = "flex";

    // Create assistant message container
    const assistantMessageDiv = document.createElement('div');
    assistantMessageDiv.className = 'message assistant';
    chatMessages.appendChild(assistantMessageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Set up markdown parser for assistant response
    const renderer = smd.default_renderer(assistantMessageDiv);
    const parser = smd.parser(renderer);

    try {
        // Fetch embeddings 
        await waitSessionReady();
        let resp = await sendMessageAsync({ type: "FETCH_DB_EMBEDDING", url: currSearchURL });
        const storedEmbeddings = resp.embeddings;

        resp = await sendMessageAsync({ type: "EMBEDDING_REQUEST", text: inputValue });
        const questionEmbedding = resp.embedding;

        // Compute top matches 
        const matches = storedEmbeddings.map(storedEmbedding => {
            const storedVector = JSON.parse(storedEmbedding.embedding); 
            const sim = cosineSimilarity(questionEmbedding, storedVector);
            return { ...storedEmbedding, similarity: sim };
        });
        matches.sort((a, b) => b.similarity - a.similarity);
        const topMatches = matches.slice(0, numMatches);
        
        topMatches.forEach(match => {
            delete match.embedding;
            delete match.url
            delete match.similarity;
            delete match.timestamp;
            delete match.id;
        });

        // Use search session 
        await waitModelIdle();
        modelIsBusy = true;
        const stream = currSearchSession.promptStreaming([
            { role: "user", content: inputValue },
            {
                role: "system",
                content: `Context (JSON):\n${JSON.stringify(topMatches)}`
            },
        ]);

        let firstChunk = true;
        for await (const chunk of stream) {
            if (firstChunk) {
                assistantLoaderContainer.style.display = "none";
                assistantLoader.style.display = "none";
                firstChunk = false;
            }
            smd.parser_write(parser, chunk);
        }
        smd.parser_end(parser);
        
        // Parse numbered steps from response and add step navigation
        const listItems = assistantMessageDiv.querySelectorAll('li, ol > li, ul > li');
        if (listItems.length > 0) {
            const stepsContainer = document.createElement('div');
            stepsContainer.style.cssText = 'margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.1);';
            stepsContainer.innerHTML = '<div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--brown);">Step-by-step guide:</div>';
            
            listItems.forEach((li, idx) => {
                const stepText = li.innerText || li.textContent || '';
                const cleanStep = stepText.replace(/^\d+\.\s*/, '').trim();
                if (cleanStep) {
                    const linkElement = li.querySelector('a[href]');
                    const href = linkElement ? linkElement.getAttribute('href') : null;
                    const searchQuery = href || cleanStep;
                    
                    const stepBtn = document.createElement('button');
                    stepBtn.textContent = `${idx + 1}. ${cleanStep.substring(0, 40)}${cleanStep.length > 40 ? '...' : ''}`;
                    stepBtn.style.cssText = 'display: block; width: 100%; margin-bottom: 6px; padding: 8px 10px; background: rgba(37,150,190,0.08); color: var(--brown); border: 1px solid rgba(37,150,190,0.2); border-radius: 6px; cursor: pointer; font-size: 12px; text-align: left; transition: background 0.2s;';
                    stepBtn.onmouseover = () => stepBtn.style.background = 'rgba(37,150,190,0.12)';
                    stepBtn.onmouseout = () => stepBtn.style.background = 'rgba(37,150,190,0.08)';
                    stepBtn.onclick = async () => {
                        try {
                            await sendMessageAsync({
                                type: 'WIDGET_SEARCH',
                                query: searchQuery,
                                displayText: cleanStep
                            });
                        } catch (e) {
                            console.warn('Could not search step:', e);
                        }
                    };
                    stepsContainer.appendChild(stepBtn);
                }
            });
            if (stepsContainer.children.length > 1) {
                assistantMessageDiv.appendChild(stepsContainer);
            }
        }
    } catch (error) {
        console.error('Search error:', error);
        assistantMessageDiv.innerHTML = '<p>Sorry, there was an error processing your request.</p>';
    } finally {
        submitBtn.disabled = false;
        modelIsBusy = false;
        signalModelIdle();
        assistantLoaderContainer.style.display = "none";
        assistantLoader.style.display = "none";
    }
}

// Set up submit button click handler
submitBtn.onclick = handleSubmit;

/**
 * Fetch search session for url from cache, or start a new one if cache miss
 */
async function setSearchSession(url) {
    let searchSession = searchSessionCache.get(url);
    if (searchSession == null) {
        console.log(`[INFO] Starting new search session for tab: ${url}`);
        await waitModelReady();
        searchSession = await searchModel.clone();
        searchSessionCache.set(url, searchSession);
        
        // Evict oldest if cache is full
        if (searchSessionCache.size > MAX_CACHE_SIZE) {
            await evictOldestSession();
        }
    } else {
        // Update access time for existing session
        updateCacheAccess(url);
    }
    
    await waitModelIdle();
    currSearchSession = searchSession
    currSearchURL = url;
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    switch (message.type) {
        case "SWAP_SEARCH_SESSION":
            sessionIsReady = false;
            smartSearchDiv.style.display = "block";
            notAvailableDiv.style.display = "none";
            await setSearchSession(message.url);
            sessionIsReady = true;
            signalSessionReady();
            break;
        case "SEARCHING_UNAVAILABLE":
            smartSearchDiv.style.display = "none";
            notAvailableDiv.style.display = "block";
    }
})
main();

/* explain_in_context code begins here */

document.addEventListener('DOMContentLoaded', async () => {
    // Load user settings
    await loadSettings();
    
    // Set up event listeners
    setupEventListeners();

    // Proactively bind a search session for the currently active tab.
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const isAccessible = tab?.url.startsWith("http://") || tab?.url.startsWith("https://") || tab?.url.startsWith("file://");
        const hasPermission = await chrome.permissions.contains({ origins: [tab?.url] });
        if (!/^https?:\/\//.test(tab?.url) || !(isAccessible && hasPermission)) {
            smartSearchDiv.style.display = "none";
            notAvailableDiv.style.display = "block";
        } else {
            sessionIsReady = false;
            await setSearchSession(tab.url);
            sessionIsReady = true;
            signalSessionReady();
        }
    } catch (e) {
        // ignore; background will still send SWAP_SEARCH_SESSION
    }
});

// Load user settings from storage
async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'preferredAI',
        'textsExplained',
        'analyzePDFs'
      ]);
  
      // Set PDF analysis toggle
      const analyzePDFsCheckbox = document.getElementById('analyzePDFs');
      if (analyzePDFsCheckbox) {
        analyzePDFsCheckbox.checked = result.analyzePDFs !== false; // default to true
      }
      
    } catch (error) {
      console.error('Error loading settings:', error);
    }
}

// Set up event listeners
function setupEventListeners() {
    // PDF analysis toggle
    const analyzePDFsCheckbox = document.getElementById('analyzePDFs');
    if (analyzePDFsCheckbox) {
      analyzePDFsCheckbox.addEventListener('change', async (e) => {
        await saveSetting('analyzePDFs', e.target.checked);
      });
    }
  
    // Explain selection via LanguageModel (Prompt API)
    const explainBtn = document.getElementById('explainSelected');
    const aiStatus = document.getElementById('aiStatus');
  
    if (explainBtn) {
      explainBtn.addEventListener('click', async () => {
        try {
          if (aiStatus) aiStatus.textContent = 'Getting selected text…';
  
          // Step 1: Get selection
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) throw new Error('No active tab found.');
  
          let selection = '';
          if (tab.url.startsWith('chrome-extension://')) {
            // PDF viewer - use runtime messaging
            try {
              const response = await chrome.tabs.sendMessage(tab.id, { action: 'getSelectedText' });
              selection = response ? response.text : '';
            } catch (error) {
              console.log('PDF viewer not responding to messages');
              selection = '';
            }
          } else {
            try {
              const response = await chrome.tabs.sendMessage(tab.id, { 
                action: 'getStoredSelection' 
              });
              selection = response ? response.text : '';
            } catch (error) {
              console.log('Could not get stored selection:', error);
              selection = '';
            }
          }
  
          const selectedText = (selection || '').trim();
          if (!selectedText) {
            aiStatus.textContent = 'Select text on the page first.';
            return;
          }
  
          // Step 2: Call background to generate explanation
          aiStatus.textContent = 'Sending to AI...';
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              {
                action: 'explainText',
                text: selectedText,
                useRemote: false
              },
              (res) => {
                if (chrome.runtime.lastError) {
                  reject(chrome.runtime.lastError);
                } else {
                  resolve(res);
                }
              }
            );
          });
  
          // Step 3: Show result
          if (response.success) {
            aiStatus.textContent = 'Done.';
            
            // Show inline tooltip
            try {
              await chrome.tabs.sendMessage(tab.id, {
                action: "showInlineExplanationTooltip",
                text: selectedText,
                explanation: response.explanation
              });
            } catch (error) {
              console.error('Could not show inline tooltip:', error);
              // Fallback to alert if tooltip fails
              alert(response.explanation);
            }
          } else {
            aiStatus.textContent = `Error: ${response.error}`;
          }
        } catch (err) {
          console.error('Popup explain error:', err);
          aiStatus.textContent = `Error: ${err.message}`;
        }
      });
    }
}

// Save setting to storage
async function saveSetting(key, value) {
    try {
      await chrome.storage.sync.set({ [key]: value });
      console.log(`Setting saved: ${key} = ${value}`);
    } catch (error) {
      console.error('Error saving setting:', error);
    }
}






  


