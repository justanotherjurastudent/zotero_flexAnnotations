/**
 * Eingabemaske für Print-Annotationen — zum Anlegen und zum Nachbearbeiten.
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

	/** 'create' oder 'edit' */
	_mode: 'create',
	_item: null,
	_annotation: null,

	/**
	 * Öffnet die Maske zum Anlegen einer neuen Print-Annotation.
	 *
	 * @param {Window} window - Zotero-Hauptfenster
	 * @param {Zotero.Item} item - Reguläres Titel-Item
	 * @returns {Promise<void>}
	 */
	async open(window, item) {
		this._mode = 'create';
		this._item = item;
		this._annotation = null;

		let doc = window.document;
		await this.ensureLocatorsReady();
		let panel = this.build(window);

		this.fill(doc, {
			source: item.getDisplayTitle(),
			locator: 'page',
			pageLabel: '',
			type: 'highlight',
			color: Zotero.Annotations.DEFAULT_COLOR,
			text: '',
			comment: ''
		});
		// Der Typ bestimmt, ob Zotero ein Zitatfeld erlaubt — nachträglich nicht mehr änderbar
		doc.getElementById('flexannotate-dialog-type').disabled = false;

		this.show(window, panel);
	},

	/**
	 * Öffnet die Maske für eine bestehende Print-Annotation.
	 *
	 * @param {Window} window - Zotero-Hauptfenster
	 * @param {Zotero.Item} annotation
	 * @returns {Promise<void>}
	 */
	async openForEdit(window, annotation) {
		this._mode = 'edit';
		this._annotation = annotation;
		this._item = annotation.topLevelItem;

		let doc = window.document;
		await this.ensureLocatorsReady();
		let panel = this.build(window);

		this.fill(doc, {
			source: this._item ? this._item.getDisplayTitle() : '',
			locator: FlexAnnotate.PrintAnnotations.getLocator(annotation),
			pageLabel: annotation.annotationPageLabel || '',
			type: annotation.annotationType,
			color: annotation.annotationColor || Zotero.Annotations.DEFAULT_COLOR,
			text: annotation.annotationText || '',
			comment: annotation.annotationComment || ''
		});

		// Zotero erlaubt nur den Wechsel zwischen highlight und underline
		// (item.js:4494-4498), deshalb bleibt der Typ beim Bearbeiten fest.
		doc.getElementById('flexannotate-dialog-type').disabled = true;

		this.show(window, panel);
	},

	/**
	 * @param {Document} doc
	 * @param {Object} values
	 */
	fill(doc, values) {
		doc.getElementById('flexannotate-dialog-source').textContent = values.source;
		doc.getElementById('flexannotate-dialog-locator').value = values.locator;
		doc.getElementById('flexannotate-dialog-page').value = values.pageLabel;
		doc.getElementById('flexannotate-dialog-type').value = values.type;
		doc.getElementById('flexannotate-dialog-color').value = values.color;
		doc.getElementById('flexannotate-dialog-text').value = values.text;
		doc.getElementById('flexannotate-dialog-comment').value = values.comment;
		this.updateTextFieldState(doc);
	},

	/**
	 * @param {Window} window
	 * @param {Element} panel
	 */
	show(window, panel) {
		let x = window.screenX + Math.max(0, (window.outerWidth - 560) / 2);
		let y = window.screenY + Math.max(0, (window.outerHeight - 500) / 3);
		panel.openPopupAtScreen(x, y, false);
		window.document.getElementById('flexannotate-dialog-page').focus();
	},

	/**
	 * Legt das Panel einmalig an und liefert es bei weiteren Aufrufen wieder.
	 *
	 * @param {Window} window
	 * @returns {Element}
	 */
	build(window) {
		let doc = window.document;
		let existing = doc.getElementById(this.PANEL_ID);
		if (existing) {
			return existing;
		}

		let fragment = window.MozXULElement.parseXULToFragment(`
			<panel id="${this.PANEL_ID}" type="arrow" noautohide="true" align="stretch">
				<vbox style="padding: 12px; min-width: 500px; gap: 6px;">
					<description id="flexannotate-dialog-source" style="font-weight: bold;"/>

					<hbox align="center" style="gap: 8px;">
						<menulist id="flexannotate-dialog-locator" native="true">
							<menupopup id="flexannotate-dialog-locator-popup"/>
						</menulist>
						<html:input id="flexannotate-dialog-page" type="text" style="width: 7em;"/>

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

		this.buildLocatorMenu(doc);
		this.buildColorMenu(doc);

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
	 * Muss vor build() laufen.
	 *
	 * getLocatorString() liest Object.keys(Zotero.Styles.locales) (cite.js:52-55). Vor dem
	 * Ende von Zotero.Styles.init() ist `locales` undefined, der Aufruf wirft, und weil
	 * build() das Panel da schon eingehängt hat, bliebe die Locator-Liste bis zum nächsten
	 * Zotero-Start leer — build() liefert beim zweiten Aufruf das bestehende Panel zurück.
	 * Deshalb wird gewartet, statt den Fehler abzufangen.
	 *
	 * init() gibt eine bereits laufende Initialisierung als Promise zurück
	 * (style.js:70-77) und ist damit beliebig oft aufrufbar.
	 *
	 * @returns {Promise<void>}
	 */
	async ensureLocatorsReady() {
		await Zotero.Styles.init();
	},

	/**
	 * Locator-Typen aus Zoteros eigener Liste (Zotero.Cite.labels), beschriftet über
	 * getLocatorString() und alphabetisch sortiert — wie im Zitationsdialog
	 * (integration/citationDialog/popupHandler.mjs:132-146).
	 *
	 * @param {Document} doc
	 */
	buildLocatorMenu(doc) {
		let popup = doc.getElementById('flexannotate-dialog-locator-popup');
		let locators = Zotero.Cite.labels.map(locator => ({
			value: locator,
			label: Zotero.Cite.getLocatorString(locator)
		}));
		locators.sort((a, b) => a.label.localeCompare(b.label));

		for (let { value, label } of locators) {
			let menuitem = doc.createXULElement('menuitem');
			menuitem.setAttribute('value', value);
			menuitem.setAttribute('label', label);
			popup.appendChild(menuitem);
		}
	},

	/**
	 * Farbauswahl aus Zoteros Palette (Zotero.Annotations.COLORS).
	 *
	 * Die Namen kommen über Zotero.getString(), nicht über data-l10n-id: Die Einträge
	 * der Palette sind reine Fluent-Wertnachrichten (general-yellow = Gelb), und Fluent
	 * setzt die als textContent — ein XUL-<menuitem> zeigt aber das label-Attribut, das
	 * dabei leer bliebe. Zotero macht es an gleicher Stelle genauso
	 * (elements/zoteroSearch.js:1269).
	 *
	 * @param {Document} doc
	 */
	buildColorMenu(doc) {
		let popup = doc.getElementById('flexannotate-dialog-color-popup');

		for (let [nameKey, hex] of Zotero.Annotations.COLORS) {
			let menuitem = doc.createXULElement('menuitem');
			menuitem.setAttribute('value', hex);
			menuitem.setAttribute('label', Zotero.getString(nameKey));
			popup.appendChild(menuitem);
		}
	},

	/**
	 * Zotero erlaubt `annotationText` nur bei highlight/underline (item.js:4507),
	 * daher wird das Zitatfeld bei „Notiz" gesperrt.
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
			locator: doc.getElementById('flexannotate-dialog-locator').value,
			type: doc.getElementById('flexannotate-dialog-type').value,
			color: doc.getElementById('flexannotate-dialog-color').value,
			text: doc.getElementById('flexannotate-dialog-text').value.trim(),
			comment: doc.getElementById('flexannotate-dialog-comment').value.trim()
		};

		panel.hidePopup();

		try {
			if (this._mode === 'edit') {
				await FlexAnnotate.PrintAnnotations.update(this._annotation, data);
			}
			else {
				await FlexAnnotate.PrintAnnotations.create(this._item, data);
			}
		}
		catch (e) {
			FlexAnnotate.logError(e);
			Zotero.alert(window, 'FlexAnnotate', String(e));
		}
	}
};
