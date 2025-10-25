chrome.runtime.onInstalled.addListener(() => {
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((msg) => {
	if (msg.type === "GLOBAL_ERROR") {
		chrome.notifications.create({
			type: "basic",
			iconUrl: "icons/error.png",
			title: "Extension Error",
			message: msg.error,
		});
	}
});