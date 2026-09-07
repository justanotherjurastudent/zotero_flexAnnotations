/**
 * Kontextmenü an Print-Annotationen im Item-Bereich.
 *
 * Zotero zeichnet Annotationen im Anhang-Abschnitt als <annotation-row
 * annotation-id="…"> (elements/attachmentAnnotationsBox.js:134). Ein eigenes
 * Kontextmenü bringen diese Zeilen nicht mit, deshalb hängen wir eins an.
 *
 * Der Listener sitzt am Dokument statt an den einzelnen Zeilen: die Zeilen werden bei
 * jeder Auswahländerung neu aufgebaut, ein delegierter Listener überlebt das.
 * Er greift ausschließlich bei Annotationen unter einem Platzhalter-Anhang — fremde
 * Annotationen (PDF, EPUB) bleiben unangetastet.
 */
FlexAnnotate.AnnotationMenu = {
	POPUP_ID: 'flexannotate-annotation-popup',

	/** WeakMap<Window, Function> — contextmenu-Listener je Fenster */
	_listeners: new WeakMap(),
	/** Annotation, auf der das Menü zuletzt geöffnet wurde */
	_current: null,

	/**
	 * @param {Window} window - Zotero-Hauptfenster
	 */
	addToWindow(window) {
		let doc = window.document;
		if (doc.getElementById(this.POPUP_ID)) {
			return;
		}

		let fragment = window.MozXULElement.parseXULToFragment(`
			<menupopup id="${this.POPUP_ID}">
				<menuitem id="flexannotate-annotation-edit"
					data-l10n-id="flexannotate-annotation-edit"/>
				<menuitem id="flexannotate-annotation-delete"
					data-l10n-id="flexannotate-annotation-delete"/>
			</menupopup>
		`);
		doc.documentElement.appendChild(fragment);

		let popup = doc.getElementById(this.POPUP_ID);
		FlexAnnotate.storeAddedElement(popup);

		doc.getElementById('flexannotate-annotation-edit')
			.addEventListener('command', () => {
				let annotation = this._current;
				if (annotation) {
					FlexAnnotate.Dialog.openForEdit(window, annotation)
						.catch(e => FlexAnnotate.logError(e));
				}
			});
		doc.getElementById('flexannotate-annotation-delete')
			.addEventListener('command', () => {
				let annotation = this._current;
				if (annotation) {
					FlexAnnotate.PrintAnnotations.erase(annotation)
						.catch(e => FlexAnnotate.logError(e));
				}
			});

		let onContextMenu = (event) => {
			try {
				this.onContextMenu(window, event, popup);
			}
			catch (e) {
				FlexAnnotate.logError(e);
			}
		};
		doc.addEventListener('contextmenu', onContextMenu, true);
		this._listeners.set(window, onContextMenu);
	},

	/**
	 * @param {Window} window
	 */
	removeFromWindow(window) {
		let listener = this._listeners.get(window);
		if (listener) {
			window.document.removeEventListener('contextmenu', listener, true);
			this._listeners.delete(window);
		}
		window.document.getElementById(this.POPUP_ID)?.remove();
	},

	/**
	 * @param {Window} window
	 * @param {Event} event
	 * @param {Element} popup
	 */
	onContextMenu(window, event, popup) {
		let row = event.target?.closest?.('annotation-row');
		if (!row) {
			return;
		}

		let id = parseInt(row.getAttribute('annotation-id'), 10);
		if (!id) {
			return;
		}

		let annotation = Zotero.Items.get(id);
		if (!annotation || !annotation.isAnnotation()) {
			return;
		}
		// Nur unsere eigenen Print-Annotationen, keine aus PDFs oder EPUBs
		if (!FlexAnnotate.Placeholder.isPlaceholder(annotation.parentItem)) {
			return;
		}

		this._current = annotation;
		event.preventDefault();
		event.stopPropagation();
		popup.openPopupAtScreen(event.screenX, event.screenY, true);
	}
};
