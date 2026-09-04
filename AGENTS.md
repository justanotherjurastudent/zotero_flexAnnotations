# AGENTS.md

## Projekt

FlexAnnotate — Zotero-Plugin. Drei Funktionen:

- **Print-Annotationen** — Annotationen mit manueller Seitenangabe für Quellen ohne
  Dateianhang (Printbücher).
- **Nur-Nachweis-Zitieren** — beim Einfügen von Annotationen in Word/LibreOffice
  wahlweise nur die Zitation mit Locator setzen.
- **Citavi-Import** — Zitate ohne Dateianhang als Print-Annotationen übernehmen.

Aufbau und die heiklen Stellen: `docs/architecture.md`. Ursprüngliche Spezifikation:
`docs/plan.md` — für Zotero 7 geschrieben, Abweichungen sind hier und im `README.md`
dokumentiert.

## Zielversion

Entwickelt und geprüft gegen **Zotero 10.0.1** (Per-User-Install unter
`%LOCALAPPDATA%\Zotero`, Gecko 140.14). Achtung: unter `C:\Program Files\Zotero` kann
noch eine ältere Installation liegen — die ist nicht die laufende.

## Kommandos

```powershell
# XPI bauen -> build/flexannotate.xpi
powershell -File tools/build.ps1

# Entwicklungsinstallation (Proxy-Datei ins Profil, Zotero vorher schließen)
powershell -File tools/install-dev.ps1
powershell -File tools/install-dev.ps1 -Remove

# Zotero mit Debug-Ausgabe starten
& "$env:LOCALAPPDATA\Zotero\zotero.exe" -purgecaches -ZoteroDebugText
```

Es gibt bewusst keinen npm-/TypeScript-Build: das Plugin folgt dem offiziellen
Zotero-Beispiel `zotero/make-it-red` (`src-2.0`) und kommt ohne Abhängigkeiten aus.

## Regel: keine Annahmen über interne Zotero-APIs

Interne Zotero-APIs sind nicht stabil und haben sich zwischen 7 und 10 erheblich
geändert. **Jede Annahme über eine Zotero-API vor der Verwendung im Quellcode prüfen**,
nicht aus dem Gedächtnis oder aus Tutorials übernehmen.

Der entpackte Zotero-Quellcode liegt dafür unter `.zotero-reference/10.0.1/`
(gitignored). Neu erzeugen mit:

```powershell
$dst = "$env:TEMP\zotero-omni"
Copy-Item "$env:LOCALAPPDATA\Zotero\app\omni.ja" "$dst.zip" -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory("$dst.zip", $dst)
# Quellcode liegt unter $dst\chrome\content\zotero
```

Ergänzend: „Tools → Developer → Run JavaScript" im laufenden Zotero, um Verhalten
gegenzuprüfen.

## Belegte Befunde (Zotero 10.0.1)

Diese Punkte sind am Quellcode verifiziert und begründen den Aufbau des Plugins:

