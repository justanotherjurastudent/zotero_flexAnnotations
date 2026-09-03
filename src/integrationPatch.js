/**
 * Feature B – Nur-Nachweis-Zitieren.
 *
 * Angriffspunkt (verifiziert gegen Zotero 10.0.1, integration.js:1678-1701):
 * `Zotero.Integration.Session.prototype._insertCitingResult` zweigt ab, sobald die
 * zitierten Items Annotationen sind, und schiebt sie als Mock-Note ins Dokument:
 *
 *   if (allItems.some(item => item.isAnnotation())) {
 *     let mockNote = await Zotero.EditorInstance.createNoteFromAnnotations(...);
 *     return this._insertNoteIntoDocument(fieldIndex, field, mockNote);
 *   }
 *   ...
 *   return [await this._insertItemsIntoDocument(fieldIndex++, field, citation)];
 *
 * Im Modus "nur Nachweis" überspringen wir den Annotations-Zweig und lassen stattdessen
 * den regulären Zitations-Pfad laufen — mit dem Elterntitel der Annotation als zitiertem
 * Item und `annotationPageLabel` als Locator. Beide Pfade sind unveränderte Zotero-Logik;
 * wir tauschen nur, welcher genommen wird.
 *
 * Der Plan sah `Zotero.Integration.Session.prototype.insertAnnotations` vor — diese
 * Methode existiert in Zotero 10 nicht (mehr); `insertAnnotations` liegt dort nur auf
 * `Zotero.EditorInstance` (Notiz-Editor, editorInstance.js:392).
 */
FlexAnnotate.IntegrationPatch = {
	_original: null,
	_patched: false,

	/** Setzt der Nutzer beim Auslösen einen Modifier, gilt für diesen einen Aufruf das Gegenteil. */
	_overrideOnce: null,

	/**
	 * Wendet den Patch an, sofern der Zielpfad vorhanden ist (Feature-Detection statt
	 * Versionsvergleich — bricht bei künftigen Zotero-Umbauten sauber ab statt zu crashen).
	 *
	 * @returns {Boolean} true, wenn gepatcht wurde
	 */
	patch() {
		if (this._patched) {
			return true;
		}

		let proto = Zotero.Integration?.Session?.prototype;
		if (!proto || typeof proto._insertCitingResult !== 'function') {
			Zotero.warn(
				"FlexAnnotate: Zotero.Integration.Session.prototype._insertCitingResult not found — "
				+ "Feature B (Nur-Nachweis-Zitieren) bleibt deaktiviert."
			);
			return false;
		}
		if (typeof proto._insertItemsIntoDocument !== 'function') {
			Zotero.warn(
				"FlexAnnotate: _insertItemsIntoDocument not found — Feature B bleibt deaktiviert."
			);
			return false;
		}

		this._original = proto._insertCitingResult;
		let self = this;

		proto._insertCitingResult = async function (fieldIndex, field, citation) {
			try {
				if (self.isCitationOnlyMode()) {
					let rewritten = await self.rewriteToCitationOnly(citation);
					if (rewritten) {
						return [await this._insertItemsIntoDocument(fieldIndex, field, rewritten)];
					}
				}
			}
			catch (e) {
				// Nie den Einfügevorgang scheitern lassen: im Zweifel nativ weitermachen.
				FlexAnnotate.logError(e);
			}
			finally {
				self._overrideOnce = null;
			}

			return self._original.call(this, fieldIndex, field, citation);
		};

		this._patched = true;
		FlexAnnotate.log("Patched _insertCitingResult for citation-only mode");
		return true;
	},

	unpatch() {
		if (!this._patched) {
			return;
		}
		let proto = Zotero.Integration?.Session?.prototype;
		if (proto && this._original) {
			proto._insertCitingResult = this._original;
		}
		this._original = null;
		this._patched = false;
		FlexAnnotate.log("Removed _insertCitingResult patch");
	},

	/**
	 * Voreinstellung plus einmaliger Override (Modifier-Taste).
	 *
	 * @returns {Boolean}
	 */
	isCitationOnlyMode() {
		let base = !!FlexAnnotate.getPref('citationOnly');
		return this._overrideOnce === null ? base : !base;
	},

	/** Invertiert den Modus für den nächsten Einfügevorgang. */
	setOverrideOnce() {
		this._overrideOnce = true;
	},

	/**
	 * Baut aus einer Annotations-Citation eine gewöhnliche Zitation auf die Elterntitel,
	 * mit `annotationPageLabel` als Locator.
	 *
	 * Die Citation wird in place geändert und dasselbe Objekt zurückgegeben: Ein Klon
	 * über Object.assign() verlöre den Prototyp von Zotero.Integration.Citation, und
	 * _insertItemsIntoDocument() (integration.js:1778) reicht genau dieses Objekt an die
	 * Session weiter, die später .serialize() darauf aufruft. Mutiert wird erst, wenn
	 * alle Annotationen validiert sind.
	 *
	 * @param {Object} citation - Zotero-Citation-Objekt mit geladenen Item-Daten
	 * @returns {Promise<Object|null>} Dieselbe Citation, oder null wenn nicht zutreffend
	 */
	async rewriteToCitationOnly(citation) {
		let citationItems = citation?.citationItems;
		if (!Array.isArray(citationItems) || !citationItems.length) {
			return null;
		}

		let annotations = citationItems.map(ci => Zotero.Cite.getItem(ci.id));
		if (!annotations.every(item => item && item.isAnnotation())) {
			// Gemischte oder reguläre Auswahl: nicht unser Fall, nativ weiterreichen.
			return null;
		}

		let rewrittenItems = [];
		for (let i = 0; i < annotations.length; i++) {
			let topLevelItem = annotations[i].topLevelItem;
			if (!topLevelItem || !topLevelItem.isRegularItem()) {
				FlexAnnotate.log(
					`Annotation ${annotations[i].key} has no citable top-level item; falling back`
				);
				return null;
			}

			let pageLabel = annotations[i].annotationPageLabel;
			let entry = Object.assign({}, citationItems[i], {
				id: topLevelItem.id,
				uris: undefined,
				itemData: undefined
			});
			if (pageLabel) {
				entry.locator = pageLabel;
				entry.label = 'page';
			}
			rewrittenItems.push(entry);
		}

		citation.citationItems = rewrittenItems;
		if (typeof citation.loadItemData === 'function') {
			await citation.loadItemData();
		}
		return citation;
	}
};
