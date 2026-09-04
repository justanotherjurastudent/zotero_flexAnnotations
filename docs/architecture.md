# Aufbau

Wie FlexAnnotate an Zotero andockt — und wo es weh tut. Wer einen Fehler sucht,
fängt am besten bei „Heikle Stellen" an.

## Überblick

`bootstrap.js` lädt `flexannotate.js`, das die übrigen Module in denselben Scope lädt.
Ein globaler Teil (`main()`/`uninit()`) patcht Zotero-Interna, ein fensterbezogener Teil
(`addToWindow()`/`removeFromWindow()`) baut die Oberfläche.

| Modul | Aufgabe |
|---|---|
| `flexannotate.js` | Namensraum, Laden der Module, Item-Kontextmenü |
| `placeholder.js` | Platzhalter-PDF anlegen und wieder entfernen |
| `printAnnotations.js` | Annotationen anlegen, ändern, löschen; Seite und Locator |
| `dialog.js` | Eingabemaske als XUL-`<panel>` im Hauptfenster |
| `annotationMenu.js` | Kontextmenü an den Annotationszeilen im rechten Bereich |
| `integrationPatch.js` | Feature B: Nur-Nachweis beim Einfügen in Word/LibreOffice |
| `citationDialogPatch.js` | Auswahlfeld „Einfügen als" im Zitationsdialog |
| `citaviImport.js` | Citavi-Zitate ohne Dateianhang als Print-Annotationen |

## Warum ein Platzhalter-Anhang

Zotero speichert Annotationen ausschließlich unter einem **Datei-Anhang** (PDF, EPUB
oder HTML-Snapshot). Eine Annotation direkt am Titel-Item abzulegen wirft beim Speichern
(`xpcom/data/item.js:2246-2259`); ein verknüpfter URL-Anhang scheidet aus demselben
Grund aus.

FlexAnnotate hängt deshalb beim ersten Anlegen ein leeres, 346 Byte großes 1-Seiten-PDF
unter den Titel, mit dem Tag `#flexannotate-placeholder`. Die Druckseite steckt
zusätzlich im `sortIndex`, damit der Annotations-Tab nach Buchseite sortiert.

## Heikle Stellen

### 1. Reihenfolge beim Citavi-Import

Zoteros Citavi-Durchlauf greift den Anhang einer Quelle über `getAttachments()[0]` —
blind, ohne Prüfung (`import/citavi.js:76-82`). Legt FlexAnnotate seine Platzhalter-PDF
vorher an, landen Zoteros PDF-Annotationen möglicherweise darauf. Im Testexport haben 2
von 29 Quellen sowohl verankerte als auch lose Zitate, der Fall ist also real.

Deshalb läuft unser Durchlauf **nach** Zoteros. Das kostet einen zweiten Einhängepunkt:

| Patch | Objekt | Aufgabe |
|---|---|---|
| `patch()` | `Zotero.Translate.Import.prototype.translate` | erkennt den Citavi-Export, merkt das Translation-Objekt vor |
| `addToWindow()` | `Zotero_File_Interface.importFile` / `.importFromClipboard` | löst den vorgemerkten Durchlauf aus, wenn der Import zurückkommt |

**`Zotero_File_Interface` ist kein Singleton.** Jedes Fenster, das `fileInterface.js`
lädt, bekommt sein eigenes Objekt — der Importassistent tut das
(`import/importWizard.xhtml`). Ein Patch nur am Hauptfenster erreicht ihn nicht, und der
Fehler ist stumm: die Vormerkung bleibt liegen, es passiert schlicht nichts. Deshalb
wird jedes geöffnete Fenster geprüft. Bleibt eine Vormerkung offen, steht das inzwischen
als Warnung im Log.

### 2. Notiz zum Zitat löschen

