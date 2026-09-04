// Skript des Einstellungs-Panels. Es läuft im Scope des Einstellungsfensters, geladen
// über den scripts-Eintrag in Zotero.PreferencePanes.register().
//
// Zum Zeitpunkt der Ausführung ist das Panel-Fragment noch nicht eingehängt
// (preferences.js:313-320 lädt die Skripte, erst 341/363 fügt es den Inhalt ein).
// Zotero verschickt danach ein `load`-Ereignis an jedes direkte Kind des Panels
// (preferences.js:617). Das Ereignis blubbert nicht — deshalb wird in der
// Capture-Phase am Dokument gelauscht.
//
// Beim Entwickeln: Zotero lädt diese Datei ohne `ignoreCache`. Änderungen hier wirken
// erst nach einem Start mit `-purgecaches`.
{
	let LOCATOR_POPUPS = [
		'flexannotate-pref-citavi-locator-page-popup',
		'flexannotate-pref-citavi-locator-margin-popup'
	];

	/**
	 * Locator-Typen aus Zoteros eigener Liste, beschriftet über getLocatorString() und
	 * alphabetisch sortiert — dieselbe Liste wie im Zitationsdialog und in der
	 * Eingabemaske für Print-Annotationen.
	 *
	 * @param {Element} popup
	 */
	let fillLocatorMenu = (popup) => {
		if (popup.childElementCount) {
			return;
		}
		let locators = Zotero.Cite.labels.map(locator => ({
			value: locator,
			label: Zotero.Cite.getLocatorString(locator)
		}));
		locators.sort((a, b) => a.label.localeCompare(b.label));

		for (let { value, label } of locators) {
			let menuitem = popup.ownerDocument.createXULElement('menuitem');
			menuitem.setAttribute('value', value);
			menuitem.setAttribute('label', label);
			popup.appendChild(menuitem);
		}
	};

	document.addEventListener('load', (event) => {
		if (!event.target?.querySelector) {
			return;
		}
		for (let id of LOCATOR_POPUPS) {
			let popup = event.target.querySelector('#' + id);
			if (popup) {
				fillLocatorMenu(popup);
			}
		}
	}, true);
}
