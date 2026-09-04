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
 * ## Warum zwei Einhängepunkte
 *
 * Naheliegend wäre, `ImportCitaviAnnotatons` im Modul `zotero/import/citavi` zu
 * ersetzen — fileInterface.js:686 liest die Eigenschaft erst zum Aufrufzeitpunkt. Das
 * ist gescheitert: `require.js` lädt CommonJS-Module in eine eigene Sandbox, deren
 * `exports` von außen nicht beschreibbar ist (siehe NOTES-citavi-import.md).
 *
 * Stattdessen zwei gewöhnliche, beschreibbare Objekte:
 *
 * 1. `Zotero.Translate.Import.prototype.translate` — sagt uns, dass gerade ein
 *    Citavi-Export eingelesen wurde, und hält das Translation-Objekt fest. Daran hängt
 *    beides, was der Durchlauf braucht: `_itemSaver._IDMap` (Citavi-`ReferenceID` →
 *    Zotero-Item) und `_io` für das XML.
 * 2. `Zotero_File_Interface.importFile` / `importFromClipboard` im Fenster — bestimmt,
 *    *wann* der Durchlauf läuft: erst nachdem Zoteros eigener Annotations-Durchlauf
 *    (fileInterface.js:686) fertig ist.
 *
 * Die Reihenfolge ist nicht kosmetisch. Wir hängen eine Platzhalter-PDF an die Quelle;
 * Zoteros Durchlauf greift mit `getAttachments()[0]` blind auf den ersten Anhang zu und
 * würde PDF-Annotationen auf unserem Platzhalter ablegen, wenn wir zuerst liefen. Fehlt
 * der zweite Patch, läuft unser Durchlauf ersatzweise direkt nach `translate()` — mit
 * dieser Einschränkung und einer Warnung im Log.
 */
