"use strict";

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
			pluginID: id,
			src: rootURI + 'preferences.xhtml',
			scripts: [rootURI + 'preferences.js'],
			label: 'FlexAnnotate'
		});
	}
	catch (e) {
		Zotero.logError(e);
	}

	// ignoreCache wie bei Zoteros eigenem Laden von bootstrap.js (plugins.js:205-210).
	// Ohne das liefert der Startup-Cache beim Entwickeln weiter die alte Fassung, solange
	// Zotero nicht mit -purgecaches startet. bootstrap.js selbst lädt Zotero bereits so;
	// ab hier muss es jede eigene Datei selbst tun.
	Services.scriptloader.loadSubScriptWithOptions(rootURI + 'flexannotate.js', {
		ignoreCache: true
	});
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
	if (!FlexAnnotate) {
		return;
	}
	FlexAnnotate.removeFromAllWindows();
	FlexAnnotate.uninit();
	FlexAnnotate = undefined;
}

function uninstall() {
	log("Uninstalled");
}
