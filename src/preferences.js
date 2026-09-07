"use strict";

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
	// Ein Auswahlfeld je Citavi-Seitentyp; das <menupopup> darin wird hier gefüllt
	let LOCATOR_MENULISTS = [
		'flexannotate-pref-citavi-locator-page',
		'flexannotate-pref-citavi-locator-column',
		'flexannotate-pref-citavi-locator-paragraph',
		'flexannotate-pref-citavi-locator-margin',
		'flexannotate-pref-citavi-locator-other'
	];

	/**
	 * Locator-Typen aus Zoteros eigener Liste, beschriftet über getLocatorString() und
	 * alphabetisch sortiert — dieselbe Liste wie im Zitationsdialog und in der
	 * Eingabemaske für Print-Annotationen.
	 *
	 * Der Rückfall auf den technischen Namen fängt einen halb gefüllten Zwischenspeicher
	 * ab: getLocatorString() legt seine Map für das Locale an, *bevor* es sie füllt
	 * (cite.js:66-67). Bricht das Füllen ab, liefern spätere Aufrufe `undefined` — ohne
	 * Rückfall würde das Sortieren daran scheitern und gar kein Eintrag entstehen.
	 *
	 * @return {Array<{ value: String, label: String }>}
	 */
	let getLocatorOptions = () => {
		let locators = Zotero.Cite.labels.map(locator => ({
			value: locator,
			label: Zotero.Cite.getLocatorString(locator) || locator
		}));
		locators.sort((a, b) => a.label.localeCompare(b.label));
		return locators;
	};

	/**
	 * Füllt alle noch leeren Auswahlfelder in einem Durchgang.
	 *
	 * Heikel: getLocatorString() liest Object.keys(Zotero.Styles.locales) (cite.js:52-55).
	 * Solange Zotero.Styles.init() nicht durch ist, ist `locales` undefined und der Aufruf
	 * wirft — direkt nach einem Zotero-Start blieben die Felder deshalb leer und füllten
	 * sich erst beim zweiten Öffnen des Fensters. init() liefert eine bereits laufende
	 * Initialisierung als Promise zurück (style.js:70-77), ist also beliebig oft erlaubt.
	 *
	 * Die Auswahl wird anschließend selbst gesetzt, statt sie Zoteros MutationObserver zu
	 * überlassen (preferences.js:516-539): der greift nur, wenn die Bindung zum Zeitpunkt
	 * des Einfügens schon steht. Ein `value` von Hand zu setzen löst kein `command`-
	 * Ereignis aus und schreibt damit auch nichts in die Einstellungen zurück.
	 *
	 * @return {Promise<void>}
	 */
	let fillLocatorMenus = async () => {
		let open = LOCATOR_MENULISTS
			.map(id => document.getElementById(id)?.querySelector('menupopup'))
			.filter(popup => popup && !popup.childElementCount);
		if (!open.length) {
			return;
		}

		await Zotero.Styles.init();
		let options = getLocatorOptions();

		for (let popup of open) {
			// Ein zweiter Durchgang könnte währenddessen zugeschlagen haben
			if (popup.childElementCount) {
				continue;
			}
			for (let { value, label } of options) {
				let menuitem = popup.ownerDocument.createXULElement('menuitem');
				menuitem.setAttribute('value', value);
				menuitem.setAttribute('label', label);
				popup.appendChild(menuitem);
			}
			let menulist = popup.closest('menulist');
			let pref = menulist?.getAttribute('preference');
			if (pref) {
				// Zotero.Prefs.get() liefert für einen ungesetzten Pref undefined statt zu
				// werfen (prefs.js:248-274). prefs.js wird zwar bei jedem Start gelesen,
				// aber ohne Rückfall bliebe das Feld beim ersten Lauf ohne Auswahl stehen.
				menulist.value = Zotero.Prefs.get(pref, true) || 'page';
			}
		}

		Zotero.debug(`FlexAnnotate: filled ${open.length} locator menu(s) with `
			+ `${options.length} entries each`);
	};

	// Jedes Panel im Fenster meldet sein `load` — auch fremde. Unsere Felder stehen erst
	// beim Laden des eigenen Panels im Dokument, deshalb wird jedes Mal nachgesehen statt
	// nur einmal. Die Durchgänge laufen nacheinander, damit sich zwei nicht überholen.
	let queue = Promise.resolve();
	document.addEventListener('load', () => {
		queue = queue
			.then(fillLocatorMenus)
			.catch(e => Zotero.logError(e));
	}, true);
}
