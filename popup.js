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
        if (aiStatus) aiStatus.textContent = 'Getting selected text…';

        // Step 1: Get selection
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab found.');

        const [{ result: selection }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => (window.getSelection ? String(window.getSelection()) : '')
        });

        const selectedText = (selection || '').trim();
        if (!selectedText) {
          aiStatus.textContent = 'Select text on the page first.';
          return;
        }

        // Step 2: Call background to generate explanation
        aiStatus.textContent = 'Sending to AI...';
        const response = await chrome.runtime.sendMessage({
          action: 'explainText',
          text: selectedText,
          useRemote: false // you can toggle this based on user setting
        });

        // Step 3: Show result
        if (response.success) {
          aiStatus.textContent = 'Done.';
          alert(response.explanation);
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
  const preferredAI = document.getElementById('localAI').classList.contains('active') ? 'local' : 'remote';
  
  chrome.storage.sync.set({
    targetLanguage: targetLanguage,
    preferredAI: preferredAI
  });
});
