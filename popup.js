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
  const preferredAI = document.getElementById('localAI').classList.contains('active') ? 'local' : 'remote';
  
  chrome.storage.sync.set({
    targetLanguage: targetLanguage,
    preferredAI: preferredAI
  });
});
