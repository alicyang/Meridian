import { GoogleGenAI } from "@google/genai";
import * as smd from '../smd.js';
import Dexie from "dexie";

const submitBtn = document.getElementById("submit-btn");
const assistantResponseBox = document.getElementById("assistant-response-box");
const assistantLoader = document.getElementById("assistant-loader");
const smartSearchDiv = document.getElementById("smart-search");
const notAvailableDiv = document.getElementById("not-available")

let ai
let apiKey 
let db

// search session states 
let currSearchSession;
let currSearchURL; 
let searchModel;
const searchSessionCache = new Map(); // maps tab urls to search sessions 
let sessionIsReady = false; // should be checked before accessing/changing currSearchSession or currSearchURL 
let modelIsBusy = false; // should be checked before feeding new input into model 


async function main() {
    // initialize IndexedDB 
    db = new Dexie("SmartSearchDB");
    db.version(1).stores({
        embeddings: "++id, url, type, content, embedding, ts"
    });

    // set up Gemini embedding API 
    apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        console.error("API key is missing. Please provide a valid API key.");
        return;
    }
    ai = new GoogleGenAI({ apiKey });
    
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

    // register handler for tab switches 
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        sessionIsReady = false;
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (!(await checkAccessPermissions(tab.url))) {
            return;
        }
        await setSearchSession(tab);
        sessionIsReady = true; 
    });

}

/**
 * On click handler for button which submits user's question to model 
 */
submitBtn.onclick = async function () {
    const inputValue = document.getElementById("user-input").value.trim();
    if (!inputValue) {
        return 
    }
    // update ui 
    submitBtn.disabled = true;
    assistantResponseBox.replaceChildren();
    assistantLoader.style.display = "flex"

    // set up a Markdown parser so we can format the model's output 
    const renderer = smd.default_renderer(assistantResponseBox);
    const parser = smd.parser(renderer);

    // fetch embeddings for this tab 
    while (!sessionIsReady) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    let storedEmbeddings = await db.embeddings.where("url").equals(currSearchURL).toArray();
    if (storedEmbeddings.length == 0) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await processNewTab(tab);
        storedEmbeddings = await db.embeddings.where("url").equals(tab.url).toArray();
    }
    let questionEmbedding = await ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: [inputValue],
        outputDimensionality: 768,
        taskType: "QUERY",
    });
    questionEmbedding = questionEmbedding.embeddings[0].values
    const results = storedEmbeddings.map(item => {
        const storedVector = JSON.parse(item.embedding); 
        const sim = cosineSimilarity(questionEmbedding, storedVector);
        return { ...item, similarity: sim };
    });
    results.sort((a, b) => b.similarity - a.similarity);
    const topMatches = results.slice(0, 30);
    topMatches.forEach(match => {
        delete match.embedding;
        delete match.url
    });

    while (modelIsBusy) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    // read model response from stream to instantly display output
    modelIsBusy = true;
    const stream = currSearchSession.promptStreaming([
        { role: "user", content: inputValue },
        {
            role: "assistant",
            content: "I will answer the user's question based on the top matches provided to me by the System. I choose the top 3-6 most relevant options with concise explainations."
        },
        { role: "system", content: JSON.stringify(topMatches)}
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

/**
 * Fetch search session for url from cache, or start a new one if cache miss
 */
async function setSearchSession(tab) {
    let searchSession = searchSessionCache.get(tab.url);
    if (searchSession == null) {
        console.log(`[INFO] Starting new search session for tab: ${tab.url}`);
        searchSession = await searchModel.clone();
        searchSessionCache.set(tab.url, searchSession);
    }
    
    // new tab
    await processNewTab(tab);
    while (modelIsBusy) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    currSearchSession = searchSession
    currSearchURL = tab.url
    
    // update cache 
    if (searchSessionCache.size > 10) {
        for (const [key] of searchSessionCache) {
            if (key !== currSearchURL) {
                searchSessionCache.delete(key);
                break;
            }
        }
    }
}

/**
 * Assumes that tab is accessible 
 * 
 * @param {*} tab 
 * @returns 
 */
async function processNewTab(tab) {
    const features = await getPageFeatures(tab);
    const embeddings = await embedFeatures(features);
    // TODO: pass in features entirely if upgrading to tier 1 
    await saveEmbeddings(tab, features.links, embeddings);
}

/**
 * Returns true if we have permissions to inject scripts on this page 
 * 
 * @param {*} url 
 * @returns 
 */
async function checkAccessPermissions(url) {
    const isAccessible = url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://");
    const hasPermission = await chrome.permissions.contains({ origins: [url] });

    if (!isAccessible || !hasPermission) {
        notAvailableDiv.style.display = "block";
        smartSearchDiv.style.display = "none";
        return false;
    }
    notAvailableDiv.style.display = "none";
    smartSearchDiv.style.display = "block";
    return true
} 

/**
 * Extract features (links, headers) from tab 
 * 
 * @param {*} tab 
 * @returns 
 */
async function getPageFeatures(tab) {
    try {
        const features = await chrome.scripting.executeScript({
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
            }
        })

        // Extract result from the injected script response
        const result = features[0].result;
        const links = result.links.filter((l) => l.text.trim().length > 0)
        const headers = result.headers.filter((h) => h.text.trim().length > 0)
        console.log("Page features retrieved: ", links)
        console.log("Page features retrieved: ", headers)
        return { links, headers };
    } catch (err) {
        console.error("Failed to fetch page features:", err);
        throw err;
    }
}

/**
 * Request embedding from Gemini Embedding API Service 
 * 
 * @param {*} features 
 * @returns 
 */
async function embedFeatures(features) {
    const link_contents = features.links.map((l) => {
        return l.text;
    })
    const header_contents = features.headers.map((h) => {
        return h.text;
    })
    
    // request embeddings in batches 
    async function embedInBatches(contents) {
        const batchSize = 100;
        const allEmbeddings = [];

        for (let i = 0; i < contents.length; i += batchSize) {
            const batch = contents.slice(i, i + batchSize);
            const response = await ai.models.embedContent({
                model: "gemini-embedding-001",
                contents: batch,
                outputDimensionality: 768,
                taskType: "QUERY",
            });
            allEmbeddings.push(...response.embeddings);
        }
        return allEmbeddings;
    }

    // TODO: upgrade to tier 1 to allow gemini embedding rate of over 100 tokens / minute 
    const link_embeddings = await embedInBatches(link_contents.slice(0, 99));
    // const header_embeddings = await embedInBatches(header_contents);

    console.log(link_embeddings);
    // console.log(header_response.embeddings);
    return link_embeddings
}

/**
 * Persist embeddings to IndexedDB 
 * 
 * @param {*} features 
 * @param {*} embeddings 
 */
async function saveEmbeddings(tab, features, embeddings) {
    console.log(embeddings)
    await db.transaction("rw", db.embeddings, async () => {
        for (let i = 0; i < embeddings.length; i++) {
            await db.embeddings.add({
                url: tab.url, 
                type: "link",
                text: JSON.stringify(features[i]),
                embedding: JSON.stringify(embeddings[i].values), 
                timestamp: Date.now(),
            });
        }
    });
    console.log("Stored link embeddings in Dexie:", await db.embeddings.count());
}

function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] ** 2;
        normB += b[i] ** 2;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// TODO add some error handling
main();