| Befund | Fundstelle |
|---|---|
| Annotationen brauchen zwingend ein **Datei-Attachment** als Parent (PDF/EPUB/HTML-Snapshot). Annotation direkt am Titel-Item oder an einem Linked-URL-Attachment wirft beim Speichern. | `xpcom/data/item.js:2246-2259` |
| `attachmentReaderType` ist nur für `application/pdf`, `application/epub+zip`, `text/html` gesetzt | `xpcom/data/item.js:3500-3516` |
| `annotationType` muss **vor** allen anderen Annotation-Feldern gesetzt werden | `xpcom/data/item.js:4487` |
| `annotationText` nur bei `highlight`/`underline` erlaubt | `xpcom/data/item.js:4507` |
| `annotationColor` muss `/#[a-f0-9]{6}/` erfüllen (Kleinbuchstaben) | `xpcom/data/item.js:4514` |
| `annotationSortIndex` muss bei PDF-Parent `/^\d{5}\|\d{6}\|\d{5}$/` erfüllen | `xpcom/data/item.js:4524` |
| Annotationen werden beim Zitieren in `_insertCitingResult` als Mock-Note eingefügt — **hier** setzt Feature B an, nicht am im Plan genannten `insertAnnotations` (existiert nicht) | `xpcom/integration.js:1678-1701` |
| `_insertItemsIntoDocument` gibt dasselbe Citation-Objekt zurück, das die Session weiterverwendet → Citation **in place** ändern, nicht klonen | `xpcom/integration.js:1778-1785` |
| `buildItemContextMenu` entfernt nur eigene Einträge, angehängte Plugin-Einträge bleiben | `zoteroPane.js:4170-4173` |
| Farbpalette als `[l10n-Key, Hex]`-Paare | `xpcom/annotations.js` (`Zotero.Annotations.COLORS`) |
| **`strict_max_version` ist auf Zotero 10 Pflicht.** Fehlt es im Manifest, wird das Plugin beim Parsen verworfen — es taucht nicht einmal in `extensions.json` auf und es erscheint keine Fehlermeldung. Experimentell belegt: von fünf sonst identischen Test-Plugins lud nur das mit `strict_max_version`. | Empirisch, Zotero 10.0.1 |
| **Nach jedem Patch an einem fremden Objekt zurücklesen und vergleichen.** Zuweisungen können lautlos verpuffen — eingefrorene Objekte oder Xray-Wrapper — und unser Code läuft nicht im strict mode, wirft also nicht. Ein wirkungsloser Patch sieht sonst genau wie ein erfolgreicher aus. | Belegt am Citavi-Modul, siehe `docs/architecture.md` |
| CommonJS-Module aus `require()` liegen in einer eigenen Loader-Sandbox und ihr `exports` ist eingefroren: weder direkt noch über `wrappedJSObject` oder `Cu.waiveXrays()` beschreibbar. Solche Module sind als Patch-Ziel ungeeignet. | `resource://zotero/require.js`, `resource://zotero/loader.sys.mjs` |
| XUL-Elemente werden nur in privilegierten chrome-Dokumenten geparst. Ein Plugin kann kein `chrome.manifest` registrieren, `openDialog()` mit `file://`- oder `jar:`-URL ergibt ein leeres Fenster. Oberfläche stattdessen mit `MozXULElement.parseXULToFragment()` im Hauptfenster bauen. | wie Zotero selbst in `elements/*.js` |
| Eigene Skripte mit `loadSubScriptWithOptions(url, { ignoreCache: true })` laden — auf **jeder** Ebene. `loadSubScript()` bedient sich sonst aus dem Startup-Cache und liefert stillschweigend die vorige Fassung. | `xpcom/plugins.js:205-210` |
| Fluent-Wertnachrichten (`general-yellow = Gelb`) landen über `data-l10n-id` als textContent; ein XUL-`<menuitem>` zeigt aber das `label`-Attribut. Dafür `Zotero.getString()` verwenden. | `elements/zoteroSearch.js:1269` |
| Einstellungs-Panes brauchen ein eigenes `<linkset>` mit der Plugin-FTL, sonst bleiben alle Beschriftungen leer (`translateFragment() failed`) | `preferences/preferences.js:355`, `preferences_general.xhtml:29` |
| `Zotero_File_Interface` ist **kein Singleton**: jedes Fenster, das `fileInterface.js` lädt, hat ein eigenes Objekt. Der Importassistent lädt es selbst, ein Patch am Hauptfenster erreicht ihn also nicht — und der Fehler ist stumm. | `import/importWizard.xhtml`, `fileInterface.js:179` |
| Zoteros Citavi-Durchlauf greift den Anhang einer Quelle blind über `getAttachments()[0]`. Wer vorher einen eigenen Anhang anlegt, verschiebt ihm das Ziel. | `import/citavi.js:76-82` |
| `annotationPageLabel` wird als `pageLabel \|\| null` gespeichert und liest sich bei leerem Wert als `null` zurück — in Logausgaben sonst als `"null"` sichtbar | `xpcom/data/item.js:2290` |
| Der Pref `extensions.strictCompatibility` (`zotero.js:6`, `false`) ist irreführend: `XPIInstall.sys.mjs:507` setzt `addon.strictCompatibility` bei jedem Release-Build (ohne `-beta`/`-dev`/`SOURCE` in der Version) selbst auf `true` | `modules/addons/XPIInstall.sys.mjs:507` (Toolkit-omni.ja) |

## Konventionen

- Tabs zur Einrückung, wie im Zotero-Quellcode und in `make-it-red`.
- Kommentare und Nutzertexte auf Deutsch; Bezeichner und Log-Ausgaben auf Englisch.
- Lokalisierung über Fluent, `en-US` und `de` gleichzeitig pflegen.
- Jeder Patch an einer internen Zotero-Funktion braucht Feature-Detection und muss in
  `shutdown()` zurückgenommen werden.
