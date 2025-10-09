const submitBtn = document.getElementById("submit-btn");
const assistantBox = document.getElementById("assistant-box");
let session; 
	
submitBtn.onclick = async function () {
	const inputValue = document.getElementById("user-input").value;
	if (!session) {
		await createSession();
	}
	const resp = await session.prompt([
		{ role: "user", content: inputValue },
		{ role: "assistant", content: "Sure, I can help!" },
	]);
	assistantBox.value = resp;
};

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
			{
				role: "system",
				content:
					"You are a helpful and friendly assistant who understands that the user may not be a native English speaker.",
			},
		],
		expectedInputs: [{ type: "text", languages: ["en"] }],
		expectedOutputs: [{ type: "text", languages: ["en"] }],
	});
}