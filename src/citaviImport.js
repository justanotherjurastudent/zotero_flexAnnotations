/**
 * Citavi-Import: Zitate ohne Dateianhang als Print-Annotationen übernehmen.
 *
 * Zoteros Importer verwirft sie. Er läuft über `//Annotations/Annotation` — Knoten, die
 * PDF-Koordinaten (`Quads`) tragen — und steigt zusätzlich aus, wenn die Quelle keinen
 * Anhang hat (import/citavi.js:76-80):
 *
 *     const itemAttachmentIDs = item.getAttachments();
 *     if (itemAttachmentIDs.length === 0) {
 *       continue;
 *     }
 *
 * Zitate an Printquellen haben gar keinen `<Annotation>`-Knoten, sondern existieren nur
 * als `<KnowledgeItem>`. Dieser Durchlauf holt sie nach.
 *
 * Einhängepunkt: fileInterface.js:686 ruft `(0, _citavi.ImportCitaviAnnotatons)(...)` auf.
 * Die Eigenschaft wird zum Aufrufzeitpunkt vom Modulobjekt gelesen, deshalb genügt es,
 * sie dort zu ersetzen. `require.js` und `fileInterface.js` werden in dasselbe
 * Fensterobjekt geladen (zoteroPane.xhtml:62,83), `window.require` liefert also genau
 * die Modulinstanz, die fileInterface.js verwendet.
 */
