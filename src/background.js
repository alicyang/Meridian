import { GoogleGenAI } from "@google/genai";
import Dexie from "dexie";
import PageFeature from "./page-feature";

// shared states
let gemini = null;
let db = null;
let sidePanelOpen = false;

const LINK = "link";
const HEADER = "header"; 

// side panel opening logic
chrome.action.onClicked.addListener((tab) => {
	chrome.sidePanel.open({ tabId: tab.id }); // delete tabId for a global side panel
	sidePanelOpen = true;
})

// handler on install 
chrome.runtime.onInstalled.addListener(() => {
	// initialize IndexedDB 
	db = new Dexie("SmartSearchDB");
	db.version(1).stores({
		embeddings: "++id, url, type, content, embedding, ts"
	});

	// set up Gemini embedding API 
	const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
	if (!apiKey) {
		console.error("API key is missing. Please provide a valid API key.");
	}
	gemini = new GoogleGenAI({ apiKey });
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

	// Create context menu for inline tooltips
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

// handler for switching tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
	const tab = await chrome.tabs.get(tabId);
	const { url } = tab;

	if (!/^https?:\/\//.test(url) || !(await checkAccessPermissions(url))) return;

	const type = (await processNewTab(tab))
		? "SWAP_SEARCH_SESSION"
		: "SEARCHING_UNAVAILABLE";

	chrome.runtime.sendMessage({ type, url }).catch(() => { });
});



// message handler 
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	switch (message.type) {
		case "EMBEDDING_REQUEST":
			(async () => {
				const response = await embedString(message.text);
				const embedding = response.embeddings[0].values;
				sendResponse({ embedding });
			})();
			return true; 
		case "FETCH_DB_EMBEDDING":
			(async () => {
				const stored_embeddings = await db.embeddings.where("url").equals(message.url).toArray();
				sendResponse({ embeddings: stored_embeddings });
			})();
			return true;
		case "EXPLAIN_SELECTION": 
			// Message shape: { type: 'EXPLAIN_SELECTION', text: 'selected text', options: { ... } }
			(async () => {
				try {
					const text = (message.text || '').trim();
					if (!text) {
						sendResponse({ success: false, error: 'No text provided' });
						return;
					}

					// Ask background to prepare session (or error out)
					const session = await getNanoSession();

					// Prompt the session; some SDKs return an object, adapt accordingly
					const result = await session.prompt([
						{
							role: 'user',
							content: `
              					Please explain the following text using very simple language in the language of the speaker's choosing.  
              					Use the format described above — start with an explanation, then give a list of challenging words with definitions.

              					Here is the text:
              					"${text}"`.trim()
						}
					]);

					const textResult = result;

					sendResponse({ success: true, explanation: textResult });
				} catch (err) {
					console.error('EXPLAIN_SELECTION error in background:', err);
					// If usefully specific, return a clearer message
					sendResponse({ success: false, error: err?.message || 'Unknown error' });
				}
			})();
			// Tell Chrome to call sendResponse asynchronously
			return true;
	}

	switch (message.action) {
		case "getSettings":
			chrome.storage.sync.get(['targetLanguage', 'preferredAI'], (result) => {
				sendResponse({
					targetLanguage: result.targetLanguage || 'en',
					preferredAI: result.preferredAI || 'local'
				});
			});
			return true;
		case "explainText": 
			if (message.source != "pdf_viewer") {
				break;
			}
			(async () => {
				try {
					const text = (message.text || '').trim();
					if (!text) { sendResponse({ success: false, error: 'No text provided' }); return; }

					// Get language preference
					const settings = await chrome.storage.sync.get(['targetLanguage']);
					const language = settings.targetLanguage || 'en';

					// Clear existing session if language changed
					if (nanoSession && nanoSession.currentLanguage !== language) {
						clearNanoSession();
					}

					// using existing AI session
					const session = await getNanoSession();
					const result = await session.prompt([{ role: 'user', content: `Explain: "${text}"` }]);

					const explanation = typeof result === 'string' ? result : result?.toString?.() || JSON.stringify(result);

					// send response back to PDF viewer
					chrome.tabs.sendMessage(sender.tab.id, {
						action: "showExplanation",
						explanation: explanation
					});
					sendResponse({ success: true, explanation: explanation });
				} catch (err) {
					console.error('PDF explainText error:', err);
					sendResponse({ success: false, error: err?.message || 'Unknown error' });
				}
			})();
			return true;
		case "isSidePanelOpen": 
			sendResponse({ isOpen: sidePanelOpen });
			return true;
	}
})