FlexAnnotate.CitaviImport = {
	/** Wie fileInterface.js:685 den Übersetzer erkennt */
	TRANSLATOR_LABEL: /^Citavi (?:[56]) XML/i,

	/** { proto, original } des globalen translate()-Patches */
	_translatePatch: null,
	/** WeakMap<Window, Array<{ target, name, original }>> */
	_windowPatches: null,
	/** Translation-Objekt eines Citavi-Imports, dessen Durchlauf noch aussteht */
	_pending: null,
	/** true, sobald mindestens ein Fenster den Durchlauf richtig einreiht */
	_sequenced: false,

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

	//
	// Einhängepunkt 1: erkennen, dass ein Citavi-Export gelesen wurde
	//

	/**
	 * @returns {Boolean} true, wenn der Patch nachweislich sitzt
	 */
	patch() {
		let proto = Zotero.Translate?.Import?.prototype;
		if (!proto || typeof proto.translate !== 'function') {
			Zotero.warn("FlexAnnotate: Zotero.Translate.Import.prototype.translate not found — "
				+ "Citavi-Zitate ohne Anhang werden nicht importiert.");
			return false;
		}

		let original = proto.translate;
		let self = this;

		let patched = function (...args) {
			// translate() ist eine Zotero.Promise.method und liefert immer ein Promise.
			// Ein Fehler darin wird unverändert weitergereicht.
			return Promise.resolve(original.apply(this, args)).then(async (items) => {
				await self._afterTranslate(this);
				return items;
			});
		};

		proto.translate = patched;
		if (proto.translate !== patched) {
			// Gegenprobe: eine Zuweisung, die nur in einem Xray-Expando landet, wäre
			// von einem gelungenen Patch sonst nicht zu unterscheiden.
			Zotero.warn("FlexAnnotate: patch of Translate.Import.translate did not take effect — "
				+ "Citavi-Zitate ohne Anhang werden nicht importiert.");
			return false;
		}

		this._translatePatch = { proto, original };
		FlexAnnotate.log("Patched Translate.Import.translate for Citavi print quotes");
		return true;
	},

	unpatch() {
		let patch = this._translatePatch;
		if (!patch) {
			return;
		}
		patch.proto.translate = patch.original;
		this._translatePatch = null;
		this._pending = null;
		FlexAnnotate.log("Removed Translate.Import.translate patch");
	},

	/**
	 * @param {Object} translation
	 * @returns {Promise}
	 */
	async _afterTranslate(translation) {
		try {
			if (!this._isCitavi(translation)) {
				// Ohne diese Zeile wäre nicht zu unterscheiden, ob der Patch nicht
				// greift oder der Übersetzer nur nicht als Citavi erkannt wurde.
				FlexAnnotate.log("Import finished, not Citavi: "
					+ this._describeTranslator(translation));
				return;
			}
			this._pending = translation;
			if (this._sequenced) {
				FlexAnnotate.log("Citavi import detected; print quotes queued");
				return;
			}
			Zotero.warn("FlexAnnotate: Citavi print quotes run right after translate() — "
				+ "PDF-Annotationen derselben Quellen können auf dem Platzhalter landen.");
			await this._runPending();
		}
		catch (e) {
			FlexAnnotate.logError(e);
		}
	},

	/**
	 * @param {Object} translation
	 * @returns {Boolean}
	 */
	_isCitavi(translation) {
		let label = this._getLabel(translation);
		return !!label && this.TRANSLATOR_LABEL.test(label);
	},

	/**
	 * @param {Object} translation
	 * @returns {String|null}
	 */
	_getLabel(translation) {
		let translator = translation?.translator?.[0];
		if (!translator || typeof translator == 'string') {
			return null;
		}
		return translator.label || null;
	},

	/**
	 * Nur für die Logausgabe.
	 *
	 * @param {Object} translation
	 * @returns {String}
	 */
	_describeTranslator(translation) {
		let translator = translation?.translator?.[0];
		if (!translator) {
			return "(kein Übersetzer gesetzt)";
		}
		if (typeof translator == 'string') {
			return `ID ${translator}`;
		}
		return translator.label || `ID ${translator.translatorID}`;
	},

	//
	// Einhängepunkt 2: den Durchlauf hinter Zoteros eigenen einreihen
	//

	/**
	 * @param {Window} window - Zotero-Hauptfenster
	 */
	addToWindow(window) {
		if (this._windowPatches?.has(window)) {
			return;
		}

		let fileInterface = window.Zotero_File_Interface;
		if (!fileInterface) {
			Zotero.warn("FlexAnnotate: Zotero_File_Interface not found — "
				+ "Citavi-Durchlauf wird nicht eingereiht.");
			return;
		}

		let self = this;
		let patches = [];

		for (let name of ['importFile', 'importFromClipboard']) {
			let original = fileInterface[name];
			if (typeof original !== 'function') {
				continue;
			}

			let patched = async function (...args) {
				// Ein früherer, nie eingelöster Durchlauf darf nicht nachwirken.
				self._pending = null;
				try {
					return await original.apply(this, args);
				}
				finally {
					await self._runPending();
				}
			};

			fileInterface[name] = patched;
			if (fileInterface[name] !== patched) {
				FlexAnnotate.log(`Citavi sequencing: ${name} is not writable`);
				continue;
			}
			patches.push({ target: fileInterface, name, original });
		}

		if (!patches.length) {
			Zotero.warn("FlexAnnotate: could not sequence the Citavi pass — "
				+ "es läuft ersatzweise direkt nach translate().");
			return;
		}

		this._windowPatches = this._windowPatches || new WeakMap();
		this._windowPatches.set(window, patches);
		this._sequenced = true;
		FlexAnnotate.log(`Sequenced Citavi pass after ${patches.map(p => p.name).join(', ')}`);
	},

	/**
	 * @param {Window} window
	 */
	removeFromWindow(window) {
		let patches = this._windowPatches?.get(window);
		if (!patches) {
			return;
		}
		for (let { target, name, original } of patches) {
			target[name] = original;
		}
		this._windowPatches.delete(window);
		FlexAnnotate.log("Removed Citavi sequencing");
	},

	/**
	 * Holt den vorgemerkten Durchlauf nach. Ein Fehler darin darf den Import nicht
	 * abbrechen — die regulär importierten Einträge stehen bereits.
	 *
	 * @returns {Promise}
	 */
	async _runPending() {
		let translation = this._pending;
		this._pending = null;
		if (!translation) {
			return;
		}
		try {
			await this.importPrintQuotes(translation);
		}
		catch (e) {
			FlexAnnotate.logError(e);
		}
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
		let seen = 0;
		// Warum ein Zitat übersprungen wurde — sonst ist „created 0" nicht deutbar
		let skipped = { noReference: 0, noItem: 0, notRegular: 0, handledByZotero: 0, empty: 0 };
		let attachmentCache = new Map();

		for (let node of ZU.xpath(doc, '//KnowledgeItems/KnowledgeItem')) {
			seen++;
			let knowledgeItemID = ZU.xpathText(node, '@id');
			let referenceID = ZU.xpathText(node, './ReferenceID');
			if (!referenceID) {
				skipped.noReference++;
				continue;
			}

			let itemID = idMap[referenceID];
			if (!itemID) {
				skipped.noItem++;
				continue;
			}

			let item = await Zotero.Items.getAsync(itemID);
			if (!item || !item.isRegularItem()) {
				skipped.notRegular++;
				continue;
			}

			// Zotero hat das Zitat nur dann übernommen, wenn es verankert ist UND die
			// Quelle einen annotierbaren Anhang hat (import/citavi.js:76-80).
			if (anchored.has(knowledgeItemID)) {
				if (!attachmentCache.has(item.id)) {
					attachmentCache.set(item.id, this.hasAnnotatableAttachment(item));
				}
				if (attachmentCache.get(item.id)) {
					skipped.handledByZotero++;
					continue;
				}
			}

			let data = this.buildAnnotationData(ZU, node);
			if (!data.text && !data.comment) {
				skipped.empty++;
				continue;
			}

			await FlexAnnotate.PrintAnnotations.create(item, data);
			created++;
		}

		FlexAnnotate.log(`Citavi import: created ${created} print annotation(s) `
			+ `from ${seen} KnowledgeItem(s); skipped `
			+ Object.entries(skipped).map(([k, v]) => `${k}=${v}`).join(' '));
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
