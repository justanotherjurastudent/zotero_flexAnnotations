/**
 * Verwaltung des Platzhalter-Attachments.
 *
 * Hintergrund (verifiziert gegen Zotero 10.0.1, item.js:2246-2259): Zotero wirft beim
 * Speichern eines Annotation-Items, wenn dessen Parent kein Datei-Attachment mit
 * `attachmentReaderType` (pdf | epub | snapshot) ist. Eine Annotation direkt an einem
 * Titel-Item ist damit nicht möglich, ebenso wenig ein Linked-URL-Attachment.
 * Für Print-Quellen hängen wir deshalb ein winziges, leeres 1-Seiten-PDF unter den Titel
 * und führen die Print-Annotationen darunter.
 */
FlexAnnotate.Placeholder = {
	TAG: '#flexannotate-placeholder',
	/** Rückfalltitel, solange die Oberfläche keine Sprache liefert */
	TITLE: 'FlexAnnotate: Print Annotations',
	FILENAME: 'flexannotate-placeholder.pdf',

	/**
	 * Liefert das Platzhalter-Attachment eines Titel-Items, oder null.
	 *
	 * @param {Zotero.Item} item - Reguläres Titel-Item
	 * @returns {Zotero.Item|null}
	 */
	find(item) {
		for (let attachment of Zotero.Items.get(item.getAttachments())) {
			if (this.isPlaceholder(attachment)) {
				return attachment;
			}
		}
		return null;
	},

	/**
	 * @param {Zotero.Item} item
	 * @returns {Boolean}
	 */
	isPlaceholder(item) {
		return !!item && item.isAttachment() && item.hasTag(this.TAG);
	},

	/**
	 * Liefert das Platzhalter-Attachment und legt es an, falls noch keins existiert.
	 *
	 * @param {Zotero.Item} item - Reguläres Titel-Item
	 * @returns {Promise<Zotero.Item>}
	 */
	async ensure(item) {
		let existing = this.find(item);
		if (existing) {
			return existing;
		}
		return this.create(item);
	},

	/**
	 * @param {Zotero.Item} item - Reguläres Titel-Item
	 * @returns {Promise<Zotero.Item>}
	 */
	async create(item) {
		if (!item.isRegularItem()) {
			throw new Error("Placeholder parent must be a regular item");
		}

		// Das PDF wird zur Laufzeit erzeugt statt als Asset mitgeliefert: importFromFile()
		// braucht einen echten Dateipfad, und aus einem installierten XPI heraus ist
		// rootURI eine jar:-URI ohne Pfad im Dateisystem.
		// getTempDirectory() ist synchron und liefert ein nsIFile (zotero.js)
		let tmpPath = PathUtils.join(Zotero.getTempDirectory().path, this.FILENAME);
		await IOUtils.write(tmpPath, this.buildPDF());

		// Der Titel wird beim Anlegen festgeschrieben. Erkannt wird der Platzhalter am
		// Tag, nicht am Titel — ein späterer Sprachwechsel lässt ältere Anhänge gültig.
		let title = await FlexAnnotate.getString('flexannotate-placeholder-title', this.TITLE);

		try {
			let attachment = await Zotero.Attachments.importFromFile({
				file: tmpPath,
				parentItemID: item.id,
				title,
				contentType: 'application/pdf'
			});
			attachment.addTag(this.TAG, 1);
			await attachment.saveTx();
			FlexAnnotate.log(`Created placeholder attachment ${attachment.key} for item ${item.key}`);
			return attachment;
		}
		finally {
			await IOUtils.remove(tmpPath, { ignoreAbsent: true });
		}
	},

	/**
	 * Entfernt das Platzhalter-Attachment, sofern keine Annotationen mehr daran hängen
	 * und die Einstellung das Aufräumen erlaubt.
	 *
	 * @param {Zotero.Item} attachment
	 * @returns {Promise<Boolean>} true, wenn entfernt wurde
	 */
	async cleanUpIfEmpty(attachment) {
		if (!this.isPlaceholder(attachment)) {
			return false;
		}
		if (FlexAnnotate.getPref('keepEmptyPlaceholders')) {
			return false;
		}
		if (attachment.getAnnotations().length > 0) {
			return false;
		}
		await attachment.eraseTx();
		FlexAnnotate.log(`Removed empty placeholder attachment ${attachment.key}`);
		return true;
	},

	/**
	 * Minimales, gültiges 1-Seiten-PDF (A4, leer). Die xref-Offsets werden berechnet,
	 * damit pdf.js die Datei ohne Reparaturlauf öffnet.
	 *
	 * @returns {Uint8Array}
	 */
	buildPDF() {
		let objects = [
			"<< /Type /Catalog /Pages 2 0 R >>",
			"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>"
		];

		let pdf = "%PDF-1.4\n";
		let offsets = [];
		for (let i = 0; i < objects.length; i++) {
			offsets.push(pdf.length);
			pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
		}

		let xrefOffset = pdf.length;
		pdf += `xref\n0 ${objects.length + 1}\n`;
		pdf += "0000000000 65535 f \n";
		for (let offset of offsets) {
			pdf += String(offset).padStart(10, '0') + " 00000 n \n";
		}
		pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
		pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

		// Reines ASCII, daher stimmen String-Länge und Bytelänge überein.
		return new TextEncoder().encode(pdf);
	}
};
