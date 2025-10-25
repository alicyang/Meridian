import * as smd from '../smd.js';

const submitBtn = document.getElementById("submit-btn");
const assistantResponseBox = document.getElementById("assistant-response-box");
const assistantLoader = document.getElementById("assistant-loader")
const smartSearchDiv = document.getElementById("smart-search")
const notAvailableDiv = document.getElementById("not-available")

const searchSessionCache = new Map(); // {tab_url: {session}}
let currSearchSession = null;
let currSearchSessionUrl = null;
let searchModel = null;
let relevanceModel = null;
let modelIsBusy = false; 
let contextIsReady = false; 

start(); 
async function start() {
	// initialize model 
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

	relevanceModel = await LanguageModel.create({
		monitor(m) {
			m.addEventListener("downloadprogress", (e) => {
				console.log(`Downloaded ${e.loaded * 100}%`);
			});
		},
		initialPrompts: [
			{
				role: "system",
				content:
					`You are given a webpage context containing a list of links and headers. Your task is to select the most relevant items for a user trying to understand or navigate the page.
					For links, choose the top 200 that point to important sections, key content, or useful navigation.
					Skip links that are decorative, repetitive, or purely metadata. Do NOT add any links that were not provided.
					For headers, choose the top 200 that summarize main content or organize significant sections. Do NOT add any headers that were not provided.
					Skip headers that provide the least amount of meaningful context.
					Do not modify any link or header text. Only select a subset of the input provided. Do not add new text, explanations, or HTML. Return valid JSON only.`,
			},
		],
		expectedInputs: [{ type: "text", languages: ["en"] }],
		expectedOutputs: [{ type: "text", languages: ["en"] }],
	})

	// Set up the initial session 
	chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
		contextIsReady = false;
		if (tabs.length === 0) return;
		const tab = tabs[0];
		const isAccessible = await checkAccessPermissions(tab.url);
		if (!isAccessible) {
			notAvailableDiv.style.display = "block";
			smartSearchDiv.style.display = "none";
			contextIsReady = true;
			return;
		} 
		await addNewSearchSession(tab);
		currSearchSession = searchSessionCache.get(tab.url);
		currSearchSessionUrl = tab.url;
		contextIsReady = true;
	});

	chrome.tabs.onActivated.addListener(async (activeInfo) => {
		contextIsReady = false; 
		const tab = await chrome.tabs.get(activeInfo.tabId);
		const isAccessible = await checkAccessPermissions(tab.url)
		if (!isAccessible) {
			notAvailableDiv.style.display = "block"
			smartSearchDiv.style.display = "none"
			contextIsReady = true; 
			return 
		} 
		notAvailableDiv.style.display = "none";
		smartSearchDiv.style.display = "block"
		
		if (searchSessionCache.get(tab.url) == null) {
			await addNewSearchSession(tab);
		}
		// update the current session to the new session 
		while (modelIsBusy) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		currSearchSession = searchSessionCache.get(tab.url);
		currSearchSessionUrl = tab.url
		contextIsReady = true; 
	});

	// Fires when a tab is updated (URL changes, page reloads)
	chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
		if (changeInfo.status === "complete") {
			// check if this URL can be accessed 
			const isAccessible = await checkAccessPermissions(tab.url) 
			if (!isAccessible) {
				return
			}
			await addNewSearchSession(tab);
		}
	});
}

async function checkAccessPermissions(url) {
	const isAccessible = url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://");
	const hasPermission = await chrome.permissions.contains({ origins: [url] });
	return isAccessible && hasPermission
} 

/**
 * Handles the page change: recomb the page and clone a new session
 */
