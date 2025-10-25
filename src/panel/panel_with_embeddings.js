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

async function main() {

    // initialize IndexedDB 
    db = new Dexie("SmartSearchDB");
    db.version(1).stores({
        embeddings: "++id, url, type, content, embedding, ts"
    });

    apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        console.error("API key is missing. Please provide a valid API key.");
        return;
    }
    ai = new GoogleGenAI({apiKey});

    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        const isAccessible = await checkAccessPermissions(tab.url);
        if (!isAccessible) {
            notAvailableDiv.style.display = "block";
            smartSearchDiv.style.display = "none";
            return;
        }
        notAvailableDiv.style.display = "none";
        smartSearchDiv.style.display = "block"

        const features = await getPageFeatures(tab);
        const embeddings = await embedFeatures(features);
        // TODO: pass in features entirely if upgrading to tier 1 
        saveEmbeddings(tab, features.links, embeddings)

    });
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
    return isAccessible && hasPermission;
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
    return [link_embeddings]
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
                embedding: embeddings[i].values, 
                timestamp: Date.now(),
            });
        }
    });
    console.log("Stored link embeddings in Dexie:", await db.embeddings.count());
}


// error handling below 
window.addEventListener("error", (event) => {
    console.error("Caught global error:", event.error);
    reportGlobalError(event.error?.message || "Unknown runtime error");
});

window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", event.reason);
    reportGlobalError(event.reason?.message || "Unhandled promise rejection");
});

function reportGlobalError(errorMessage) {
    chrome.runtime.sendMessage({
        type: "GLOBAL_ERROR",
        error: errorMessage,
    });
}

main();