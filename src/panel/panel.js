import * as smd from '../../smd.js';

const submitBtn = document.getElementById("submit-btn");
const assistantResponseBox = document.getElementById("assistant-response-box");
const assistantLoader = document.getElementById("assistant-loader")

// initialize session 
const languageModel = await LanguageModel.create({
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
const searchSession = await languageModel.clone();
	
// submit button click handler
submitBtn.onclick = async function () {
	assistantResponseBox.replaceChildren();
	assistantLoader.style.display = "flex"

	const inputValue = document.getElementById("user-input").value;
	const data = await combPage();

	// set up a Markdown parser so we can format the model's output 
	const renderer = smd.default_renderer(assistantResponseBox);
	const parser = smd.parser(renderer);

	// read model response from stream to instantly display output
	const stream = searchSession.promptStreaming([
		{ role: "user", content: inputValue },
		{
			role: "assistant",
			content: "Based on the headers and links from the current webpage provided by the system, I will determine which part of the page is most relevant to the user's question."
		},
		{ role: "system", content: JSON.stringify(data) },
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
};

function combPage() {
	return new Promise((resolve, reject) => {
		// retrieve content from the currently active tab 
		chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
			if (!tab) {
				reject("No active tab found");
				return;
			}
			
			chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: () => {
					const links = Array.from(document.querySelectorAll("a[href]")).map(a => ({
						text: a.innerText.trim(),
						href: a.href,
					}));
					const headers = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map(h => ({
						level: h.tagName,
						text: h.innerText.trim(),
						top: h.getBoundingClientRect().top + window.scrollY
					}));
					return { links, headers };
				}
			}).then(injectionResults => {
				const [result] = injectionResults;
				resolve(result.result);
			})
			.catch(err => reject(err));
		});
	});
}