/**
 * Auswahl „Vollnachweis / Nur Nachweis" im Zitationsdialog von Word und LibreOffice.
 *
 * Der Dialog ist ein eigenes Fenster
 * (chrome://zotero/content/integration/citationDialog.xhtml, integration.js:1611).
 * Wir hängen uns per Fenster-Beobachter ein und ergänzen die Auswahl an zwei Stellen:
 *
 *  1. im Einstellungs-Popup (Zahnrad), neben Zoteros eigener Annotations-Option
 *     „Kommentare einbeziehen" (citationDialog.xhtml:193-196)
 *  2. im Popup, das beim Klick auf einen Eintrag in der Leiste aufgeht, zwischen
 *     Annotationsvorschau und Knopfleiste (citationDialog.xhtml:176-184)
 *
 * Beide zeigen dieselbe Einstellung — wer das Zahnrad nicht findet, stolpert über die
 * zweite. Sie gilt für den gesamten Einfügevorgang, nicht je Eintrag; deshalb werden
 * alle sichtbaren Auswahlfelder gemeinsam nachgeführt.
 *
 * Verifiziert gegen Zotero 10.0.1:
 *  - citationDialog.js:244-248 blendet [data-dialog-type]-Elemente je nach Modus selbst
 *    ein und aus; da wir erst danach einhängen, setzen wir den Anfangszustand selbst
 *    und folgen Wechseln über einen MutationObserver auf dialog-type
 *  - citationDialog.js:281 füllt includeComments genauso aus einem Pref, wie wir es tun
 */
FlexAnnotate.CitationDialogPatch = {
	DIALOG_URL: 'chrome://zotero/content/integration/citationDialog.xhtml',
	ROW_CLASS: 'flexannotate-citation-mode-row',
	SELECT_CLASS: 'flexannotate-citation-mode',

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
		FlexAnnotate.log("Watching for citation dialogs (settings popup + item popup)");
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
				for (let row of window.document?.querySelectorAll('.' + this.ROW_CLASS) || []) {
					row.remove();
				}
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
				this.inject(window);
			}
			catch (e) {
				// Nie den Zitationsdialog mitreißen: ohne unsere Auswahl bleibt er benutzbar.
				FlexAnnotate.logError(e);
			}
		}, { once: true });
	},

	/**
	 * @param {Window} window - Zitationsdialog
	 */
	inject(window) {
		let doc = window.document;
		if (doc.querySelector('.' + this.ROW_CLASS)) {
			return;
		}

		let rows = [];

		let settingsPopup = doc.querySelector('#settings-popup .popup');
		if (settingsPopup) {
			let row = this.createRow(doc, 'settings');
			settingsPopup.appendChild(row);
			rows.push(row);
		}

		// Im Eintrags-Popup vor die Knopfleiste, damit „Entfernen / In Bibliothek
		// anzeigen / Erledigt" unten bleiben
		let detailsPopup = doc.querySelector('#itemDetails .popup');
		let buttons = detailsPopup?.querySelector('.buttons');
		if (detailsPopup && buttons) {
			let row = this.createRow(doc, 'details');
			detailsPopup.insertBefore(row, buttons);
			rows.push(row);
		}

		if (!rows.length) {
			FlexAnnotate.log("No injection point found in citation dialog; skipping mode selector");
			return;
		}

		this.localize(doc, rows);
		this.trackDialogType(doc, rows);
		FlexAnnotate.log(`Added citation mode selector to citation dialog (${rows.length} location(s))`);
	},

	/**
	 * @param {Document} doc
	 * @param {String} suffix - Unterscheidet die beiden Einbauorte in den Element-IDs
	 * @returns {Element}
	 */
	createRow(doc, suffix) {
		let selectID = `${this.SELECT_CLASS}-${suffix}`;

		let row = doc.createElement('div');
		row.className = `hbox ${this.ROW_CLASS}`;
		// Zotero blendet Zeilen anhand dieses Attributs je nach Dialogmodus ein und aus
		row.setAttribute('data-dialog-type', 'annotations');
		row.style.alignItems = 'center';
		row.style.gap = '6px';

		let label = doc.createElement('label');
		label.setAttribute('for', selectID);
		label.setAttribute('data-l10n-id', 'flexannotate-dialog-mode-label');

		let select = doc.createElement('select');
		select.id = selectID;
		select.className = this.SELECT_CLASS;
		// fx128: size="0" erzwingt den nativen Stil, wie bei Zoteros eigenem #label
		select.setAttribute('size', '0');

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
			this.syncSelects(doc, select.value);
			FlexAnnotate.log(`Citation mode set to '${select.value}'`);
		});

		row.append(label, select);
		return row;
	},

	/**
	 * Hält die Auswahlfelder beider Einbauorte auf demselben Stand.
	 *
	 * @param {Document} doc
	 * @param {String} value
	 */
	syncSelects(doc, value) {
		for (let select of doc.querySelectorAll('.' + this.SELECT_CLASS)) {
			if (select.value !== value) {
				select.value = value;
			}
		}
	},

	/**
	 * Hängt die Plugin-FTL an das Dialogdokument. Zotero registriert die FTLs aller
	 * Plugins in einer gemeinsamen L10n-Quelle (plugins.js: registerLocales), das
	 * Dokument selbst kennt sie aber nicht — der Ressourcenname muss nachgereicht werden.
	 *
	 * @param {Document} doc
	 * @param {Element[]} rows
	 */
	localize(doc, rows) {
		try {
			doc.l10n.addResourceIds(['flexannotate.ftl']);
			for (let row of rows) {
				doc.l10n.translateFragment(row);
			}
		}
		catch (e) {
			FlexAnnotate.logError(e);
			// Notnagel, damit die Auswahl nicht unbeschriftet dasteht
			let german = (Zotero.locale || '').startsWith('de');
			for (let row of rows) {
				row.querySelector('label').textContent = german ? 'Einfügen als' : 'Insert as';
				let options = row.querySelector('select').options;
				options[0].textContent = german ? 'Vollnachweis' : 'Full annotation';
				options[1].textContent = german ? 'Nur Nachweis' : 'Citation only';
			}
		}
	},

	/**
	 * Setzt die Sichtbarkeit passend zum aktuellen Dialogmodus und folgt späteren
	 * Wechseln. Nötig, weil citationDialog.js die [data-dialog-type]-Elemente beim
	 * Moduswechsel durchgeht — unsere Zeilen werden aber erst danach eingehängt.
	 *
	 * @param {Document} doc
	 * @param {Element[]} rows
	 */
	trackDialogType(doc, rows) {
		let apply = () => {
			let isAnnotations = doc.documentElement.getAttribute('dialog-type') === 'annotations';
			for (let row of rows) {
				row.hidden = !isAnnotations;
			}
		};
		apply();

		let observer = new doc.defaultView.MutationObserver(apply);
		observer.observe(doc.documentElement, {
			attributes: true,
			attributeFilter: ['dialog-type']
		});
	}
};
