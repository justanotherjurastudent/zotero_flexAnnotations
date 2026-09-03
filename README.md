# FlexAnnotate

Zotero-Plugin für zwei Lücken im Arbeitsablauf mit gedruckten Quellen.

> **Status: früher Entwicklungsstand (0.1.0).** Das Plugin lädt und startet in
> Zotero 10.0.1 fehlerfrei: Einstellungs-Panel und Kontextmenü-Eintrag werden angelegt,
> der Zitations-Hook für Feature B greift. Die eigentlichen Funktionen sind noch nicht
> durch die Oberfläche getestet, die Test-Matrix aus dem Entwicklungsplan ist offen.

## Features

### A — Print-Annotationen

Annotationen mit manuell gepflegter Seitenangabe für Quellen **ohne** Dateianhang
(Printbücher, Kommentare, Gesetzessammlungen). Rechtsklick auf einen Titel →
*Print-Annotation hinzufügen…*, dann Seite, Zitat, Kommentar, Farbe und Typ eintragen.

Die Annotationen verhalten sich anschließend wie gewöhnliche Zotero-Annotationen: sie
erscheinen im Annotations-Tab, lassen sich durchsuchen und taggen und sind im
Word-/LibreOffice-Dialog „Anmerkung hinzufügen" auswählbar.

### B — Nur-Nachweis-Zitieren

Beim Einfügen von Annotationen in Word oder LibreOffice wird optional **nur die Zitation
mit Seitenangabe** gesetzt — ohne Zitattext und Kommentar. Steuerbar über eine
Voreinstellung in den Zotero-Einstellungen (Reiter *FlexAnnotate*).

## Warum ein Platzhalter-Anhang?

Zotero speichert Annotationen ausschließlich unter einem **Datei-Anhang** vom Typ PDF,
EPUB oder HTML-Snapshot. Eine Annotation direkt an einem Titel-Item abzulegen, ist nicht
möglich — Zotero bricht das Speichern mit einem Fehler ab
(`xpcom/data/item.js:2246-2259`). Ein verknüpfter URL-Anhang scheidet aus demselben Grund
aus, weil er kein Datei-Anhang ist.

FlexAnnotate hängt deshalb beim ersten Anlegen einer Print-Annotation ein leeres,
etwa 400 Byte großes 1-Seiten-PDF unter den Titel und führt die Annotationen darunter.
Der Anhang trägt den Tag `#flexannotate-placeholder` und wird automatisch entfernt,
sobald die letzte Annotation darunter gelöscht wurde (abschaltbar).

Die Druckseitenzahl wird zusätzlich in den `sortIndex` der Annotation kodiert, damit der
Annotations-Tab nach Buchseite sortiert statt nach Anlagereihenfolge.

## Installation

### Als XPI

```powershell
powershell -File tools/build.ps1
```

Erzeugt `build/flexannotate.xpi`. In Zotero: *Werkzeuge → Plugins → Zahnrad →
Add-on aus Datei installieren…*

### Für die Entwicklung

```powershell
# Zotero schließen, dann:
powershell -File tools/install-dev.ps1
```

Legt im Zotero-Profil eine Proxy-Datei an, die auf `src/` zeigt. Zotero lädt das Plugin
danach direkt aus dem Quellordner — ein Neustart genügt, kein Build nötig.
Rückgängig mit `-Remove`.

Zotero mit Debug-Ausgabe starten:

```powershell
& "$env:LOCALAPPDATA\Zotero\zotero.exe" -purgecaches -ZoteroDebugText
```

## Einstellungen

| Einstellung | Standard | Wirkung |
|---|---|---|
| Standardmäßig nur den Nachweis einfügen | aus | Feature B: Annotationen werden als reine Zitation mit Locator eingefügt |
| Leere Platzhalter-Anhänge behalten | aus | Platzhalter bleibt bestehen, auch wenn keine Annotation mehr daran hängt |

## Kompatibilität

Entwickelt gegen **Zotero 10.0.1**. Das Manifest muss dafür zwingend ein
`strict_max_version` setzen — fehlt das Feld, verwirft Zotero 10 das Plugin beim Parsen
und meldet nichts; es erscheint weder in der Plugin-Liste noch im Log. Bei einer neuen
Zotero-Hauptversion ist dieser Wert entsprechend anzuheben.

Feature B patcht eine interne Zotero-Funktion
(`Zotero.Integration.Session.prototype._insertCitingResult`). Der Patch wird nur
angewendet, wenn diese Funktion vorhanden ist; andernfalls deaktiviert sich Feature B
still und schreibt eine Warnung ins Debug-Log — Feature A und Zotero selbst bleiben
davon unberührt.

## Noch offen

- Bearbeiten bestehender Print-Annotationen über die Oberfläche (die API dafür steht:
  `FlexAnnotate.PrintAnnotations.update`)
- Modifier-Taste als Per-Klick-Override für Feature B
- CSV-/Markdown-Import für ganze Bücher
- Menüpunkt „Zitation der Auswahl kopieren"
- Test-Matrix aus `flexannotate-codex-plan.md`, GitHub-Actions-Build, Release

## Lizenz

Noch nicht festgelegt.