FlexAnnotate.CitaviImport = {
	MODULE: 'zotero/import/citavi',
	/** Schreibfehler im Namen stammt aus Zotero und muss so bleiben */
	EXPORT_NAME: 'ImportCitaviAnnotatons',

	_hooks: null,

	/**
	 * Farben und Feldbelegung je Citavi-Zitattyp, wie in import/citavi.js:117-148.
	 */
	QUOTATION_TYPES: {
		1: { color: '#2ea8e5' }, // direktes Zitat
		2: { color: '#a6507b', swap: true }, // indirektes Zitat
		3: { color: '#5fb236' }, // Zusammenfassung
		4: { color: '#ff8c19' }, // Kommentar
		5: { color: '#ffd400', dropComment: true }, // Hervorhebung gelb
		6: { color: '#ff6666', dropComment: true } // Hervorhebung rot
	},

	/**
	 * Citavis Nummerierungsart (`<nt>` in PageRange) auf einen CSL-Locator abbilden.
	 * Ohne Angabe meint Citavi eine Seite.
	 */
	LOCATOR_BY_NUMBER_TYPE: {
		Margin: 'paragraph' // Randnummer
	},

	/**
	 * @param {Window} window - Zotero-Hauptfenster
	 */
	addToWindow(window) {
		if (this._hooks?.has(window)) {
			return;
		}
		if (typeof window.require !== 'function') {
			FlexAnnotate.log("window.require not available; Citavi import hook skipped");
			return;
		}

		let module;
		try {
			module = window.require(this.MODULE);
		}
		catch (e) {
			FlexAnnotate.logError(e);
			return;
		}

		if (!module || typeof module[this.EXPORT_NAME] !== 'function') {
			Zotero.warn(`FlexAnnotate: ${this.MODULE}.${this.EXPORT_NAME} not found — `
				+ "Citavi-Zitate ohne Anhang werden nicht importiert.");
			return;
		}

		let original = module[this.EXPORT_NAME];
		let self = this;

		module[this.EXPORT_NAME] = async function (translation) {
			// Zoteros eigener Durchlauf zuerst, damit PDF-Zitate unverändert ankommen
			await original.apply(this, arguments);
			try {
				await self.importPrintQuotes(translation);
			}
			catch (e) {
				// Ein Fehler hier darf den Import nicht nachträglich scheitern lassen
				FlexAnnotate.logError(e);
			}
		};

		this._hooks = this._hooks || new WeakMap();
		this._hooks.set(window, { module, original });
		FlexAnnotate.log("Hooked Citavi import");
	},

	/**
	 * @param {Window} window
	 */
	removeFromWindow(window) {
		let hook = this._hooks?.get(window);
		if (!hook) {
			return;
		}
		hook.module[this.EXPORT_NAME] = hook.original;
		this._hooks.delete(window);
		FlexAnnotate.log("Removed Citavi import hook");
	},

	/**
	 * Legt für jedes Citavi-Zitat, das Zotero nicht übernommen hat, eine
	 * Print-Annotation an.
	 *
	 * @param {Object} translation
	 * @returns {Promise<Number>} Anzahl angelegter Annotationen
	 */
	async importPrintQuotes(translation) {
		let idMap = translation?._itemSaver?._IDMap;
		if (!idMap) {
			FlexAnnotate.log("Citavi import: no ID map available");
			return 0;
		}

		// Der Stream ist nach Zoteros Durchlauf verbraucht — genauso re-initialisiert
		// import/citavi.js:14 ihn zu Beginn.
		translation._io.init('xml/dom');
		let doc = translation._sandboxZotero.getXML();
		let ZU = translation._sandboxZotero.Utilities;

		// KnowledgeItems mit EntityLink sind an einer PDF-Stelle verankert
		let anchored = new Set(
			ZU.xpath(doc, '//EntityLinks/EntityLink/SourceID').map(node => node.textContent)
		);

		let created = 0;
		let attachmentCache = new Map();

		for (let node of ZU.xpath(doc, '//KnowledgeItems/KnowledgeItem')) {
			let knowledgeItemID = ZU.xpathText(node, '@id');
			let referenceID = ZU.xpathText(node, './ReferenceID');
			if (!referenceID) {
				continue;
			}

			let itemID = idMap[referenceID];
			if (!itemID) {
				continue;
			}

			let item = await Zotero.Items.getAsync(itemID);
			if (!item || !item.isRegularItem()) {
				continue;
			}

			// Zotero hat das Zitat nur dann übernommen, wenn es verankert ist UND die
			// Quelle einen annotierbaren Anhang hat (import/citavi.js:76-80).
			if (anchored.has(knowledgeItemID)) {
				if (!attachmentCache.has(item.id)) {
					attachmentCache.set(item.id, this.hasAnnotatableAttachment(item));
				}
				if (attachmentCache.get(item.id)) {
					continue;
				}
			}

			let data = this.buildAnnotationData(ZU, node);
			if (!data.text && !data.comment) {
				continue;
			}

			await FlexAnnotate.PrintAnnotations.create(item, data);
			created++;
		}

		FlexAnnotate.log(`Citavi import: created ${created} print annotation(s)`);
		return created;
	},

	/**
	 * @param {Zotero.Item} item
	 * @returns {Boolean} true, wenn ein Anhang existiert, den Zotero annotieren kann
	 */
	hasAnnotatableAttachment(item) {
		for (let attachment of Zotero.Items.get(item.getAttachments())) {
			if (attachment.attachmentReaderType
					&& !FlexAnnotate.Placeholder.isPlaceholder(attachment)) {
				return true;
			}
		}
		return false;
	},

	/**
	 * Übersetzt ein Citavi-KnowledgeItem in die Felder einer Print-Annotation.
	 *
	 * @param {Object} ZU - Zotero.Utilities aus der Übersetzungs-Sandbox
	 * @param {Element} node - <KnowledgeItem>
	 * @returns {Object}
	 */
	buildAnnotationData(ZU, node) {
		let coreStatement = (ZU.xpathText(node, './CoreStatement') || '').trim();
		let quoteText = (ZU.xpathText(node, './Text') || '').trim();
		let quotationType = ZU.xpathText(node, './QuotationType');
		let settings = this.QUOTATION_TYPES[quotationType] || this.QUOTATION_TYPES[1];

		let text, comment;
		if (settings.swap) {
			// Indirektes Zitat: Kernaussage ist der Text, das Original der Kommentar
			text = coreStatement;
			comment = quoteText;
		}
		else {
			// Abweichung von import/citavi.js: Dort bleibt der Zitattext leer, wenn
			// Citavi nur eine Kernaussage führt — bei von Hand erfassten Printzitaten
			// ist das der Regelfall und ergäbe eine Annotation ohne Inhalt.
			text = quoteText || coreStatement;
			comment = quoteText ? coreStatement : '';
		}
		if (settings.dropComment) {
			comment = '';
		}

		let { pageLabel, locator } = this.parsePageRange(ZU, node);

		return {
			type: 'highlight',
			color: settings.color,
			text,
			comment,
			pageLabel,
			locator,
			tags: this.getKeywords(ZU, node)
		};
	},

	/**
	 * Citavis <PageRange> ist eingebettetes Markup, z. B.
	 * `<sp> <n>128</n> <nt>Margin</nt> <os>128</os> </sp>`.
	 * `<os>` ist die Anzeigeform, `<nt>` die Nummerierungsart.
	 *
	 * @param {Object} ZU
	 * @param {Element} node - <KnowledgeItem>
	 * @returns {{pageLabel: String, locator: String}}
	 */
	parsePageRange(ZU, node) {
		let raw = ZU.xpathText(node, './PageRange') || '';
		let displayed = raw.match(/<os>([\s\S]*?)<\/os>/);
		let numberType = raw.match(/<nt>([\s\S]*?)<\/nt>/);

		let pageLabel = displayed ? displayed[1].trim() : '';
		if (!pageLabel) {
			let number = ZU.xpathText(node, './PageRangeNumber');
			// Citavi schreibt -1, wenn keine Seite erfasst ist
			pageLabel = number && number !== '-1' ? number : '';
		}

		let locator = numberType
			? (this.LOCATOR_BY_NUMBER_TYPE[numberType[1].trim()] || 'page')
			: 'page';

		return { pageLabel, locator };
	},

	/**
	 * Schlagwörter des Zitats, wie import/citavi.js:58-65 sie ermittelt.
	 *
	 * @param {Object} ZU
	 * @param {Element} node - <KnowledgeItem>
	 * @returns {String[]}
	 */
	getKeywords(ZU, node) {
		try {
			let id = ZU.xpathText(node, '@id');
			let doc = node.ownerDocument;
			let text = ZU.xpathText(
				doc, `//KnowledgeItemKeywords/OnetoN[starts-with(text(), "${id}")]`
			);
			if (!text) {
				return [];
			}
			return text.split(';')
				.map(part => part.split(':')[0])
				.slice(1)
				.map(keywordID => ZU.xpathText(doc, `.//Keyword[@id='${keywordID}']/Name`))
				.filter(Boolean);
		}
		catch (e) {
			FlexAnnotate.logError(e);
			return [];
		}
	}
};
