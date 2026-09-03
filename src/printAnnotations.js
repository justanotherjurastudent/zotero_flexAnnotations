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
	/** Von Zotero unterstützte Farben, siehe annotations.js (Zotero.Annotations.PREDEFINED_COLORS) */
	DEFAULT_COLOR: '#ffd400',

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
	 * @returns {Promise<Zotero.Item>}
	 */
	async create(item, data) {
		let attachment = await FlexAnnotate.Placeholder.ensure(item);
		let type = data.type || 'highlight';

		let annotation = new Zotero.Item('annotation');
		annotation.libraryID = attachment.libraryID;
		annotation.parentID = attachment.id;
		// Muss zuerst gesetzt werden, sonst wirft item.js:4488
		annotation.annotationType = type;

		if (type === 'highlight' || type === 'underline') {
			annotation.annotationText = data.text || '';
		}
		else if (data.text) {
			// Bei 'note' kennt Zotero kein Zitatfeld: Text wandert in den Kommentar,
			// damit nichts stillschweigend verloren geht.
			data = Object.assign({}, data, {
				comment: [data.text, data.comment].filter(Boolean).join('\n\n')
			});
		}

		annotation.annotationComment = data.comment || '';
		annotation.annotationColor = this.normalizeColor(data.color);
		annotation.annotationPageLabel = String(data.pageLabel ?? '').trim();
		annotation.annotationSortIndex = this.buildSortIndex(data.pageLabel);
		annotation.annotationPosition = JSON.stringify({
			pageIndex: 0,
			rects: [[0, 0, 0, 0]]
		});

		await annotation.saveTx();
		FlexAnnotate.log(`Created print annotation ${annotation.key} on page "${annotation.annotationPageLabel}"`);
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

		await annotation.saveTx();
		return annotation;
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