async function addNewSearchSession(tab) {
	if (searchSessionCache.has(tab.url)) {
		return; // session in cache, no need to add a new one 
	}
	try {
		console.log(`[INFO] Starting new search session for tab: ${tab.url}`);
		const data = await combPage(tab);
		const newSearchSession = await searchModel.clone();
		await newSearchSession.append([
			{ role: "system", content: JSON.stringify(data) }
		]);
		searchSessionCache.set(tab.url, newSearchSession);
		if (searchSessionCache.size > 10) {
			for (const [key] of searchSessionCache) {
				if (key !== currSearchSessionUrl) {
					searchSessionCache.delete(key);
					break;
				}
			}
		}
	} catch (err) {
		console.error("Failed to handle page change:", err);
	}
}

/**
 * Combs the currently active webpage for important context (links, headers, etc.)
 * @returns '{ {<links}, {<headers>} }'
 */
async function combPage(tab) {
	try {
		const injectionResults = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				const links = Array.from(document.querySelectorAll("a[href]")).map(a => ({
					text: a.innerText.trim(),
					href: a.href,
				}));

				const headers = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map(h => ({
					level: h.tagName,
					text: h.innerText.trim(),
					top: h.getBoundingClientRect().top + window.scrollY,
				}));
				return { links, headers };
			},
		});

		// Extract result from the injected script response
		const result = injectionResults[0].result;
		console.log(`[INFO] Combed page: found ${result.links.length} links and ${result.headers.length} headers`); // <-- LOG 2
		console.log(result)
		if (result.links.length + result.headers.length >= 100) {
			return await filterPageFeatures(result);
		}
		return { links: result.links, headers: result.headers };
	} catch (err) {
		console.error("Failed to comb page:", err);
		throw err;
	}
}

async function filterPageFeatures(data) {
	const schema = {
		"type": "object",
		"properties": {
			"links": {
				"type": "array",
				"maxItems": 200,
				"items": {
					"type": "object",
					"properties": {
						"text": { "type": "string"},
						"href": { "type": "string"}
					}
				},
				"required": ["text", "href"],
				"additionalProperties": false
			},
			"headers": {
				"type": "array",
				"maxItems": 200,
				"items": {
					"type": "object",
					"properties": {
						"level": { "type": "string" },
						"text": { "type": "string" },
						"top": { "type": "integer"}
					},
					"required": ["level", "text", "top"],
					"additionalProperties": false
				}
			}
		},
		"required": ["links", "headers"],
		"additionalProperties": false
	}
	const relevanceSession = await relevanceModel.clone(); 
	const res = await relevanceSession.prompt(
		`${JSON.stringify(data)}`,
		{responseConstraint: schema}
	) 

	let parsed;
	try {
		parsed = typeof res === "string" ? JSON.parse(res) : res;
	} catch (err) {
		console.error("Failed to parse model output JSON:", err);
		parsed = { links: [], headers: [] };
	}
	console.log(`[INFO] Filtered page features (JS object):`, parsed);
	return parsed;
}


/**
 * On click handler for button which submits user's question to model 
 */
submitBtn.onclick = async function () {
	const inputValue = document.getElementById("user-input").value.trim();
	if (!inputValue) {
		return 
	}

	submitBtn.disabled = true;
	assistantResponseBox.replaceChildren();
	assistantLoader.style.display = "flex"

	// set up a Markdown parser so we can format the model's output 
	const renderer = smd.default_renderer(assistantResponseBox);
	const parser = smd.parser(renderer);

	while (!contextIsReady) {
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	// read model response from stream to instantly display output
	modelIsBusy = true;
	const stream = currSearchSession.promptStreaming([
		{ role: "user", content: inputValue },
		{
			role: "assistant",
			content: "Based on the headers and links from the current webpage previously provided by the system, I will determine which part of the page is most relevant to the user's question."
		},
	]);

	let firstChunk = true;
	for await (const chunk of stream) {
		if (firstChunk) {
			assistantLoader.style.display = "none";
			firstChunk = false;
		}
		smd.parser_write(parser, chunk);
	}
	smd.parser_end(parser);
	submitBtn.disabled = false;
	modelIsBusy = false; 
};