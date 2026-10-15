// Chrome: clicking the toolbar icon opens the side panel. Unlike a popup, the
// side panel stays open while a scan runs.
//
// Safari (and any browser without chrome.sidePanel): there is no side panel, so
// clicking the icon opens the same page in a small window of its own instead. A
// popup would close as soon as you click on the store page and kill the scan.
// The window is told which browser window it belongs to, so it checks the
// product tab that is active there.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  });
} else {
  let panelWindowId = null;

  chrome.action.onClicked.addListener(async (tab) => {
    // Already open: bring it to the front rather than opening a second one.
    if (panelWindowId !== null) {
      try { await chrome.windows.update(panelWindowId, { focused: true }); return; }
      catch { panelWindowId = null; }
    }
    const params = new URLSearchParams({ win: String(tab?.windowId ?? ""), tab: String(tab?.id ?? "") });
    const url = chrome.runtime.getURL(`sidepanel.html?${params}`);
    try {
      const win = await chrome.windows.create({ url, type: "popup", width: 420, height: 760, focused: true });
      panelWindowId = win?.id ?? null;
    } catch {
      // No separate windows (for example Safari on iPhone/iPad): open it as a tab next to the product.
      await chrome.tabs.create({ url, index: (tab?.index ?? 0) + 1, active: true });
    }
  });

  chrome.windows?.onRemoved?.addListener((id) => { if (id === panelWindowId) panelWindowId = null; });
}
