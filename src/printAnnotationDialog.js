var FlexAnnotateDialog = {
	io: null,

	onLoad() {
		this.io = window.arguments[0];

		let sourceLabel = document.getElementById('flexannotate-source-label');
		sourceLabel.value = this.io.item.getDisplayTitle();

		this.buildColorMenu();

		document.getElementById('flexannotate-type')
			.addEventListener('command', () => this.updateTextFieldState());
		this.updateTextFieldState();

		document.getElementById('flexannotate-page').focus();
	},

	/** Farbauswahl aus Zoteros eigener Palette (annotations.js: Zotero.Annotations.COLORS) */
	buildColorMenu() {
		let popup = document.getElementById('flexannotate-color-popup');
		let colors = Zotero.Annotations.COLORS;

		for (let [l10nKey, hex] of colors) {
			let menuitem = document.createXULElement('menuitem');
			menuitem.setAttribute('value', hex);
			menuitem.setAttribute('data-l10n-id', l10nKey);
			menuitem.style.setProperty('--flexannotate-swatch', hex);
			menuitem.classList.add('menuitem-iconic');
			popup.appendChild(menuitem);
		}

		document.getElementById('flexannotate-color').value = Zotero.Annotations.DEFAULT_COLOR;
	},

	/**
	 * Zotero erlaubt `annotationText` nur bei highlight/underline (item.js:4507).
	 * Bei "note" wird das Zitatfeld deshalb gesperrt und der Hinweis sichtbar.
	 */
	updateTextFieldState() {
		let type = document.getElementById('flexannotate-type').value;
		let textField = document.getElementById('flexannotate-text');
		let supportsText = ['highlight', 'underline'].includes(type);

		textField.disabled = !supportsText;
		textField.style.opacity = supportsText ? '1' : '0.5';
	},

	onAccept() {
		let page = document.getElementById('flexannotate-page').value.trim();
		if (!page) {
			document.getElementById('flexannotate-page').focus();
			return false;
		}

		this.io.dataOut = {
			pageLabel: page,
			type: document.getElementById('flexannotate-type').value,
			color: document.getElementById('flexannotate-color').value,
			text: document.getElementById('flexannotate-text').value.trim(),
			comment: document.getElementById('flexannotate-comment').value.trim()
		};
		return true;
	}
};
