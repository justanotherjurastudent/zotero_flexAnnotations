FlexAnnotate = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,
	addedElementIDs: [],

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

	async main() {
		this.IntegrationPatch.patch();
		this.CitationDialogPatch.patch();
		this.CitaviImport.patch();
	},

	//
	// Fensterintegration
	//

	addToWindow(window) {
		let doc = window.document;

		window.MozXULElement.insertFTLIfNeeded("flexannotate.ftl");

		let itemMenu = doc.getElementById('zotero-itemmenu');
		if (!itemMenu) {
			this.log("Item context menu not found; skipping menu integration");
			return;
		}

		let separator = doc.createXULElement('menuseparator');
		separator.id = 'flexannotate-itemmenu-separator';
		itemMenu.appendChild(separator);
		this.storeAddedElement(separator);

		let addItem = doc.createXULElement('menuitem');
		addItem.id = 'flexannotate-add-print-annotation';
		addItem.classList.add('menuitem-iconic');
		addItem.setAttribute('data-l10n-id', 'flexannotate-add-print-annotation');
		addItem.addEventListener('command', () => {
			this.openPrintAnnotationDialog(window).catch(e => this.logError(e));
		});
		itemMenu.appendChild(addItem);
		this.storeAddedElement(addItem);

		// Im Item-Baum werden Print-Annotationen als eigene Zeilen unter dem Platzhalter
		// angezeigt; dort greift Zoteros eigenes Kontextmenü, nicht das an den
		// annotation-row-Elementen des rechten Bereichs. Also auch hier anbieten.
		let editItem = doc.createXULElement('menuitem');
		editItem.id = 'flexannotate-itemmenu-edit';
		editItem.classList.add('menuitem-iconic');
		editItem.setAttribute('data-l10n-id', 'flexannotate-annotation-edit');
		editItem.addEventListener('command', () => {
			let annotation = this.getSelectedPrintAnnotation(window);
			if (annotation) {
				this.Dialog.openForEdit(window, annotation).catch(e => this.logError(e));
			}
		});
		itemMenu.appendChild(editItem);
		this.storeAddedElement(editItem);

		let deleteItem = doc.createXULElement('menuitem');
		deleteItem.id = 'flexannotate-itemmenu-delete';
		deleteItem.classList.add('menuitem-iconic');
		deleteItem.setAttribute('data-l10n-id', 'flexannotate-annotation-delete');
		deleteItem.addEventListener('command', () => {
			let annotation = this.getSelectedPrintAnnotation(window);
			if (annotation) {
				this.PrintAnnotations.erase(annotation).catch(e => this.logError(e));
			}
		});
		itemMenu.appendChild(deleteItem);
		this.storeAddedElement(deleteItem);

		// buildItemContextMenu() räumt nur seine eigenen Einträge auf (zoteroPane.js:4170),
		// angehängte Plugin-Einträge bleiben bestehen. Sichtbarkeit steuern wir selbst.
		let onPopupShowing = () => this.updateMenuState(window);
		itemMenu.addEventListener('popupshowing', onPopupShowing);
		this._menuListeners = this._menuListeners || new WeakMap();
		this._menuListeners.set(window, onPopupShowing);

		this.AnnotationMenu.addToWindow(window);
		this.CitaviImport.addToWindow(window);

		this.log("Added item menu entry and annotation context menu to window");
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

	storeAddedElement(elem) {
		if (!elem.id) {
			throw new Error("Element must have an id");
		}
		this.addedElementIDs.push(elem.id);
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
		let listener = this._menuListeners?.get(window);
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
