var FlexAnnotate;

function log(msg) {
	Zotero.debug("FlexAnnotate: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting " + version);

	// register() ist async; ein Fehler hier (z. B. beim Auflösen des Plugin-Icons)
	// darf nicht den ganzen Start abbrechen und damit Feature A und B mitnehmen.
	try {
		await Zotero.PreferencePanes.register({
			pluginID: 'flexannotate@justanotherjurastudent.github.io',
			src: rootURI + 'preferences.xhtml',
			scripts: [rootURI + 'preferences.js'],
			label: 'FlexAnnotate'
		});
	}
	catch (e) {
		Zotero.logError(e);
	}

	Services.scriptloader.loadSubScript(rootURI + 'flexannotate.js');
	FlexAnnotate.init({ id, version, rootURI });
	FlexAnnotate.addToAllWindows();
	await FlexAnnotate.main();
}

function onMainWindowLoad({ window }) {
	FlexAnnotate?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	FlexAnnotate?.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	if (!FlexAnnotate) return;
	FlexAnnotate.removeFromAllWindows();
	FlexAnnotate.uninit();
	FlexAnnotate = undefined;
}

function uninstall() {
	log("Uninstalled");
}
