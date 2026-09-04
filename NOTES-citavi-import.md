# Citavi-Import: Stand

Ziel: Citavi-Zitate an Quellen **ohne** Dateianhang beim Import als Print-Annotationen
übernehmen. Zoteros Importer verwirft sie.

**Status: neuer Einhängepunkt gebaut, noch nicht am echten Import erprobt.** Der erste
Versuch (Modul-Export ersetzen) trug nicht; warum, steht unter „Der gescheiterte
Einhängepunkt". Was jetzt stattdessen gemacht wird, steht unter „Der neue
Einhängepunkt".

## Was am Testexport belegt ist

Testdatei: `C:\Users\apjmc\Documents\Citavi Export to Zotero\Test Datenbank 2026-09-03 09-45-10\Test Datenbank.ctv6`
— trotz Endung bereits das XML, das Zoteros Übersetzer „Citavi 5 XML" liest
(`<CitaviExchangeData Version="7.4.0.23">`, UTF-8 mit BOM).

| Befund | Beleg |
|---|---|
| 57 `KnowledgeItem`, davon **15 ohne `EntityLink`** — genau die verwirft Zotero | Analyse des Exports |
| `KnowledgeItem` verweist per `ReferenceID` **direkt** auf die Quelle; `EntityLinks` ist nur für die PDF-Verankerung nötig | Feldliste von `KnowledgeItem` |
| `PageRange` enthält eingebettetes Markup: `<os>` = Anzeigeform der Fundstelle, `<nt>` = Nummerierungsart, `<n>` = Zahl | z. B. `<sp><n>128</n><in>true</in><nt>Margin</nt><os>128</os><ps>128</ps></sp>` |
| Einziger vorkommender `<nt>`-Wert ist `Margin` (Randnummer), 29×; ohne `<nt>` meint Citavi eine Seite | Auszählung im Export |
| `PageRangeNumber` ist `-1`, wenn keine Fundstelle erfasst ist | 4 der 15 Kandidaten |
| `QuotationType` 1 = direktes Zitat, 2 = indirektes; im Export nur diese beiden | 12× Typ 1, 3× Typ 2 |
| Bei 11 der 15 Kandidaten ist `Text` leer und nur `CoreStatement` gefüllt | Analyse des Exports |
| Die `Quads` sind in diesem 7.4-Export bereits JSON, nicht das Citavi-5-Format | Rohwerte geprüft |

Zoteros eigener Importer prüft `Version.startsWith('5')` und wählt danach das
Quads-Format (`import/citavi.js:16,74`). Bei 7.4 nimmt er `JSON.parse` — was hier
zufällig passt. Bei einem echten Citavi-5-Export mit JSON-Quads (oder umgekehrt) wäre
das ein Fehler in Zotero; für uns bisher ohne Folgen.

## Der gescheiterte Einhängepunkt

`fileInterface.js:685` ruft den Annotations-Import so auf:

```js
if (translators[0].label.match(/^Citavi (?:[56]) XML/i)) {
  await (0, _citavi.ImportCitaviAnnotatons)(translation);
}
```

Die Eigenschaft wird zum Aufrufzeitpunkt vom Modulobjekt gelesen — sie zu ersetzen
müsste also genügen. Tut es aber nicht: **die Zuweisung kommt nie an.**

Geprüft und alle drei gescheitert (Log: `Citavi hook: no writable access to the module
export (candidates tried: direkt, wrappedJSObject, waiveXrays)`):

1. direkt auf das Objekt aus `window.require('zotero/import/citavi')`
2. über `.wrappedJSObject`
3. über `Components.utils.waiveXrays()`

Ursache: `resource://zotero/require.js` lädt CommonJS-Module über
`resource://zotero/loader.sys.mjs` in eine **eigene Sandbox** („Zotero (Module loader)").
Das `exports`-Objekt ist von dort eingefroren. Unser Plugin-Code läuft nicht im
strict mode, deshalb wirft die Zuweisung nicht, sondern verpufft lautlos — der Hook
meldete anfangs Erfolg, ohne je zu wirken.

**Lehre, die über diesen Fall hinausgeht:** Nach jedem Patch an einem fremden Objekt
zurücklesen und vergleichen. Ohne diese Gegenprobe sieht ein wirkungsloser Patch genau
wie ein erfolgreicher aus. `src/integrationPatch.js` und `src/citaviImport.js` machen
das inzwischen.

## Der neue Einhängepunkt

Zwei Patches auf gewöhnlichen, beschreibbaren Objekten statt auf dem Modul-Export:

| Patch | Objekt | Aufgabe |
|---|---|---|
| `patch()` | `Zotero.Translate.Import.prototype.translate` | erkennt am Übersetzer-Label, dass gerade ein Citavi-Export gelesen wurde, und merkt sich das Translation-Objekt |
| `addToWindow()` | `Zotero_File_Interface.importFile` / `.importFromClipboard` | löst den Durchlauf aus — erst **nachdem** Zoteros eigener Annotations-Durchlauf gelaufen ist |

Am Translation-Objekt hängt beides, was der Durchlauf braucht: `_itemSaver._IDMap`
(Citavi-`ReferenceID` → Zotero-Item) und `_io` für das XML.

**Warum der zweite Patch nötig ist.** `translate()` ist die einzige Stelle, an der wir
das Translation-Objekt zu fassen bekommen — sie liegt aber *vor* dem Citavi-Durchlauf in
`fileInterface.js:686`. Liefen wir dort, hätten die Quellen schon unsere Platzhalter-PDF,
wenn Zotero mit

```js
const itemAttachmentIDs = item.getAttachments();
...
const itemAttachment = await Zotero.Items.getAsync(itemAttachmentIDs[0]);
```

blind den ersten Anhang greift: PDF-Annotationen könnten auf dem Platzhalter landen,
und Quellen ohne echten Anhang würden nicht mehr wie bisher übersprungen. Deshalb
merken wir uns den Durchlauf nur vor und holen ihn nach, wenn `importFile` zurückkommt.

`Zotero_File_Interface` ist ein einfaches Fensterobjekt (`fileInterface.js:179`,
`new function () { this.importFile = ... }`); `_finishImport`, wo der eigentliche Ablauf
steht, ist eine private `var` und kommt als Ziel nicht in Frage.

Greift der zweite Patch nicht, läuft der Durchlauf ersatzweise direkt nach `translate()`
— mit der obigen Einschränkung und einer Warnung im Log. Beide Patches prüfen per
Rücklesen, ob sie sitzen.

## Testablauf

1. Zotero mit Logausgabe starten:
   `& "$env:LOCALAPPDATA\Zotero\zotero.exe" -purgecaches -ZoteroDebugText`
2. Beim Start im Log erwarten:
   `Patched Translate.Import.translate for Citavi print quotes` und
   `Sequenced Citavi pass after importFile, importFromClipboard`
3. Die `.ctv6` in eine **neue, leere Sammlung** importieren (ein zweiter Import
   derselben Datei verdoppelt die Annotationen).
4. Im Log erwarten: `Citavi import detected; print quotes queued`, danach
   `Citavi import: created 15 print annotation(s)`.

Zur Einordnung: Die Zitate erscheinen ohnehin als **Notizen** — die legt der Übersetzer
selbst an (`<h1>CoreStatement</h1><p>Text</p>`), unabhängig von uns. Unser Durchlauf
ergänzt sie um Print-Annotationen, ersetzt sie nicht.
