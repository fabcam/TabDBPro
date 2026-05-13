chrome.devtools.panels.create(
  'TabDB Pro',
  '/icons/icon-48.png',
  '/panel/panel.html',
  (panel) => {
    // panel.onShown fires each time the user switches to this tab
    panel.onShown.addListener((win) => {
      // Could pass inspected window info to panel if needed
    });
  }
);