Ist *Notiz zum Zitat behalten* aus (Standard), entfernt `removeQuoteNote()` die Notiz,
die Zoteros Übersetzer zu demselben Wissenselement angelegt hat. **Das löscht Daten.**
Drei Bedingungen müssen zusammen zutreffen: gleiche Quelle, Text beginnt mit Kernaussage
+ Zitat, und der Rest danach ist kurz genug für die Fundstelle. Die dritte ist der
eigentliche Schutz — ohne sie würde eine längere Notiz mit gleichem Anfang mitgelöscht.
Betroffen sind nur Zitate, die FlexAnnotate selbst übernommen hat; Notizen zu
PDF-Zitaten bleiben unberührt.

### 3. Patches können lautlos verpuffen

Unser Code läuft nicht im strict mode. Eine Zuweisung auf ein eingefrorenes Objekt oder
durch einen Xray-Wrapper wirft dann nicht, sondern tut nichts — ein wirkungsloser Patch
sieht aus wie ein erfolgreicher. **Nach jedem Patch zurücklesen und vergleichen.** Alle
Patches hier tun das; der Citavi-Hook hat den Beleg geliefert (siehe unten).

### 4. Startup-Cache

Eigene Skripte mit `loadSubScriptWithOptions(url, { ignoreCache: true })` laden — auf
*jeder* Ebene. Sonst liefert der Cache beim Entwickeln stillschweigend die vorige
Fassung, und ein Fix am inneren Modul wirkt nicht, weil das äußere veraltet ist.

### 5. XUL nur in chrome-Dokumenten

Ein Plugin kann kein `chrome.manifest` registrieren; `openDialog()` mit `file://`- oder
`jar:`-URL ergibt ein leeres Fenster. Oberfläche deshalb mit
`MozXULElement.parseXULToFragment()` im Hauptfenster bauen — so macht Zotero es selbst.

## Was am Citavi-Export belegt ist

Prüfdatei: ein echter Export aus Citavi 7.4 (`<CitaviExchangeData Version="7.4.0.23">`,
UTF-8 mit BOM), 57 `KnowledgeItem`.

| Befund |
|---|
| 15 der 57 Zitate haben keinen `EntityLink` — genau die verwirft Zotero |
| `KnowledgeItem` verweist per `ReferenceID` **direkt** auf die Quelle; `EntityLinks` ist nur für die PDF-Verankerung nötig |
| `PageRange` enthält eingebettetes Markup: `<os>` Anzeigeform, `<nt>` Nummerierungsart, `<n>` Zahl |
| Einziger vorkommender `<nt>`-Wert ist `Margin` (Randnummer); ohne `<nt>` meint Citavi eine Seite |
| `PageRangeNumber` ist `-1`, wenn keine Fundstelle erfasst ist |
| Bei 11 der 15 losen Zitate ist `Text` leer und nur `CoreStatement` gefüllt |
| Die Notiz des Übersetzers folgt streng dem Schema `<h1>CoreStatement</h1>\n<p>Text</p>\n<i>Fundstelle</i>` (`Citavi 5 XML.js:183-206`) |

Ergebnis des Durchlaufs an diesem Export: 15 Print-Annotationen, 42 Zitate von Zotero
selbst als PDF-Annotationen erledigt.

**Bekannte Grenze:** Citavis Randnummern (`<nt>Margin</nt>`) werden auf den CSL-Locator
`paragraph` abgebildet. Einen Locator für Randnummern kennt CSL nicht; die Zitation
rendert entsprechend „Abs." statt „Rn.". Wer das anders braucht, ändert
`LOCATOR_BY_NUMBER_TYPE` in `citaviImport.js`.

## Der gescheiterte erste Einhängepunkt

Zum Nachschlagen, falls jemand denselben Weg noch einmal versucht:
`fileInterface.js:686` ruft `(0, _citavi.ImportCitaviAnnotatons)(translation)` auf und
liest die Eigenschaft erst zum Aufrufzeitpunkt vom Modulobjekt. Sie zu ersetzen müsste
also genügen — tut es aber nicht. `resource://zotero/require.js` lädt CommonJS-Module
über `loader.sys.mjs` in eine eigene Sandbox; deren `exports` ist eingefroren und weder
direkt noch über `wrappedJSObject` oder `Cu.waiveXrays()` beschreibbar. Die Zuweisung
verpuffte lautlos.
