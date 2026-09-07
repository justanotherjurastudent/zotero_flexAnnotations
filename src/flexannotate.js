FlexAnnotate = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,
	addedElementIDs: [],

	/** WeakMap<Window, Function> — popupshowing-Listener je Fenster */
	_menuListeners: new WeakMap(),

	PREF_BRANCH: 'extensions.flexannotate.',

	init({ id, version, rootURI }) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.initialized = true;

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

	log(msg) {
		Zotero.debug("FlexAnnotate: " + msg);
	},

	logError(e) {
		Zotero.logError(e);
		Zotero.debug("FlexAnnotate: " + e);
	},

	/**
	 * @param {String} key - Pref-Name ohne Branch
	 * @returns {*}
	 */
	getPref(key) {
		return Zotero.Prefs.get(this.PREF_BRANCH + key, true);
	},

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
	 * @returns {Promise<String>}
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
	 * @returns {Zotero.Item|null}
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
	 * @returns {Promise<void>}
	 */
	async openPrintAnnotationDialog(window) {
		let items = window.ZoteroPane?.getSelectedItems() || [];
		if (items.length !== 1 || !items[0].isRegularItem()) {
			return;
		}
		await this.Dialog.open(window, items[0]);
	},

	addToAllWindows() {
		for (let win of Zotero.getMainWindows()) {
			if (!win.ZoteroPane) continue;
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
		if (!this.addedElementIDs.includes(elem.id)) {
			this.addedElementIDs.push(elem.id);
		}
	},

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

		for (let id of this.addedElementIDs) {
			doc.getElementById(id)?.remove();
		}
		doc.querySelector('[href="flexannotate.ftl"]')?.remove();
	},

	removeFromAllWindows() {
		for (let win of Zotero.getMainWindows()) {
			if (!win.ZoteroPane) continue;
			this.removeFromWindow(win);
		}
	}
};