// generate embeddings for a new tab, returns false if tab can't be processed
async function processNewTab(tab) {
	if (!(await checkAccessPermissions(tab.url))) {
		return false; 
	}
	if ((await db.embeddings.where("url").equals(tab.url).count()) === 0) {
		const features = await getPageFeatures(tab);
		const embeddings = await embedFeatures(features);
		// TODO: pass in features entirely if upgrading to tier 1 
		await saveEmbeddings(features.links);
	}
	return true; 
}

// returns true if we have permissions to inject scripts on this page 
async function checkAccessPermissions(url) {
    const isAccessible = url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://");
    const hasPermission = await chrome.permissions.contains({ origins: [url] });
	return isAccessible && hasPermission;
} 

// extract features from a tab 
async function getPageFeatures(tab) {
	try {
		const [res] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: (tabUrl) => {
				const links = Array.from(document.querySelectorAll("a[href]"))
					.map(a => ({
						type: "link",
						content: {
							text: a.innerText.trim(),
							href: a.href,
							pos: a
						},
						url: tabUrl
					}))
					.filter((l) => l.content.text.trim().length > 0);

				const headers = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
					.map(h => ({
						type: "header",
						content: {
							level: h.tagName,
							text: h.innerText.trim(),
							pos: h.getBoundingClientRect().top + window.scrollY,
						},
						url: tabUrl
					}))
					.filter((h) => h.content.text.trim().length > 0);
				return { links, headers };
			},
			args: [tab.url]
		});
		const rawFeatures = res.result;

		// Extract result from the injected script response
		const features = {
			links: rawFeatures.links.map(f => new PageFeature(f.type, f.content, f.url)),
			headers: rawFeatures.headers.map(f => new PageFeature(f.type, f.content, f.url))
		};
		return features;
	} catch (err) {
		console.error("Failed to fetch page features:", err);
		throw err;
	}
}

// embed PageFeatures with Gemini Embeddings API 
async function embedFeatures(features) {
	const linkTexts = features.links.map(l => l.content.text);
	const headerTexts = features.headers.map(h => h.content.text);

	async function embedInBatches(contents) {
		const batchSize = 100;
		const allEmbeddings = [];

		for (let i = 0; i < contents.length; i += batchSize) {
			const batch = contents.slice(i, i + batchSize);
			const response = await gemini.models.embedContent({
				model: "gemini-embedding-001",
				contents: batch,
				outputDimensionality: 768,
				taskType: "QUERY"
			});

			// Store each embedding result
			allEmbeddings.push(...response.embeddings.map(e => e.values));
		}

		return allEmbeddings;
	}

	// Run embedding for each type of feature
	const linkEmbeddings = await embedInBatches(linkTexts);
	const headerEmbeddings = await embedInBatches(headerTexts);

	// Attach embeddings to features
	features.links.forEach((f, i) => {
		f.embedding = linkEmbeddings[i];
	});

	features.headers.forEach((f, i) => {
		f.embedding = headerEmbeddings[i];
	});

	return features;
}

// returns a string embedding from Gemini Embeddings API 
async function embedString(str) {
	return await gemini.models.embedContent({
		model: "gemini-embedding-001",
		contents: [str],
		outputDimensionality: 768,
		taskType: "QUERY",
	});
}

// persist embeddings to IndexedDb 
async function saveEmbeddings(features) {
	console.log(features);
	await db.transaction("rw", db.embeddings, async () => {
		for (let i = 0; i < features.length; i++) {
			await db.embeddings.add({
				url: features[i].url,
				type: features[i].type,
				content: JSON.stringify(features[i].content),
				embedding: JSON.stringify(features[i]._embedding),
				timestamp: Date.now(),
			});
		}
	});
	console.log("Stored link embeddings in Dexie:", await db.embeddings.count());
}

// Handle context menu clicks for inline tooltips
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info);
  
  if (info.menuItemId === "explain-text" && info.selectionText) {
    const selectedText = info.selectionText.trim();

    // check if its an extension page
    if (tab.url.startsWith('chrome-extension://')) {

      console.log('Processing selected text for inline tooltip:', selectedText);

      chrome.runtime.sendMessage(tab.id, {
        action: "showInlineExplanation",
        text: selectedText
      });
    } else {

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
  }
});

// Chrome Built-in AI (Gemini Nano) - Local processing
// --- Session manager for Gemini Nano (centralized in background) ---
let nanoSession = null;           // holds the active session (if any)
let sessionCreating = false;     // prevent parallel session creates

