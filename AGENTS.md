# AGENTS.md

## Projekt

FlexAnnotate — Zotero-Plugin. Zwei Features:

- **A: Print-Annotationen** — Annotationen mit manueller Seitenangabe für Quellen ohne
  Dateianhang (Printbücher).
- **B: Nur-Nachweis-Zitieren** — beim Einfügen von Annotationen in Word/LibreOffice
  wahlweise nur die Zitation mit Locator setzen.

Spezifikation: `flexannotate-codex-plan.md`. Der Plan wurde für Zotero 7 geschrieben;
Abweichungen für Zotero 10 sind unten und in `README.md` dokumentiert.

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
| Der Pref `extensions.strictCompatibility` (`zotero.js:6`, `false`) ist irreführend: `XPIInstall.sys.mjs:507` setzt `addon.strictCompatibility` bei jedem Release-Build (ohne `-beta`/`-dev`/`SOURCE` in der Version) selbst auf `true` | `modules/addons/XPIInstall.sys.mjs:507` (Toolkit-omni.ja) |

## Konventionen

- Tabs zur Einrückung, wie im Zotero-Quellcode und in `make-it-red`.
- Kommentare und Nutzertexte auf Deutsch; Bezeichner und Log-Ausgaben auf Englisch.
- Lokalisierung über Fluent, `en-US` und `de` gleichzeitig pflegen.
- Jeder Patch an einer internen Zotero-Funktion braucht Feature-Detection und muss in
  `shutdown()` zurückgenommen werden.
