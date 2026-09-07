/**
 * Anlegen und Bearbeiten von Print-Annotationen.
 *
 * Feldregeln verifiziert gegen Zotero 10.0.1 (item.js:4487-4555):
 *  - `annotationType` muss vor allen anderen Annotation-Feldern gesetzt werden
 *  - `annotationText` ist nur bei 'highlight' und 'underline' erlaubt
 *  - `annotationColor` muss /#[a-f0-9]{6}/ erfüllen (Kleinbuchstaben)
 *  - `annotationSortIndex` muss bei PDF-Parent /^\d{5}\|\d{6}\|\d{5}$/ erfüllen
 */
FlexAnnotate.PrintAnnotations = {
	/** Von Zotero unterstützte Farben, siehe annotations.js (Zotero.Annotations.COLORS) */
	DEFAULT_COLOR: '#ffd400',

	/**
	 * Zoteros Annotationen kennen nur `annotationPageLabel`, kein Feld für die Art der
	 * Fundstelle. Bei Print-Quellen ist das aber oft keine Seite (Randnummer, Paragraf,
	 * Fußnote …). Der Locator-Typ wird deshalb als automatischer Tag an der Annotation
	 * geführt: Tags sind Bordmittel, werden mitsynchronisiert und überstehen den
	 * Roundtrip über andere Geräte.
	 *
	 * 'page' ist der Standard und wird nicht getaggt, damit Bibliotheken sauber bleiben.
	 */
	LOCATOR_TAG_PREFIX: '#flexannotate-locator-',
	DEFAULT_LOCATOR: 'page',

	/**
	 * Legt eine Print-Annotation unter dem Platzhalter-Attachment eines Titels an.
	 *
	 * @param {Zotero.Item} item - Reguläres Titel-Item
	 * @param {Object} data
	 * @param {String} data.pageLabel - Druckseitenzahl, wie sie zitiert werden soll
	 * @param {String} [data.text] - Zitat (nur bei type 'highlight'/'underline')
	 * @param {String} [data.comment] - Eigener Kommentar
	 * @param {String} [data.color]
	 * @param {String} [data.type] - 'highlight' | 'underline' | 'note'
	 * @param {String} [data.locator] - CSL-Locator, z. B. 'page' oder 'paragraph'
	 * @param {String[]} [data.tags] - Schlagwörter, die an die Annotation gehängt werden
	 * @returns {Promise<Zotero.Item>}
	 */
	async create(item, data) {
		let attachment = await FlexAnnotate.Placeholder.ensure(item);
		let type = data.type || 'highlight';
		let comment = data.comment || '';

		let annotation = new Zotero.Item('annotation');
		annotation.libraryID = attachment.libraryID;
		annotation.parentID = attachment.id;
		// Muss zuerst gesetzt werden, sonst wirft item.js:4488
		annotation.annotationType = type;

		if (type === 'highlight' || type === 'underline') {
			annotation.annotationText = data.text || '';
		}
		else if (data.text) {
			// Bei 'note' kennt Zotero kein Zitatfeld (item.js:4507): der Text wandert in
			// den Kommentar, statt stillschweigend verloren zu gehen.
			comment = [data.text, comment].filter(Boolean).join('\n\n');
		}

		annotation.annotationComment = comment;
		annotation.annotationColor = this.normalizeColor(data.color);
		annotation.annotationPageLabel = String(data.pageLabel ?? '').trim();
		annotation.annotationSortIndex = this.buildSortIndex(data.pageLabel);
		annotation.annotationPosition = JSON.stringify({
			pageIndex: 0,
			rects: [[0, 0, 0, 0]]
		});

		this.applyLocatorTag(annotation, data.locator);

		for (let tag of data.tags || []) {
			annotation.addTag(tag);
		}

		await annotation.saveTx();
		// annotationPageLabel liest sich nach dem Speichern als null zurück, wenn es leer
		// war (item.js:2290 schreibt `pageLabel || null`) — sonst stünde "null" im Log.
		FlexAnnotate.log(`Created print annotation ${annotation.key} on page `
			+ `"${annotation.annotationPageLabel || ''}"`);
		return annotation;
	},

	/**
	 * Ändert eine bestehende Print-Annotation.
	 *
	 * @param {Zotero.Item} annotation
	 * @param {Object} data - Wie bei create(); nur gesetzte Felder werden übernommen
	 * @returns {Promise<Zotero.Item>}
	 */
	async update(annotation, data) {
		if (!annotation.isAnnotation()) {
			throw new Error("Not an annotation item");
		}

		if (data.text !== undefined
				&& ['highlight', 'underline'].includes(annotation.annotationType)) {
			annotation.annotationText = data.text;
		}
		if (data.comment !== undefined) {
			annotation.annotationComment = data.comment;
		}
		if (data.color !== undefined) {
			annotation.annotationColor = this.normalizeColor(data.color);
		}
		if (data.pageLabel !== undefined) {
			annotation.annotationPageLabel = String(data.pageLabel).trim();
			annotation.annotationSortIndex = this.buildSortIndex(data.pageLabel);
		}
		if (data.locator !== undefined) {
			this.applyLocatorTag(annotation, data.locator);
		}

		await annotation.saveTx();
		FlexAnnotate.log(`Updated print annotation ${annotation.key}`);
		return annotation;
	},

	/**
	 * Liefert den Locator-Typ einer Annotation.
	 *
	 * @param {Zotero.Item} annotation
	 * @returns {String} z. B. 'page', 'paragraph', 'section'
	 */
	getLocator(annotation) {
		for (let tag of annotation.getTags()) {
			if (tag.tag.startsWith(this.LOCATOR_TAG_PREFIX)) {
				let locator = tag.tag.slice(this.LOCATOR_TAG_PREFIX.length);
				if (Zotero.Cite.labels.includes(locator)) {
					return locator;
				}
			}
		}
		return this.DEFAULT_LOCATOR;
	},

	/**
	 * Setzt den Locator-Tag; speichert nicht selbst.
	 *
	 * @param {Zotero.Item} annotation
	 * @param {String} [locator]
	 */
	applyLocatorTag(annotation, locator) {
		for (let tag of annotation.getTags()) {
			if (tag.tag.startsWith(this.LOCATOR_TAG_PREFIX)) {
				annotation.removeTag(tag.tag);
			}
		}
		if (locator && locator !== this.DEFAULT_LOCATOR && Zotero.Cite.labels.includes(locator)) {
			annotation.addTag(this.LOCATOR_TAG_PREFIX + locator, 1);
		}
	},

	/**
	 * Löscht eine Print-Annotation und räumt ein leer gewordenes Platzhalter-Attachment auf.
	 *
	 * @param {Zotero.Item} annotation
	 * @returns {Promise<void>}
	 */
	async erase(annotation) {
		let attachment = annotation.parentItem;
		await annotation.eraseTx();
		if (attachment) {
			await FlexAnnotate.Placeholder.cleanUpIfEmpty(attachment);
		}
	},

	/**
	 * Kodiert die Druckseitenzahl in den sortIndex, damit der Annotations-Tab nach
	 * Buchseite sortiert statt nach Anlagereihenfolge. Nicht-numerische Seitenangaben
	 * (z. B. "XIV" oder "Rn. 12") landen hinten, behalten aber ihre Reihenfolge.
	 *
	 * @param {String|Number} pageLabel
	 * @returns {String} Format: \d{5}|\d{6}|\d{5}
	 */
	buildSortIndex(pageLabel) {
		let match = String(pageLabel ?? '').match(/\d+/);
		let page = match ? Math.min(parseInt(match[0], 10), 99999) : 99999;
		return [
			String(page).padStart(5, '0'),
			'000000',
			'00000'
		].join('|');
	},

	/**
	 * @param {String} [color]
	 * @returns {String} 6-stelliger Kleinbuchstaben-Hexwert
	 */
	normalizeColor(color) {
		let value = String(color || '').trim().toLowerCase();
		return /^#[a-f0-9]{6}$/.test(value) ? value : this.DEFAULT_COLOR;
	}
};
