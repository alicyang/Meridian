import Dexie from "dexie";
import PageFeature from "./page-feature";
const EMBED_BATCH_URL = "https://embedbatch-fgq65muclq-uc.a.run.app/";

// shared states
let db = null;
let sidePanelOpen = false;

// --- Prevent Chrome message channel warnings ---
function handleAsync(fn) {
	return (message, sender, sendResponse) => {
	  Promise.resolve(fn(message, sender))
		.then((res) => sendResponse(res))
		.catch((err) => {
		  console.error("Handler error:", err);
		  sendResponse({ success: false, error: err?.message || "Unknown error" });
		});
	  return true; // keep channel open asynchronously
	};
  }

// ensure IndexedDB (Dexie) is initialized before any use
async function ensureDb() {
	if (!db) {
		db = new Dexie("SmartSearchDB");
		// keep schema consistent with current usage
		db.version(1).stores({
			embeddings: "++id, url, type, content, embedding, ts, tabId"
		});
	}
}

// handler on install 
chrome.runtime.onInstalled.addListener(() => {
	// initialize IndexedDB 
	db = new Dexie("SmartSearchDB");
	db.version(1).stores({
		embeddings: "++id, url, type, content, embedding, ts, tabId"
	});

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
	await ensureDb();
	const tab = await chrome.tabs.get(tabId);
	const { url } = tab;

	if (!/^https?:\/\//.test(url) || !(await checkAccessPermissions(url))) {
		chrome.runtime.sendMessage({ type: "SEARCHING_UNAVAILABLE", url }).catch(() => { });
	} else {
		await processNewTab(tab);
		chrome.runtime.sendMessage({ type: "SWAP_SEARCH_SESSION", url }).catch(() => { });
	}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
	if (changeInfo.status !== 'complete' || !tab?.url) return;
	await ensureDb();
	const { url } = tab;
	if (!/^https?:\/\//.test(url) || !(await checkAccessPermissions(url))) {
		chrome.runtime.sendMessage({ type: "SEARCHING_UNAVAILABLE", url }).catch(() => { });
	} else {
		await processNewTab(tab);
		chrome.runtime.sendMessage({ type: "SWAP_SEARCH_SESSION", url }).catch(() => { });
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	if (db) {
		db.embeddings.where("tabId").equals(tabId).delete();
	}
});

// message handler 
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	switch (message.type) {
		case "EMBEDDING_REQUEST":
			(async () => {
				const embedding = await embedString(message.text);
				sendResponse({ embedding });
			})();
			return true; 
		case "FETCH_DB_EMBEDDING":
			(async () => {
				await ensureDb();
				const stored_embeddings = await db.embeddings.where("url").equals(message.url).toArray();
				sendResponse({ embeddings: stored_embeddings });
			})();
			return true;
		case "DELETE_DB_EMBEDDING": 
			(async () => {
				await ensureDb();
				const stored_embeddings = await db.embeddings.where("url").equals(message.url).toArray();
				sendResponse({ embeddings: stored_embeddings });
			})();
			return true;
		case "PROCESS_PAGE":
			(async () => {
				try {
					await ensureDb();
					const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
					if (tabs.length > 0) {
						await processNewTab(tabs[0]);
						sendResponse({ success: true });
					} else {
						sendResponse({ success: false, error: "No active tab" });
					}
				} catch (error) {
					sendResponse({ success: false, error: error.message });
				}
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
                    sendResponse({ success: false, error: err?.message || 'Unknown error' });
                }
            })();
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
			if (message.source == "pdf_viewer") {
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
			} else {
				(async () => {
					try {
						const text = (message.text || '').trim();
						if (!text) { sendResponse({ success: false, error: 'No text provided' }); return; }

						const session = await getNanoSession();
						const result = await session.prompt([{ role: 'user', content: `Explain: "${text}"` }]);
						const explanation =
							typeof result === 'string'
								? result
								: (result?.toString?.() || JSON.stringify(result));

						if (sender.tab && sender.tab.id) {
							// Send message back to page for inline tooltip
							chrome.tabs.sendMessage(sender.tab.id, {
								action: "showInlineExplanationTooltip",
								text,
								explanation
							});
						} else {
							// Message came from popup → just respond directly
							sendResponse({ success: true, explanation });
						}

					} catch (err) {
						console.error('explainText error:', err);
						// Tell the content script to show an inline error tooltip
						if (sender.tab && sender.tab.id) {
							chrome.tabs.sendMessage(sender.tab.id, {
								action: "showInlineErrorTooltip",
								text,
								error: err.message
							});
						}
						// Always respond to popup
						sendResponse({ success: false, error: err.message });
					}
				})();
				return true;
			}
	}
});

// generate embeddings for a new tab
async function processNewTab(tab) {
	await ensureDb();
	if ((await db.embeddings.where("url").equals(tab.url).count()) === 0) {
		const features = await getPageFeatures(tab);
		const embeddings = await embedFeatures(features);
		// TODO: pass in features entirely if upgrading to tier 1 
		await saveEmbeddings(features.links, tab.id);
	}
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
							href: a.href
						},
						url: tabUrl
					}))
					.filter((l) => l.content.text.trim().length > 0);

				const headers = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
					.map(h => ({
						type: "header",
						content: {
							level: h.tagName,
							text: h.innerText.trim()
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
			const response = await fetch(EMBED_BATCH_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ contents: batch })
			});
			if (!response.ok) {
				console.error("Embedding request failed:", response.statusText);
				continue;
			}
			const data = await response.json();
			if (!data.embeddings) {
				console.error("Invalid embedding response:", data);
				continue;
			}
			allEmbeddings.push(...data.embeddings.map(e => e.values));
		}
		return allEmbeddings;
	}
	const linkEmbeddings = await embedInBatches(linkTexts);
	const headerEmbeddings = await embedInBatches(headerTexts);

	// attach embeddings to features
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
	const response = await fetch(EMBED_BATCH_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ contents: str }),
	});
	const data = await response.json();
	return data.embeddings[0].values; 
}

// persist embeddings to IndexedDb 
async function saveEmbeddings(features, tabId) {
	console.log(features);
	await db.transaction("rw", db.embeddings, async () => {
		for (let i = 0; i < features.length; i++) {
			await db.embeddings.add({
				url: features[i].url,
				type: features[i].type,
				content: JSON.stringify(features[i].content),
				embedding: JSON.stringify(features[i]._embedding),
				timestamp: Date.now(),
				tabId: tabId,
			});
		}
	});
	console.log("Stored link embeddings in Dexie:", await db.embeddings.count());
}

/* explain_in_context code added here */

// Handle context menu clicks for inline tooltips
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info);
  
  if (info.menuItemId === "explain-text" && info.selectionText) {
    const selectedText = info.selectionText.trim();

    // check if its an extension page
    if (tab.url.startsWith('chrome-extension://')) {

      console.log('Processing selected text for inline tooltip:', selectedText);

      chrome.tabs.sendMessage(tab.id, {
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
// --- Session manager for Gemini Nano ---
let nanoSession = null;           // holds the active session (if any)
let sessionCreating = false;     // prevent parallel session creates

async function getNanoSession() {
	if (nanoSession) return nanoSession;

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

		if (typeof LanguageModel === 'undefined') {
			throw new Error('LanguageModel is undefined in the service worker. The built-in API may not be available here.');
		}

		const availability = await LanguageModel.availability();
		console.log('LanguageModel availability (background):', availability);

		if (availability === 'unavailable') {
			throw new Error('Built-in AI is unavailable on this device.');
		}
		if (availability === 'downloadable' || availability === 'downloading') {
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

// helper to clear the session (to force reload later)
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