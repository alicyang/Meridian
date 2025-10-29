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

// Chat message helpers
function addMessage(content, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = content;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addAssistantMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.innerHTML = content;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearChat() {
    chatMessages.innerHTML = '';
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
                role: "system",
                content:
                    "You are a helpful and friendly assistant who understands that the user may not be a native English speaker." +
                    "You will use context provided to you about the webpage a user is currently on to craft concise and most likely responses.",
            },
        ],
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
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
        while (!sessionIsReady) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
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
        while (modelIsBusy) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        modelIsBusy = true;
        const stream = currSearchSession.promptStreaming([
            { role: "user", content: inputValue },
            {
                role: "assistant",
                content: `I will answer the user's question based on the following top matches:
                    \n${JSON.stringify(topMatches)}\n
                    I will select the top 3-6 most relevant options and provide concise explanations.`
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
    } catch (error) {
        console.error('Search error:', error);
        assistantMessageDiv.innerHTML = '<p>Sorry, there was an error processing your request.</p>';
    } finally {
        submitBtn.disabled = false;
        modelIsBusy = false;
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
        while (searchModel == null) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
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
    
    while (modelIsBusy) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    currSearchSession = searchSession
    currSearchURL = url;
}

// TODO add some error handling
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    switch (message.type) {
        case "SWAP_SEARCH_SESSION":
            sessionIsReady = false;
            smartSearchDiv.style.display = "block";
            notAvailableDiv.style.display = "none";
            clearChat();
            addMessage("Hello! I can help you search and understand content on this page. What would you like to know?", 'assistant');
            await setSearchSession(message.url);
            sessionIsReady = true;
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
});

// Load user settings from storage
async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'targetLanguage',
        'preferredAI',
        'textsExplained',
        'analyzePDFs'
      ]);
      
      // Set target language
      const targetLanguageSelect = document.getElementById('targetLanguage');
      if (targetLanguageSelect) {
        targetLanguageSelect.value = result.targetLanguage || 'en';
      }
  
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
    // Target language change
    const targetLanguageSelect = document.getElementById('targetLanguage');
    if (targetLanguageSelect) {
      targetLanguageSelect.addEventListener('change', async (e) => {
        await saveSetting('targetLanguage', e.target.value);
      });
    }
  
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

// Handle popup close
window.addEventListener('beforeunload', () => {
    // Save any pending changes
    const targetLanguage = document.getElementById('targetLanguage').value;
    
    chrome.storage.sync.set({
      targetLanguage: targetLanguage,
    });
});





  


