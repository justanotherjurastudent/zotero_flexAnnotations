// Feature B: Standardmodus beim Einfügen von Annotationen.
// false = vollständige Annotation (Zotero-Verhalten), true = nur Nachweis mit Locator
pref("extensions.flexannotate.citationOnly", false);

// Platzhalter-Attachment behalten, auch wenn keine Annotation mehr daran hängt
pref("extensions.flexannotate.keepEmptyPlaceholders", false);

// Citavi-Import: Zitate ohne Dateianhang als Print-Annotationen übernehmen
pref("extensions.flexannotate.citaviImport", true);

// Die Notiz behalten, die Zoteros Übersetzer zu demselben Zitat anlegt.
// Aus = FlexAnnotate entfernt sie, sobald es das Zitat als Annotation übernommen hat.
pref("extensions.flexannotate.citaviKeepNotes", false);

// CSL-Locator für Citavis Fundstellen. Citavi unterscheidet nur Seite und Randnummer
// (<nt>Margin</nt>); für Randnummern gibt es in CSL keine Entsprechung, deshalb hängt
// die sinnvolle Wahl am Zitierstil.
pref("extensions.flexannotate.citaviLocatorPage", "page");
pref("extensions.flexannotate.citaviLocatorMargin", "paragraph");
