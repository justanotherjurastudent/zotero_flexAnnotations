/**
 * Eingabemaske für Print-Annotationen.
 *
 * Warum kein eigenes Dialogfenster: XUL-Elemente werden nur in privilegierten
 * chrome-Dokumenten geparst. Ein Plugin kann in Zotero 10 keine chrome://-URI
 * registrieren (plugins.js kennt kein chrome.manifest), und über window.openDialog()
 * mit einer file://- oder jar:-URL bleibt das Fenster deshalb leer — die Elemente
 * gelten als unbekannte Tags und auch onload-Attribute feuern nicht.
 *
 * Zotero baut seine gesamte eigene Oberfläche stattdessen mit
 * MozXULElement.parseXULToFragment() direkt im Hauptfenster (siehe elements/*.js).
 * Genau das machen wir hier: ein <panel> im bereits privilegierten Hauptfenster,
 * das auch schon unsere FTL geladen hat.
 */
FlexAnnotate.Dialog = {
	PANEL_ID: 'flexannotate-print-annotation-panel',

	/**
	 * Öffnet die Maske und legt bei Bestätigung die Annotation an.
	 *
	 * @param {Window} window - Zotero-Hauptfenster
	 * @param {Zotero.Item} item - Reguläres Titel-Item
	 * @returns {Promise<void>}
	 */
	async open(window, item) {
		let doc = window.document;
		let panel = this.build(window, item);

		doc.getElementById('flexannotate-dialog-source').textContent = item.getDisplayTitle();
		doc.getElementById('flexannotate-dialog-page').value = '';
		doc.getElementById('flexannotate-dialog-text').value = '';
		doc.getElementById('flexannotate-dialog-comment').value = '';
		doc.getElementById('flexannotate-dialog-type').value = 'highlight';
		doc.getElementById('flexannotate-dialog-color').value = Zotero.Annotations.DEFAULT_COLOR;
		this.updateTextFieldState(doc);

		// Mittig über dem Hauptfenster
		let x = window.screenX + Math.max(0, (window.outerWidth - 520) / 2);
		let y = window.screenY + Math.max(0, (window.outerHeight - 460) / 3);
		panel.openPopupAtScreen(x, y, false);

		doc.getElementById('flexannotate-dialog-page').focus();
	},

	/**
	 * Legt das Panel einmalig an und liefert es bei weiteren Aufrufen wieder.
	 *
	 * @param {Window} window
	 * @param {Zotero.Item} item
	 * @returns {Element}
	 */
	build(window, item) {
		let doc = window.document;
		let existing = doc.getElementById(this.PANEL_ID);
		if (existing) {
			this._item = item;
			return existing;
		}
		this._item = item;

		let fragment = window.MozXULElement.parseXULToFragment(`
			<panel id="${this.PANEL_ID}" type="arrow" noautohide="true" align="stretch">
				<vbox style="padding: 12px; min-width: 460px; gap: 6px;">
					<description id="flexannotate-dialog-source" style="font-weight: bold;"/>

					<hbox align="center" style="gap: 8px;">
						<label data-l10n-id="flexannotate-field-page" control="flexannotate-dialog-page"/>
						<html:input id="flexannotate-dialog-page" type="text" style="width: 6em;"/>

						<label data-l10n-id="flexannotate-field-type" control="flexannotate-dialog-type"/>
						<menulist id="flexannotate-dialog-type" native="true">
							<menupopup>
								<menuitem value="highlight" data-l10n-id="flexannotate-type-highlight"/>
								<menuitem value="underline" data-l10n-id="flexannotate-type-underline"/>
								<menuitem value="note" data-l10n-id="flexannotate-type-note"/>
							</menupopup>
						</menulist>

						<label data-l10n-id="flexannotate-field-color" control="flexannotate-dialog-color"/>
						<menulist id="flexannotate-dialog-color" native="true">
							<menupopup id="flexannotate-dialog-color-popup"/>
						</menulist>
					</hbox>

					<label data-l10n-id="flexannotate-field-text" control="flexannotate-dialog-text"/>
					<html:textarea id="flexannotate-dialog-text" rows="5"/>

					<label data-l10n-id="flexannotate-field-comment" control="flexannotate-dialog-comment"/>
					<html:textarea id="flexannotate-dialog-comment" rows="3"/>

					<hbox pack="end" style="gap: 8px; margin-top: 6px;">
						<button id="flexannotate-dialog-cancel" data-l10n-id="flexannotate-button-cancel" native="true"/>
						<button id="flexannotate-dialog-accept" data-l10n-id="flexannotate-button-save" native="true" default="true"/>
					</hbox>
				</vbox>
			</panel>
		`);

		doc.documentElement.appendChild(fragment);
		let panel = doc.getElementById(this.PANEL_ID);
		FlexAnnotate.storeAddedElement(panel);

		// Farbauswahl aus Zoteros eigener Palette (Zotero.Annotations.COLORS)
		let colorPopup = doc.getElementById('flexannotate-dialog-color-popup');
		for (let [l10nKey, hex] of Zotero.Annotations.COLORS) {
			let menuitem = doc.createXULElement('menuitem');
			menuitem.setAttribute('value', hex);
			menuitem.setAttribute('label', hex);
			menuitem.setAttribute('data-l10n-id', l10nKey);
			colorPopup.appendChild(menuitem);
		}

		doc.getElementById('flexannotate-dialog-type')
			.addEventListener('command', () => this.updateTextFieldState(doc));
		doc.getElementById('flexannotate-dialog-cancel')
			.addEventListener('command', () => panel.hidePopup());
		doc.getElementById('flexannotate-dialog-accept')
			.addEventListener('command', () => {
				this.accept(window, panel).catch(e => FlexAnnotate.logError(e));
			});
		panel.addEventListener('keypress', (event) => {
			if (event.key === 'Escape') {
				panel.hidePopup();
			}
		});

		return panel;
	},

	/**
	 * Zotero erlaubt `annotationText` nur bei highlight/underline (item.js:4507),
	 * daher wird das Zitatfeld bei "Notiz" gesperrt.
	 *
	 * @param {Document} doc
	 */
	updateTextFieldState(doc) {
		let type = doc.getElementById('flexannotate-dialog-type').value;
		let textField = doc.getElementById('flexannotate-dialog-text');
		let supportsText = ['highlight', 'underline'].includes(type);

		textField.disabled = !supportsText;
		textField.style.opacity = supportsText ? '1' : '0.5';
	},

	/**
	 * @param {Window} window
	 * @param {Element} panel
	 * @returns {Promise<void>}
	 */
	async accept(window, panel) {
		let doc = window.document;
		let pageField = doc.getElementById('flexannotate-dialog-page');
		let page = pageField.value.trim();
		if (!page) {
			pageField.focus();
			return;
		}

		let data = {
			pageLabel: page,
			type: doc.getElementById('flexannotate-dialog-type').value,
			color: doc.getElementById('flexannotate-dialog-color').value,
			text: doc.getElementById('flexannotate-dialog-text').value.trim(),
			comment: doc.getElementById('flexannotate-dialog-comment').value.trim()
		};

		panel.hidePopup();

		try {
			await FlexAnnotate.PrintAnnotations.create(this._item, data);
		}
		catch (e) {
			FlexAnnotate.logError(e);
			Zotero.alert(window, 'FlexAnnotate', String(e));
		}
	}
};
