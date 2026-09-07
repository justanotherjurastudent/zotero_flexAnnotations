"use strict";

var FlexAnnotate = {
	id: null,
	version: null,
	rootURI: null,
	_initialized: false,
	/** IDs aller selbst eingehängten Elemente, für removeFromWindow() */
	_addedElementIDs: [],

	/** WeakMap<Window, Function> — popupshowing-Listener je Fenster */
	_menuListeners: new WeakMap(),

	PREF_BRANCH: 'extensions.flexannotate.',

	/**
	 * Lädt die übrigen Module nach. Wird von bootstrap.js einmal je Sitzung gerufen.
	 *
	 * @param {Object} data - `{ id, version, rootURI }` aus startup()
	 */
	init({ id, version, rootURI }) {
		if (this._initialized) {
			return;
		}
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this._initialized = true;

		// ignoreCache wie bei Zoteros eigenem Laden von bootstrap.js (plugins.js:205-210):
		// ohne das liefert der Startup-Cache beim Entwickeln weiter die alte Fassung,
		// solange Zotero nicht mit -purgecaches gestartet wird.
		for (let file of [
			'placeholder.js',
			'printAnnotations.js',
			'integrationPatch.js',
			'dialog.js',
			'annotationMenu.js',
			'citationDialogPatch.js',
			'citaviImport.js'
		]) {
			// Ohne target lädt das Skript in den aktuellen Plugin-Scope
			Services.scriptloader.loadSubScriptWithOptions(rootURI + file, {
				ignoreCache: true
			});
		}
	},

	/**
	 * Nimmt alle Patches an internen Zotero-Funktionen zurück. Ein Fehler in einem
	 * Modul darf die übrigen nicht aufhalten, sonst bliebe ein Patch stehen.
	 */
	uninit() {
		for (let patch of [this.IntegrationPatch, this.CitationDialogPatch, this.CitaviImport]) {
			try {
				patch.unpatch();
			}
			catch (e) {
				this.logError(e);
			}
		}
	},

	/**
	 * @param {String} msg
	 */
	log(msg) {
		Zotero.debug("FlexAnnotate: " + msg);
	},

	/**
	 * Für Fehler, die abgefangen und nicht weitergereicht werden. Zotero.logError()
	 * schreibt selbst schon nach Zotero.debug() (zotero.js:1398-1403) und behält dabei
	 * den Stack — eine zweite, stringifizierte Zeile würde ihn wegwerfen.
	 *
	 * @param {Error} e
	 */
	logError(e) {
		Zotero.logError(e);
	},

	/**
	 * Setzt eine Eigenschaft auf einem fremden Objekt und weist nach, dass sie steht.
	 * Zwei Fehlerbilder sind hier möglich: ein nicht schreibbares Ziel — unter
	 * "use strict" ein TypeError — und eine Zuweisung, die nur in einem
	 * Xray-Expando landet und beim Zurücklesen nicht wieder auftaucht. Ohne diese
	 * Prüfung ist ein wirkungsloser Patch von einem gelungenen nicht zu unterscheiden.
	 *
	 * @param {Object} target
	 * @param {String} name
	 * @param {*} value
	 * @return {Boolean} true, wenn die Eigenschaft nachweislich gesetzt ist
	 */
	assignChecked(target, name, value) {
		try {
			target[name] = value;
		}
		catch (e) {
			return false;
		}
		return target[name] === value;
	},

	/**
	 * @param {String} key - Pref-Name ohne Branch
	 * @return {*}
	 */
	getPref(key) {
		return Zotero.Prefs.get(this.PREF_BRANCH + key, true);
	},

	/**
	 * @param {String} key - Pref-Name ohne Branch
	 * @param {*} value
	 */
	setPref(key, value) {
		return Zotero.Prefs.set(this.PREF_BRANCH + key, value, true);
	},

	/**
	 * Fluent-Zeichenkette aus flexannotate.ftl für Code, der kein Dokument zur Hand hat.
	 *
	 * Das Hauptfenster hat die FTL über insertFTLIfNeeded() bereits am Dokument
	 * (addToWindow), damit kennt dessen document.l10n unsere IDs. Bewusst über
	 * formatValue() statt formatValueSync(): der asynchrone Weg steht unabhängig davon
	 * bereit, ob das Dokument seine L10n synchron betreibt.
	 *
	 * @param {String} id - Fluent-ID
	 * @param {String} fallback - Greift, solange noch kein Hauptfenster steht
	 * @return {Promise<String>}
	 */
	async getString(id, fallback) {
		try {
			let window = Zotero.getMainWindow();
			return (window && await window.document.l10n.formatValue(id)) || fallback;
		}
		catch (e) {
			this.logError(e);
			return fallback;
		}
	},

	/**
	 * Setzt die Patches an internen Zotero-Funktionen. Läuft nach addToAllWindows(),
	 * weil kein Patch auf ein Hauptfenster angewiesen ist.
	 *
	 * @return {Promise<void>}
	 */
	async main() {
		this.IntegrationPatch.patch();
		this.CitationDialogPatch.patch();
		this.CitaviImport.patch();
	},

	//
	// Fensterintegration
	//

	/**
	 * Baut die Oberfläche in ein Hauptfenster. Mehrfach aufrufbar: startup() geht alle
	 * offenen Fenster durch, onMainWindowLoad() kommt für jedes neue dazu.
	 *
	 * @param {Window} window
	 */
	addToWindow(window) {
		let doc = window.document;

		window.MozXULElement.insertFTLIfNeeded("flexannotate.ftl");

		// Zuerst, weil beides eigene Wiederholungssperren hat und nicht davon abhängen
		// darf, ob das Item-Kontextmenü in diesem Fenster existiert
		this.AnnotationMenu.addToWindow(window);
		this.CitaviImport.addToWindow(window);

		let itemMenu = doc.getElementById('zotero-itemmenu');
		if (!itemMenu) {
			this.log("Item context menu not found; skipping menu integration");
			return;
		}
		if (doc.getElementById('flexannotate-itemmenu-separator')) {
			return;
		}

		let separator = doc.createXULElement('menuseparator');
		separator.id = 'flexannotate-itemmenu-separator';
		itemMenu.appendChild(separator);
		this.storeAddedElement(separator);

		this.addMenuItem(itemMenu, 'flexannotate-add-print-annotation',
			'flexannotate-add-print-annotation',
			() => this.openPrintAnnotationDialog(window));

		// Im Item-Baum erscheinen Print-Annotationen als eigene Zeilen unter dem
		// Platzhalter. Dort greift Zoteros Kontextmenü, nicht das an den
		// annotation-row-Elementen des rechten Bereichs (AnnotationMenu) — deshalb
		// stehen Bearbeiten und Löschen an beiden Stellen.
		this.addMenuItem(itemMenu, 'flexannotate-itemmenu-edit', 'flexannotate-annotation-edit',
			() => {
				let annotation = this.getSelectedPrintAnnotation(window);
				return annotation && this.Dialog.openForEdit(window, annotation);
			});

		this.addMenuItem(itemMenu, 'flexannotate-itemmenu-delete', 'flexannotate-annotation-delete',
			() => {
				let annotation = this.getSelectedPrintAnnotation(window);
				return annotation && this.PrintAnnotations.erase(annotation);
			});

		// buildItemContextMenu() räumt nur seine eigenen Einträge auf (zoteroPane.js:4170),
		// angehängte Plugin-Einträge bleiben bestehen. Sichtbarkeit steuern wir selbst.
		let onPopupShowing = () => this.updateMenuState(window);
		itemMenu.addEventListener('popupshowing', onPopupShowing);
		this._menuListeners.set(window, onPopupShowing);

		this.log("Added item menu entry and annotation context menu to window");
	},

	/**
	 * @param {Element} menu - Zielmenü
	 * @param {String} id - Element-ID, zugleich Schlüssel für removeFromWindow()
	 * @param {String} l10nID - Fluent-ID der Beschriftung
	 * @param {Function} onCommand - darf ein Promise liefern; Fehler landen im Log
	 */
	addMenuItem(menu, id, l10nID, onCommand) {
		let menuitem = menu.ownerDocument.createXULElement('menuitem');
		menuitem.id = id;
		menuitem.classList.add('menuitem-iconic');
		menuitem.setAttribute('data-l10n-id', l10nID);
		menuitem.addEventListener('command', () => {
			Promise.resolve(onCommand()).catch(e => this.logError(e));
		});
		menu.appendChild(menuitem);
		this.storeAddedElement(menuitem);
	},

	/**
	 * Blendet die eigenen Menüpunkte je nach Auswahl im Item-Baum ein oder aus.
	 *
	 * @param {Window} window
	 */
	updateMenuState(window) {
		let doc = window.document;
		let items = window.ZoteroPane?.getSelectedItems() || [];

		let canAdd = items.length === 1 && items[0].isRegularItem();
		let annotation = this.getSelectedPrintAnnotation(window);

		let visibility = {
			'flexannotate-itemmenu-separator': canAdd || !!annotation,
			'flexannotate-add-print-annotation': canAdd,
			'flexannotate-itemmenu-edit': !!annotation,
			'flexannotate-itemmenu-delete': !!annotation
		};

		for (let [id, visible] of Object.entries(visibility)) {
			let element = doc.getElementById(id);
			if (element) {
				element.hidden = !visible;
			}
		}
	},

	/**
	 * Liefert die ausgewählte Print-Annotation, sofern genau eine ausgewählt ist und
	 * sie unter einem unserer Platzhalter-Anhänge hängt.
	 *
	 * @param {Window} window
	 * @return {Zotero.Item|null}
	 */
	getSelectedPrintAnnotation(window) {
		let items = window.ZoteroPane?.getSelectedItems() || [];
		if (items.length !== 1) {
			return null;
		}
		let item = items[0];
		if (!item.isAnnotation() || !this.Placeholder.isPlaceholder(item.parentItem)) {
			return null;
		}
		return item;
	},

	/**
	 * Öffnet die Eingabemaske für das ausgewählte Titel-Item.
	 *
	 * @param {Window} window
	 * @return {Promise<void>}
	 */
	async openPrintAnnotationDialog(window) {
		let items = window.ZoteroPane?.getSelectedItems() || [];
		if (items.length !== 1 || !items[0].isRegularItem()) {
			return;
		}
		await this.Dialog.open(window, items[0]);
	},

	/**
	 * Baut die Oberfläche in alle bereits offenen Hauptfenster.
	 */
	addToAllWindows() {
		for (let win of Zotero.getMainWindows()) {
			if (!win.ZoteroPane) {
				continue;
			}
			this.addToWindow(win);
		}
	},

	/**
	 * Merkt die ID zum Aufräumen vor. Dieselbe ID kommt in jedem Fenster einmal vor,
	 * gespeichert wird sie nur einmal — removeFromWindow() räumt je Dokument auf.
	 *
	 * @param {Element} elem
	 */
	storeAddedElement(elem) {
		if (!elem.id) {
			throw new Error("Element must have an id");
		}
		if (!this._addedElementIDs.includes(elem.id)) {
			this._addedElementIDs.push(elem.id);
		}
	},

	/**
	 * Nimmt die Oberfläche aus einem Hauptfenster zurück.
	 *
	 * @param {Window} window
	 */
	removeFromWindow(window) {
		let doc = window.document;

		for (let feature of [this.AnnotationMenu, this.CitaviImport]) {
			try {
				feature.removeFromWindow(window);
			}
			catch (e) {
				this.logError(e);
			}
		}

		let itemMenu = doc.getElementById('zotero-itemmenu');
		let listener = this._menuListeners.get(window);
		if (itemMenu && listener) {
			itemMenu.removeEventListener('popupshowing', listener);
			this._menuListeners.delete(window);
		}

		for (let id of this._addedElementIDs) {
			doc.getElementById(id)?.remove();
		}
		doc.querySelector('[href="flexannotate.ftl"]')?.remove();
	},

	/**
	 * Nimmt die Oberfläche aus allen Hauptfenstern zurück.
	 */
	removeFromAllWindows() {
		for (let win of Zotero.getMainWindows()) {
			if (!win.ZoteroPane) {
				continue;
			}
			this.removeFromWindow(win);
		}
	}
};