async function getNanoSession() {
	// Reuse if already created
	if (nanoSession) return nanoSession;

	// Prevent concurrent session creation attempts
	if (sessionCreating) {
		// wait until it's created (polling small delay)
		while (sessionCreating) {
			await new Promise((r) => setTimeout(r, 50));
		}
		return nanoSession;
	}

	sessionCreating = true;
	try {
		// Get user's language preference
		const settings = await chrome.storage.sync.get(['targetLanguage']);
		const targetLanguage = settings.targetLanguage || 'en';

		// Validate language (only support en, ja, es)
		const supportedLanguages = ['en', 'ja', 'es'];
		const language = supportedLanguages.includes(targetLanguage) ? targetLanguage : 'en';

		// Defensive checks & helpful errors
		if (typeof LanguageModel === 'undefined') {
			throw new Error('LanguageModel is undefined in the service worker. The built-in API may not be available here.');
		}

		const availability = await LanguageModel.availability();
		console.log('LanguageModel availability (background):', availability);

		if (availability === 'unavailable') {
			throw new Error('Built-in AI is unavailable on this device.');
		}
		if (availability === 'downloadable' || availability === 'downloading') {
			// throw an informative error.
			throw new Error('Built-in AI needs to finish downloading first.');
		}

		// Create the session and store it
		nanoSession = await LanguageModel.create({
			// language-specific inputs/outputs
			expectedInputs: [
				{ type: "text", languages: ["en", language] } // System prompt in English, user input in selected language
			],
			expectedOutputs: [
				{ type: "text", languages: [language] } // Output in selected language
			],
			// system prompt
			initialPrompts: [
				{
					role: 'system',
					content: `
          You are a patient and clear AI assistant who explains complex or difficult text in **very simple English**. Your job is to make sure even someone with **limited English skills** can understand.
          
          🔹 Use short, clear sentences.
          🔹 Break long ideas into smaller parts.
          🔹 Avoid big words or advanced grammar.
          🔹 Explain hard words or phrases in parentheses.
          🔹 Use easy examples when helpful.
          🔹 Do not include any extra or off-topic information.
          
          🔸 Use this output format:
          
          📘 **Explanation**  
          Write a short and clear explanation here using simple language of user's choosing, 2-4 sentences maximum.  
          Break things into steps if needed. Use line breaks for each idea.End this section with **two line breaks**.
          
          🧠 **Challenging Words**  
          List any difficult words or phrases from the original text with simple definitions.  
          Use this format:
          - "word or phrase **in ENGLISH** (no matter what the output language preference is)" = simple definition
          
          Do not include any sections beyond this format.

          Here is an example of the output format:
          📘 **Explanation**  
          The Earth goes around the Sun.  
          It takes one year to complete a full circle.  
          This is called Earth's orbit.

          🧠 **Challenging Words**  
          - "orbit" = the path something follows around another thing
          `.trim()
				}
			],
			parameters: {
				temperature: 0.2,
				topK: 30
			}
		});

		// Optional: attach a basic "onClose" idea (some SDKs let you listen for session close)
		console.log('Nano session created in background');

		return nanoSession;
	} catch (error) {
		console.error('Error creating nano session:', error);
		throw error;
	}
	finally {
		sessionCreating = false;
	}
}

// helper to clear the session (if you want to force reload later)
function clearNanoSession() {
	try {
		// If session exposes a close/dispose method, call it here
		if (nanoSession && typeof nanoSession.close === 'function') {
			try { nanoSession.close(); } catch (e) { /* ignore */ }
		}
	} finally {
		nanoSession = null;
	}
}

async function handleExplainTextRequest(request, sender, sendResponse) {
	const text = request;

	if (!text || text.trim().length === 0) {
		sendResponse({ success: false, error: "No text provided" });
		return;
	}

	try {
		// Try Chrome Built-in AI first (Gemini Nano)
		let explanation;
		try {
			const session = await getNanoSession(); // create or reuse model session

			const promptText = `
        Please explain the following text using simple words in whatever language the user chooses:
        "${text}"
      `.trim();

			// Ask Gemini Nano for a response
			const result = await session.prompt([{ role: 'user', content: promptText }]);

			// Handle string/object return types
			explanation =
				typeof result === 'string'
					? result
					: result?.output || result?.toString?.() || JSON.stringify(result);
		} catch (localError) {
			console.log('AI failed:', localError.message);
			// For now, show a helpful error message since remote API is not configured
			throw new Error(`Chrome Built-in AI is not available. ${localError.message}`);
		}

	} catch (error) {
		console.error('Error explaining text:', error);
	}
}