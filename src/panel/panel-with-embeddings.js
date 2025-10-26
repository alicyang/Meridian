import * as smd from '../smd.js';
import { cosineSimilarity, sendMessageAsync } from "../utils.js";

const submitBtn = document.getElementById("submit-btn");
const assistantResponseBox = document.getElementById("assistant-response-box");
const assistantLoader = document.getElementById("assistant-loader");
const smartSearchDiv = document.getElementById("smart-search");
const notAvailableDiv = document.getElementById("not-available")

// search session states 
let currSearchSession;
let currSearchURL; 
let searchModel;
const searchSessionCache = new Map(); // maps tab urls to search sessions 
let sessionIsReady = false; // should be checked before accessing/changing currSearchSession or currSearchURL 
let modelIsBusy = false; // should be checked before feeding new input into model 

const numMatches = 30; 

async function main() {
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

    // fetch embeddings 
    while (!sessionIsReady) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    let resp = await sendMessageAsync({ type: "FETCH_DB_EMBEDDING", url: currSearchURL });
    const storedEmbeddings = resp.embeddings;

    resp = await sendMessageAsync({ type: "EMBEDDING_REQUEST", text: inputValue });
    const questionEmbedding = resp.embedding;

    // compute top matches 
    const matches = storedEmbeddings.map(storedEmbedding => {
        const storedVector = JSON.parse(storedEmbedding.embedding); 
        const sim = cosineSimilarity(questionEmbedding, storedVector);
        return { ...storedEmbedding, similarity: sim };
    });
    matches.sort((a, b) => b.similarity - a.similarity);
    const topMatches = matches.slice(0, numMatches);
    
    topMatches.forEach(match => {
        delete match.embedding;
        delete match.url
        delete match.similarity;
        delete match.timestamp;
        delete match.id;
    });

    // use search session 
    while (modelIsBusy) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    modelIsBusy = true;
    const stream = currSearchSession.promptStreaming([
        { role: "user", content: inputValue },
        {
            role: "assistant",
            content: `I will answer the user's question based on the following top matches:
                \n${JSON.stringify(topMatches)}\n
                I will select the top 3-6 most relevant options and provide concise explanations.`
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

/**
 * Fetch search session for url from cache, or start a new one if cache miss
 */
async function setSearchSession(url) {
    let searchSession = searchSessionCache.get(url);
    if (searchSession == null) {
        console.log(`[INFO] Starting new search session for tab: ${url}`);
        while (searchModel == null) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        searchSession = await searchModel.clone();
        searchSessionCache.set(url, searchSession);
    }
    
    while (modelIsBusy) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    currSearchSession = searchSession
    currSearchURL = url;
    
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

// TODO add some error handling
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    switch (message.type) {
        case "SWAP_SEARCH_SESSION":
            sessionIsReady = false;
            smartSearchDiv.style.display = "block";
            notAvailableDiv.style.display = "none";
            await setSearchSession(message.url);
            sessionIsReady = true;
            break;
        case "SEARCHING_UNAVAILABE":
            smartSearchDiv.style.display = "none";
            notAvailableDiv.style.display = "block";
    }
})
main();