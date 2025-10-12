// Popup script for HelpMyMom extension
// Handles settings, statistics, and user preferences

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
      'textsExplained'
    ]);
    
    // Set target language
    const targetLanguageSelect = document.getElementById('targetLanguage');
    if (targetLanguageSelect) {
      targetLanguageSelect.value = result.targetLanguage || 'en';
    }
    
    // Set AI preference
    const localAIToggle = document.getElementById('localAI');
    if (localAIToggle) {
      const isLocal = result.preferredAI !== 'remote';
      localAIToggle.classList.toggle('active', isLocal);
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
  
  // Local AI toggle
  const localAIToggle = document.getElementById('localAI');
  if (localAIToggle) {
    localAIToggle.addEventListener('click', async () => {
      const isActive = localAIToggle.classList.contains('active');
      localAIToggle.classList.toggle('active', !isActive);
      await saveSetting('preferredAI', isActive ? 'remote' : 'local');
    });
  }

  // Explain selection via LanguageModel (Prompt API)
  const explainBtn = document.getElementById('explainSelected');
  const aiStatus = document.getElementById('aiStatus');
  if (explainBtn) {
    explainBtn.addEventListener('click', async () => {
      try {
        if (aiStatus) aiStatus.textContent = 'Checking model availability…';

        // The user gesture (this click) allows download/instantiate
        if (typeof LanguageModel === 'undefined') {
          throw new Error('LanguageModel API not available in this context.');
        }

        const availability = await LanguageModel.availability();
        if (aiStatus) aiStatus.textContent = `Model status: ${availability}`;

        if (availability === 'unavailable') {
          throw new Error('Built-in AI is unavailable on this device.');
        }

        const params = await LanguageModel.params();
        const controller = new AbortController();

        const session = await LanguageModel.create({
          signal: controller.signal,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              if (!e || typeof e.loaded !== 'number') return;
              if (aiStatus) aiStatus.textContent = `Downloading model… ${Math.round(e.loaded * 100)}%`;
            });
          },
          initialPrompts: [
            { role: 'system', content: 'You explain selected website text in simple, clear English for non‑native speakers.' }
          ]
        });

        if (aiStatus) aiStatus.textContent = 'Model ready. Fetching selected text…';

        // Get the highlighted selection from the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab found.');

        const [{ result: selection }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => (window.getSelection ? String(window.getSelection()) : '')
        });

        const selectedText = (selection || '').trim();
        if (!selectedText) {
          if (aiStatus) aiStatus.textContent = 'Select text on the page, then click “Explain selection”.';
          return;
        }

        if (aiStatus) aiStatus.textContent = 'Generating explanation…';
        const response = await session.prompt([
          { role: 'user', content: `Explain this in simple English: "${selectedText}"` }
        ]);

        if (aiStatus) aiStatus.textContent = 'Done.';
        alert(response); // minimal MVP; later pipe into content.js tooltip
      } catch (err) {
        console.error('Explain via popup error:', err);
        if (aiStatus) aiStatus.textContent = `Error: ${err.message}`;
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

// Clear all statistics
async function clearStatistics() {
  try {
    await chrome.storage.local.set({
      textsExplained: 0,
      sessionCount: 0,
      lastUsed: null
    });
    console.log('Statistics cleared');
  } catch (error) {
    console.error('Error clearing statistics:', error);
  }
}

// Listen for messages from background script to update statistics
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateStats') {
    loadStatistics();
  }
});

// Handle popup close
window.addEventListener('beforeunload', () => {
  // Save any pending changes
  const targetLanguage = document.getElementById('targetLanguage').value;
  const preferredAI = document.getElementById('localAI').classList.contains('active') ? 'local' : 'remote';
  
  chrome.storage.sync.set({
    targetLanguage: targetLanguage,
    preferredAI: preferredAI
  });
});
