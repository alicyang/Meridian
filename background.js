// Background service worker for HelpMyMom extension

// Create context menu for inline tooltips
chrome.runtime.onInstalled.addListener(() => {
  console.log('HelpMyMom extension installed, creating context menu...');
  chrome.contextMenus.create({
    id: "explain-text",
    title: "Explain this text",
    contexts: ["selection"],
    documentUrlPatterns: ["<all_urls>"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error creating context menu:', chrome.runtime.lastError);
    } else {
      console.log('Context menu created successfully');
    }
  });
});

// Handle context menu clicks for inline tooltips
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info);
  
  if (info.menuItemId === "explain-text" && info.selectionText) {
    const selectedText = info.selectionText.trim();
    console.log('Processing selected text for inline tooltip:', selectedText);
    
    if (selectedText.length === 0) {
      console.log('No text selected, returning');
      return;
    }

    try {
      // Send message to content script to handle inline tooltip
      chrome.tabs.sendMessage(tab.id, {
        action: "showInlineExplanation",
        text: selectedText
      });
    } catch (error) {
      console.error('Error sending message to content script:', error);
    }
  }
});

// Chrome Built-in AI (Gemini Nano) - Local processing
async function explainWithLocalAI(text) {
  try {
    // Debug: Log what's available
    console.log('Checking Chrome Built-in AI availability...');
    console.log('typeof LanguageModel:', typeof LanguageModel);
    console.log('LanguageModel object:', LanguageModel);
    
    // Check if Chrome Built-in AI is available
    if (typeof LanguageModel === 'undefined') {
      throw new Error('Chrome Built-in AI not available. The `LanguageModel` object is undefined. This might be because the API is not available in service workers or the feature is not properly enabled.');
    }

    console.log('Checking LanguageModel availability...');
    const availability = await LanguageModel.availability();
    console.log('LanguageModel availability:', availability);
    
    if (availability === 'unavailable') {
      throw new Error('Chrome Built-in AI is not available on this device.');
    }
    
    if (availability === 'downloadable' || availability === 'downloading') {
      throw new Error('Chrome Built-in AI needs to be downloaded first. Please try again after the download completes.');
    }

    console.log('Creating LanguageModel session...');
    const session = await LanguageModel.create({
      // can modify this prompt to make it more comprehensive
      initialPrompts: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant that explains text in simple, clear English for non-native speakers. Focus on making complex concepts easy to understand.' 
        }
      ]
    });
    
    console.log('Session created, now calling prompt...');
    const result = await session.prompt([
      {
        role: 'user',
        content: `Please explain this text in simple English: "${text}"`
      }
    ]);
    
    console.log('AI response received:', result);
    return result;
  } catch (error) {
    console.error('Local AI error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Provide more specific error messages
    if (error.message.includes('not available')) {
      throw new Error('Chrome Built-in AI is not available. Please update Chrome to version 126+ and enable AI features in chrome://flags/');
    } else if (error.message.includes('download')) {
      throw new Error('Chrome Built-in AI needs to be downloaded. Please try again in a few moments.');
    } else if (error.message.includes('quota')) {
      throw new Error('AI usage quota exceeded. Please try again later.');
    } else if (error.message.includes('permission')) {
      throw new Error('Permission denied. Please check your Chrome settings.');
    } else {
      throw new Error(`Local AI failed: ${error.message}`);
    }
  }
}

// Remote Gemini Pro API fallback
async function explainWithRemoteAI(text) {
  try {
    // Note: In a real implementation, you'd need to get the API key from storage
    // For now, we'll simulate the API call
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${apiKey}` // You'd get this from storage
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Please explain this text in simple English for non-native speakers: "${text}"`
          }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Remote API failed: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Remote AI error:', error);
    throw error;
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSettings") {
    // Get user settings from storage
    chrome.storage.sync.get(['targetLanguage', 'preferredAI'], (result) => {
      sendResponse({
        targetLanguage: result.targetLanguage || 'en',
        preferredAI: result.preferredAI || 'local'
      });
    });
    return true; // Keep message channel open for async response
  }
  
  if (request.action === "explainText") {
    // Handle explain text request from content script
    handleExplainTextRequest(request, sender, sendResponse);
    return true; // Keep message channel open for async response
  }
});

// Handle explain text requests from content script
async function handleExplainTextRequest(request, sender, sendResponse) {
  const { text, useRemote } = request;
  
  if (!text || text.trim().length === 0) {
    sendResponse({ success: false, error: "No text provided" });
    return;
  }

  try {
    // Show loading state in content script
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "showLoading",
      text: text
    });

    // Try Chrome Built-in AI first (Gemini Nano)
    let explanation;
    try {
      explanation = await explainWithLocalAI(text);
    } catch (localError) {
      console.log('Local AI failed:', localError.message);
      // For now, show a helpful error message since remote API is not configured
      throw new Error(`Chrome Built-in AI is not available. ${localError.message}`);
    }

    // Send explanation to content script
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "showExplanation",
      text: text,
      explanation: explanation
    });

    sendResponse({ success: true });

  } catch (error) {
    console.error('Error explaining text:', error);
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "showError",
      text: text,
      error: error.message
    });
    sendResponse({ success: false, error: error.message });
  }
}
