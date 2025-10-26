import { GoogleGenAI } from "@google/genai";
import Dexie from "dexie";
import PageFeature from "./page-feature";

// shared states
let gemini = null;
let db = null;

const LINK = "link";
const HEADER = "header"; 

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
});

// handler for switching tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
	const tab = await chrome.tabs.get(activeInfo.tabId);
	if (!(await checkAccessPermissions(tab.url))) {
		return;
	}
	const tabProcessed = await processNewTab(tab);
	if (tabProcessed) { 
		chrome.runtime.sendMessage({
			type: "SWAP_SEARCH_SESSION",
			url: tab.url
		});
	} else {
		chrome.runtime.sendMessage({
			type: "SEARCHING_UNAVAILABLE"
		});
	}
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