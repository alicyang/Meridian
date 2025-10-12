import * as smd from '../../smd.js';

const submitBtn = document.getElementById("submit-btn");
const assistantResponseBox = document.getElementById("assistant-response-box");
const assistantLoader = document.getElementById("assistant-loader")

const searchSessionMap = new Map(); // {tab_url: {session}}
let currSearchSession = null;
let currSearchSessionUrl = null;
let languageModel = null;
let modelIsBusy = false; 
let contextIsReady = false; 

start(); 
async function start() {
	// initialize session 
	languageModel = await LanguageModel.create({
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

	chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
		if (tabs.length === 0) return;
		const tab = tabs[0];
		await addNewSearchSession(tab);
		currSearchSession = searchSessionMap.get(tab.url);
		currSearchSessionUrl = tab.url;
		contextIsReady = true;
	});

	// Fires when a tab is updated (URL changes, page reloads)
	chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
		contextIsReady = false; 
		if (changeInfo.status === "complete") {
			await addNewSearchSession(tab);
			while (modelIsBusy) {
				await new Promise(resolve => setTimeout(resolve, 50));
			}
			currSearchSession = searchSessionMap.get(tab.url)
			currSearchSessionUrl = tab.url
		}
		contextIsReady = true; 
		if (searchSessionMap.size > 10) {
			for (const [key] of searchSessionMap) {
				if (key !== currSearchSessionUrl) {
					searchSessionMap.delete(key);
					break;
				}
			}
		}
	});
}

/**
 * Handles the page change: recomb the page and clone a new session
 */
async function addNewSearchSession(tab) {
	if (searchSessionMap.has(tab.url)) {
		return; // session in cache, no need to add a new one 
	}
	try {
		const data = await combPage(tab);
		const newSearchSession = await languageModel.clone();
		await newSearchSession.append([
			{ role: "system", content: JSON.stringify(data) }
		]);
		searchSessionMap.set(tab.url, newSearchSession);
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
		const [result] = injectionResults;
		return result.result;
	} catch (err) {
		console.error("Failed to comb page:", err);
		throw err;
	}
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