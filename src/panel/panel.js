const submitBtn = document.getElementById("submit-btn");
const assistantBox = document.getElementById("assistant-box");
let session; 
	
// submit button click handler
submitBtn.onclick = async function () {
	const inputValue = document.getElementById("user-input").value;
	if (!session) {
		await createSession();
	}
	const data = await combPage();
	const resp = await session.prompt([
		{ role: "user", content: inputValue },
		{
			role: "assistant",
			content: "Based on the headers and links from the current webpage provided by the system, I will determine which part of the page is most relevant to the user's question."
		},
		{ role: "system", content: JSON.stringify(data) },
	]);
	assistantBox.value = resp;
};

// create a new session 
async function createSession() {
	const available = await LanguageModel.availability();
	if (available == "unavailable") {
		throw new Error("The Prompt API is not compatible with this device.");
	}
	session = await LanguageModel.create({
		monitor(m) {
			m.addEventListener("downloadprogress", (e) => {
				console.log(`Downloaded ${e.loaded * 100}%`);
			});
		},
		initialPrompts: [
			{ role: "user", content: "Where is the About section on this page?" },
			{ role: "assistant", content: "Here is a list of possible headers and links on this page that may lead to the About section." },
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

function combPage() {
	return new Promise((resolve, reject) => {
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