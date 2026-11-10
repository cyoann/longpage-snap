(() => {
  const kind = document.documentElement.dataset.preview;
  function inspect() {
    let panel;
    let buttons;
    let translated;
    let separated = true;
    let preferencesSaved = true;
    if (kind === "options") {
      panel = document.querySelector(".panel");
      buttons = [...document.querySelectorAll("button, select, input[type=number]")];
      translated = document.documentElement.lang === "fr" &&
        document.getElementById("mode-description").textContent.includes("image") &&
        document.getElementById("custom-limits").hidden === false;
      preferencesSaved = window.__lastSavedSettings?.mode === "single";
    } else {
      const shadow = document.documentElement.lastElementChild.shadowRoot;
      panel = shadow?.querySelector(".dialog");
      buttons = shadow ? [...shadow.querySelectorAll("button")] : [];
      const primary = shadow?.querySelector(".primary");
      const danger = shadow?.querySelector(".danger-row");
      separated = !!primary && !!danger &&
        danger.getBoundingClientRect().top -
          primary.getBoundingClientRect().bottom >= 16;
      translated = shadow?.querySelector(".settings")?.textContent === "Paramètres" &&
        (kind === "retry"
          ? shadow?.querySelector(".primary")?.textContent === "Réessayer en mode automatique" &&
            shadow?.querySelector(".title")?.textContent === "Capture interrompue" &&
            shadow?.querySelector(".status")?.textContent.includes("une seule image lisible") &&
            shadow?.querySelector(".description")?.textContent.includes("inchangée")
          : shadow?.querySelector(".primary")?.textContent === "Enregistrer l’image 1 sur 2");
    }
    buttons = buttons.filter((button) => !button.disabled &&
      button.getClientRects().length > 0);
    const viewport = document.documentElement.clientWidth;
    const rect = panel?.getBoundingClientRect();
    const result = {
      kind, viewport, panelWidth: rect ? Math.round(rect.width) : null,
      overflow: document.documentElement.scrollWidth > viewport,
      controls: buttons.length,
      controlsReach44: buttons.length > 0 && buttons.every((button) =>
        button.getBoundingClientRect().height >= 43.5),
      translated: Boolean(translated),
      preferencesSaved, discardSeparated: separated,
    };
    result.passed = result.viewport === 390 && result.panelWidth <= 380 &&
      !result.overflow && result.controlsReach44 &&
      result.translated && result.discardSeparated && result.preferencesSaved;
    document.documentElement.dataset.checkResult =
      encodeURIComponent(JSON.stringify(result));
  }
  setTimeout(() => {
    if (kind === "options") {
      // Exercise a real change event: selecting Single Image must persist
      // without pressing Save or submitting the settings form.
      const select = document.getElementById("mode");
      select.value = "single";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(inspect, 200);
    } else {
      inspect();
    }
  }, 950);
})();
