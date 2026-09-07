"use strict";

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
 * `ImportCitaviAnnotatons` im Modul `zotero/import/citavi` zu ersetzen scheidet aus:
 * `require.js` lädt CommonJS-Module in eine eigene Sandbox, deren `exports` von außen
 * nicht beschreibbar ist (docs/architecture.md). Stattdessen zwei gewöhnliche,
 * beschreibbare Objekte:
 *
 * 1. `Zotero.Translate.Import.prototype.translate` — sagt uns, dass gerade ein
 *    Citavi-Export eingelesen wurde, und hält das Translation-Objekt fest. Daran hängt
 *    beides, was der Durchlauf braucht: `_itemSaver._IDMap` (Citavi-`ReferenceID` →
 *    Zotero-Item) und `_io` für das XML.
 * 2. `Zotero_File_Interface.importFile` / `importFromClipboard` — bestimmt, *wann* der
 *    Durchlauf läuft: erst nachdem Zoteros eigener Annotations-Durchlauf
 *    (fileInterface.js:686) fertig ist. Das Objekt ist kein Singleton, jedes Fenster
 *    hat sein eigenes; der Importassistent ebenso. Deshalb wird jedes geöffnete
 *    Fenster geprüft, nicht nur das Hauptfenster.
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
	_windowPatches: new WeakMap(),
	/** Translation-Objekt eines Citavi-Imports, dessen Durchlauf noch aussteht */
	_pending: null,
	/**
	 * Fenster, die den Durchlauf richtig einreihen. Set statt Flag: sonst bliebe der
	 * Zustand nach dem Schließen des letzten solchen Fensters auf true stehen, und jeder
	 * spätere Import würde einen Durchlauf vormerken, den niemand mehr auslöst.
	 * removeFromWindow() räumt die Einträge wieder ab — das Set hält starke Referenzen.
	 */
	_sequencedWindows: new Set(),
	/** nsIObserver auf domwindowopened */
	_observer: null,

	/**
	 * Zitattyp aus dem Citavi-Export auf Farbe und Feldbelegung abbilden. Die Farben
	 * sind aus `import/citavi.js:112-140` übernommen, damit dieselben Zitate hier wie
	 * bei Zoteros eigenem Importer aussehen. Zwei davon (`#a6507b`, `#ff8c19`) stehen
	 * nicht in `Zotero.Annotations.COLORS` — das ist Absicht und kein Fehler; sie
	 * lassen sich in der Farbauswahl nicht wiederherstellen.
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
	 * Citavis Seitentyp (`<nt>` in PageRange) auf die zuständige Einstellung abbilden.
	 * Fehlt `<nt>`, meint Citavi eine Seite.
	 *
	 * Die vier Namen sind an einem Export mit allen Typen bestätigt. Ein Wert außerhalb
	 * davon fällt auf „Andere" und steht im Log (siehe `getLocatorFor`).
	 */
	LOCATOR_PREF_BY_NUMBER_TYPE: {
		Column: 'citaviLocatorColumn',
		Paragraph: 'citaviLocatorParagraph',
		Margin: 'citaviLocatorMargin',
		Other: 'citaviLocatorOther'
	},

	/** Bereits gemeldete unbekannte `<nt>`-Werte, damit das Log nicht zuläuft */
	_unknownNumberTypes: new Set(),

	/** Höchstlänge des Rests hinter dem Zitat, damit er noch die Fundstelle sein kann */
	MAX_NOTE_TAIL: 60,

	/**
	 * Welchen CSL-Locator soll dieser Seitentyp bekommen?
	 *
	 * Die Zuordnung ist Sache des Nutzers: für Randnummern etwa gibt es in CSL keine
	 * Entsprechung, je nach Zitierstil passen `paragraph`, `opus` oder `column`.
	 *
	 * @param {String|null} numberType - Inhalt von `<nt>`, oder null für „Seite"
	 * @return {String} CSL-Locator
	 */
	getLocatorFor(numberType) {
		let pref;
		if (!numberType) {
			pref = 'citaviLocatorPage';
		}
		else if (this.LOCATOR_PREF_BY_NUMBER_TYPE[numberType]) {
			pref = this.LOCATOR_PREF_BY_NUMBER_TYPE[numberType];
		}
		else {
			// Ein unbekannter Seitentyp ist der Sache nach „Andere" — aber er gehört ins
			// Log, sonst bliebe ein falsch geratener Name für immer unbemerkt.
			pref = 'citaviLocatorOther';
			if (!this._unknownNumberTypes.has(numberType)) {
				this._unknownNumberTypes.add(numberType);
				FlexAnnotate.log(`Citavi import: unknown page type <nt>${numberType}</nt>, `
					+ "treated as 'other'");
			}
		}
		return FlexAnnotate.getPref(pref) || 'page';
	},

	//
	// Einhängepunkt 1: erkennen, dass ein Citavi-Export gelesen wurde
	//

	/**
	 * @return {Boolean} true, wenn der Patch nachweislich sitzt
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

		if (!FlexAnnotate.assignChecked(proto, 'translate', patched)) {
			Zotero.warn("FlexAnnotate: patch of Translate.Import.translate did not take effect — "
				+ "Citavi-Zitate ohne Anhang werden nicht importiert.");
			return false;
		}

		this._translatePatch = { proto, original };
		FlexAnnotate.log("Patched Translate.Import.translate for Citavi print quotes");
		this._watchWindows();
		return true;
	},

	/**
	 * Nimmt den globalen translate()-Patch zurück. Die fensterweisen Patches hängen an
	 * removeFromWindow() und werden hier nicht berührt.
	 */
	unpatch() {
		this._unwatchWindows();

		let patch = this._translatePatch;
		if (!patch) {
			return;
		}
		FlexAnnotate.assignChecked(patch.proto, 'translate', patch.original);
		this._translatePatch = null;
		this._pending = null;
		FlexAnnotate.log("Removed Translate.Import.translate patch");
	},

	/**
	 * @param {Object} translation
	 * @return {Promise}
	 */
	async _afterTranslate(translation) {
		try {
			if (!FlexAnnotate.getPref('citaviImport')) {
				return;
			}
			if (!this._isCitavi(translation)) {
				// Ohne diese Zeile wäre nicht zu unterscheiden, ob der Patch nicht
				// greift oder der Übersetzer nur nicht als Citavi erkannt wurde.
				FlexAnnotate.log("Import finished, not Citavi: "
					+ this._describeTranslator(translation));
				return;
			}
			if (this._pending) {
				// Eine Vormerkung, die niemand eingelöst hat: der Aufrufweg dieses
				// Imports geht an keinem gepatchten Zotero_File_Interface vorbei.
				Zotero.warn("FlexAnnotate: a queued Citavi pass was never triggered — "
					+ "der Aufrufweg dieses Imports ist nicht eingereiht.");
			}
			this._pending = translation;
			if (this._sequencedWindows.size) {
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
	 * @return {Boolean}
	 */
	_isCitavi(translation) {
		let label = this._getLabel(translation);
		return !!label && this.TRANSLATOR_LABEL.test(label);
	},

	/**
	 * @param {Object} translation
	 * @return {String|null}
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
	 * @return {String}
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
	 * `Zotero_File_Interface` ist kein Singleton: Jedes Fenster, das
	 * `fileInterface.js` lädt, bekommt sein eigenes Objekt. Der Importassistent tut
	 * genau das (importWizard.xhtml lädt das Skript selbst) und ruft `importFile`
	 * darauf auf — ein Patch am Hauptfenster erreicht ihn nicht.
	 *
	 * Deshalb wird jedes geöffnete Fenster geprüft, nicht nur das Hauptfenster.
	 */
	_watchWindows() {
		if (this._observer) {
			return;
		}

		let self = this;
		this._observer = {
			observe(subject, topic) {
				if (topic !== 'domwindowopened') {
					return;
				}
				subject.addEventListener('load', () => {
					try {
						self.addToWindow(subject);
					}
					catch (e) {
						FlexAnnotate.logError(e);
					}
				}, { once: true });
			}
		};

		Services.ww.registerNotification(this._observer);
		FlexAnnotate.log("Watching for windows with their own Zotero_File_Interface");
	},

	/**
	 * Meldet den Beobachter auf neue Fenster ab.
	 */
	_unwatchWindows() {
		if (!this._observer) {
			return;
		}
		Services.ww.unregisterNotification(this._observer);
		this._observer = null;
	},

	/**
	 * Reiht den Durchlauf hinter den Import dieses Fensters ein. Fenster ohne
	 * `Zotero_File_Interface` — die große Mehrheit — werden still übergangen.
	 *
	 * @param {Window} window
	 */
	addToWindow(window) {
		if (this._windowPatches.has(window)) {
			return;
		}

		let fileInterface = window.Zotero_File_Interface;
		if (!fileInterface) {
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

			if (!FlexAnnotate.assignChecked(fileInterface, name, patched)) {
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

		this._windowPatches.set(window, patches);
		this._sequencedWindows.add(window);
		FlexAnnotate.log(`Sequenced Citavi pass after ${patches.map(p => p.name).join(', ')}`
			+ ` in ${window.location?.href || 'window'}`);
	},

	/**
	 * @param {Window} window
	 */
	removeFromWindow(window) {
		let patches = this._windowPatches.get(window);
		if (!patches) {
			return;
		}
		for (let { target, name, original } of patches) {
			FlexAnnotate.assignChecked(target, name, original);
		}
		this._windowPatches.delete(window);
		this._sequencedWindows.delete(window);
		FlexAnnotate.log("Removed Citavi sequencing");
	},

	/**
	 * Holt den vorgemerkten Durchlauf nach. Ein Fehler darin darf den Import nicht
	 * abbrechen — die regulär importierten Einträge stehen bereits.
	 *
	 * @return {Promise}
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
	 * @return {Promise<Number>} Anzahl angelegter Annotationen
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
		let notesRemoved = 0;
		let keepNotes = FlexAnnotate.getPref('citaviKeepNotes');
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

			if (!keepNotes && await this.removeQuoteNote(item, node, ZU)) {
				notesRemoved++;
			}
		}

		FlexAnnotate.log(`Citavi import: created ${created} print annotation(s) `
			+ `from ${seen} KnowledgeItem(s); removed ${notesRemoved} note(s); skipped `
			+ Object.entries(skipped).map(([k, v]) => `${k}=${v}`).join(' '));
		return created;
	},

	/**
	 * Entfernt die Notiz, die Zoteros Übersetzer zu demselben Zitat angelegt hat.
	 *
	 * ACHTUNG, das hier löscht Daten. Der Übersetzer baut die Notiz streng nach Schema
	 * (`Citavi 5 XML.js:183-206`):
	 *
	 *     <h1>CoreStatement</h1>\n<p>Text</p>\n<i>Fundstelle</i>
	 *
	 * Jeder Teil kann fehlen. Zotero formt das HTML beim Speichern um, der Fließtext
	 * bleibt aber erhalten — deshalb wird auf normalisiertem Text verglichen, nicht auf
	 * Markup. Drei Bedingungen müssen alle zutreffen, sonst bleibt die Notiz stehen:
	 *
	 * 1. Sie hängt an derselben Quelle.
	 * 2. Ihr Text beginnt mit Kernaussage + Zitattext dieses KnowledgeItems.
	 * 3. Was danach noch folgt, kann nur die Fundstelle sein (siehe `isPageTail`).
	 *
	 * Bedingung 3 ist der eigentliche Schutz: ohne sie würde eine längere Notiz, die
	 * zufällig mit demselben Satz beginnt, mitgelöscht. Sie trägt unabhängig von der
	 * Länge des Zitats, greift also auch bei einem Einwortzitat.
	 *
	 * @param {Zotero.Item} item - die Quelle
	 * @param {Element} node - <KnowledgeItem>
	 * @param {Object} ZU - Zotero.Utilities aus der Übersetzungs-Sandbox
	 * @return {Promise<Boolean>} true, wenn eine Notiz entfernt wurde
	 */
	async removeQuoteNote(item, node, ZU) {
		let wanted = this.normalizeText(
			(ZU.xpathText(node, './CoreStatement') || '') + ' '
				+ (ZU.xpathText(node, './Text') || '')
		);
		if (!wanted) {
			return false;
		}

		for (let note of Zotero.Items.get(item.getNotes())) {
			let plain = this.normalizeText(this.stripMarkup(note.getNote()));
			if (!plain.startsWith(wanted)) {
				continue;
			}
			if (!this.isPageTail(plain.slice(wanted.length))) {
				continue;
			}
			await note.eraseTx();
			return true;
		}
		return false;
	},

	/**
	 * Darf hinter dem Zitat nur noch die Fundstelle stehen?
	 *
	 * Der Übersetzer streift aus der Fundstelle alles außer Ziffern und Bindestrichen
	 * (`extractPages()`, `Citavi 5 XML.js`) — ein Rest mit Buchstaben kann also nicht von
	 * ihm stammen und gehört zu einer fremden Notiz.
	 *
	 * @param {String} tail
	 * @return {Boolean}
	 */
	isPageTail(tail) {
		return tail.length <= this.MAX_NOTE_TAIL && /^[\s\d–-]*$/.test(tail);
	},

	/**
	 * @param {String} html
	 * @return {String} Fließtext ohne Markup, Entities aufgelöst
	 */
	stripMarkup(html) {
		return String(html || '')
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#0?39;|&apos;/g, "'")
			.replace(/&amp;/g, '&');
	},

	/**
	 * @param {String} text
	 * @return {String} auf einfache Leerzeichen normalisiert, ohne Ränder
	 */
	normalizeText(text) {
		return String(text || '').replace(/\s+/g, ' ').trim();
	},

	/**
	 * @param {Zotero.Item} item
	 * @return {Boolean} true, wenn ein Anhang existiert, den Zotero annotieren kann
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
	 * @return {Object}
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
	 * @return {{pageLabel: String, locator: String}}
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

		let locator = this.getLocatorFor(numberType ? numberType[1].trim() : null);

		return { pageLabel, locator };
	},

	/**
	 * Schlagwörter des Zitats, wie import/citavi.js:58-65 sie ermittelt.
	 *
	 * @param {Object} ZU
	 * @param {Element} node - <KnowledgeItem>
	 * @return {String[]}
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
