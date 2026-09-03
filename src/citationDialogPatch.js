/**
 * Auswahlfeld „Vollnachweis / Nur Nachweis" im Zitationsdialog von Word und LibreOffice.
 *
 * Der Dialog ist ein eigenes Fenster
 * (chrome://zotero/content/integration/citationDialog.xhtml, integration.js:1611).
 * Wir hängen uns per Fenster-Beobachter ein und ergänzen im Einstellungs-Popup eine
 * Zeile neben Zoteros eigener Annotations-Option „Kommentare einbeziehen".
 *
 * Verifiziert gegen Zotero 10.0.1:
 *  - citationDialog.xhtml: #settings-popup enthält Zeilen der Form
 *    <div class="hbox" data-dialog-type="annotations">…</div>
 *  - citationDialog.js:244-248 blendet alle [data-dialog-type]-Elemente je nach Modus
 *    selbst ein und aus; wir setzen den Anfangszustand und folgen späteren Wechseln
 *  - citationDialog.js:281 füllt includeComments genauso aus einem Pref, wie wir es hier tun
 *
 * Das Popup am einzelnen Eintrag kommt als Ort nicht in Frage: im Annotations-Modus
 * zeigt Zotero dort nur eine Vorschau und kehrt vorher zurück (popupHandler.mjs:118).
 * „Voll oder nur Nachweis" gilt ohnehin für den gesamten Einfügevorgang.
 */
FlexAnnotate.CitationDialogPatch = {
	DIALOG_URL: 'chrome://zotero/content/integration/citationDialog.xhtml',
	ROW_ID: 'flexannotate-citation-mode-row',
	SELECT_ID: 'flexannotate-citation-mode',

	_observer: null,

	/** Beginnt, auf sich öffnende Zitationsdialoge zu achten. */
	patch() {
		if (this._observer) {
			return;
		}
		this._observer = {
			observe: (subject, topic) => {
				if (topic !== 'domwindowopened') {
					return;
				}
				try {
					this.onWindowOpened(subject);
				}
				catch (e) {
					FlexAnnotate.logError(e);
				}
			}
		};
		Services.ww.registerNotification(this._observer);
		FlexAnnotate.log("Watching for citation dialogs");
	},

	unpatch() {
		if (!this._observer) {
			return;
		}
		Services.ww.unregisterNotification(this._observer);
		this._observer = null;

		// Bereits offene Dialoge aufräumen
		for (let window of Services.wm.getEnumerator(null)) {
			try {
				window.document?.getElementById(this.ROW_ID)?.remove();
			}
			catch (e) {}
		}
		FlexAnnotate.log("Stopped watching for citation dialogs");
	},

	/**
	 * @param {Window} window - Frisch geöffnetes Fenster, Dokument noch nicht geladen
	 */
	onWindowOpened(window) {
		window.addEventListener('load', () => {
			if (window.location?.href !== this.DIALOG_URL) {
				return;
			}
			try {
				this.injectRow(window);
			}
			catch (e) {
				// Nie den Zitationsdialog mitreißen: ohne unser Feld bleibt er voll benutzbar.
				FlexAnnotate.logError(e);
			}
		}, { once: true });
	},

	/**
	 * @param {Window} window - Zitationsdialog
	 */
	injectRow(window) {
		let doc = window.document;
		if (doc.getElementById(this.ROW_ID)) {
			return;
		}

		let popup = doc.querySelector('#settings-popup .popup');
		if (!popup) {
			FlexAnnotate.log("Citation dialog settings popup not found; skipping mode selector");
			return;
		}

		let row = doc.createElement('div');
		row.className = 'hbox';
		row.id = this.ROW_ID;
		// Zotero blendet Zeilen anhand dieses Attributs je nach Dialogmodus ein und aus
		row.setAttribute('data-dialog-type', 'annotations');

		let label = doc.createElement('label');
		label.setAttribute('for', this.SELECT_ID);
		label.setAttribute('data-l10n-id', 'flexannotate-dialog-mode-label');

		let select = doc.createElement('select');
		select.id = this.SELECT_ID;
		for (let [value, l10nID] of [
			['full', 'flexannotate-dialog-mode-full'],
			['citation', 'flexannotate-dialog-mode-citation']
		]) {
			let option = doc.createElement('option');
			option.value = value;
			option.setAttribute('data-l10n-id', l10nID);
			select.appendChild(option);
		}

		select.value = FlexAnnotate.getPref('citationOnly') ? 'citation' : 'full';
		select.addEventListener('change', () => {
			FlexAnnotate.setPref('citationOnly', select.value === 'citation');
			FlexAnnotate.log(`Citation mode set to '${select.value}'`);
		});

		row.append(label, select);
		popup.appendChild(row);

		this.localize(doc, row);
		this.trackDialogType(doc, row);
	},

	/**
	 * Hängt die Plugin-FTL an das Dialogdokument. Zotero registriert die FTLs aller
	 * Plugins in einer gemeinsamen L10n-Quelle (plugins.js: registerLocales), das
	 * Dokument selbst kennt sie aber nicht — der Ressourcenname muss nachgereicht werden.
	 *
	 * @param {Document} doc
	 * @param {Element} row
	 */
	localize(doc, row) {
		try {
			doc.l10n.addResourceIds(['flexannotate.ftl']);
			doc.l10n.translateFragment(row);
		}
		catch (e) {
			FlexAnnotate.logError(e);
			// Notnagel, damit die Auswahl nicht unbeschriftet dasteht
			let german = (Zotero.locale || '').startsWith('de');
			doc.getElementById(this.SELECT_ID).previousElementSibling.textContent
				= german ? 'Einfügen als' : 'Insert as';
			let options = doc.getElementById(this.SELECT_ID).options;
			options[0].textContent = german ? 'Vollständige Annotation' : 'Full annotation';
			options[1].textContent = german ? 'Nur Nachweis' : 'Citation only';
		}
	},

	/**
	 * Setzt die Sichtbarkeit passend zum aktuellen Dialogmodus und folgt späteren
	 * Wechseln. Nötig, weil citationDialog.js die [data-dialog-type]-Elemente beim
	 * Moduswechsel durchgeht — unsere Zeile wird aber erst danach eingehängt.
	 *
	 * @param {Document} doc
	 * @param {Element} row
	 */
	trackDialogType(doc, row) {
		let apply = () => {
			let type = doc.documentElement.getAttribute('dialog-type');
			row.hidden = type !== 'annotations';
		};
		apply();

		let observer = new doc.defaultView.MutationObserver(apply);
		observer.observe(doc.documentElement, {
			attributes: true,
			attributeFilter: ['dialog-type']
		});
	}
};
