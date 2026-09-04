# FlexAnnotate

Zotero-Plugin für drei Lücken im Arbeitsablauf mit gedruckten Quellen: Annotationen ohne
Datei, Nur-Nachweis-Zitieren und der Citavi-Import von Zitaten ohne Anhang.

Entwickelt und geprüft gegen **Zotero 10.0.1**.

## Funktionen

### Print-Annotationen

Annotationen mit manuell gepflegter Seitenangabe für Quellen **ohne** Dateianhang —
Printbücher, Kommentare, Gesetzessammlungen. Rechtsklick auf einen Titel →
*Print-Annotation hinzufügen…*; Seite, Locator-Typ, Zitat, Kommentar, Farbe und Typ
eintragen. Bearbeiten und Löschen über das Kontextmenü, sowohl im Item-Baum als auch im
Annotations-Bereich rechts.

Die Annotationen verhalten sich anschließend wie gewöhnliche Zotero-Annotationen: sie
erscheinen im Annotations-Tab, lassen sich durchsuchen und taggen und sind im
Word-/LibreOffice-Dialog „Anmerkung hinzufügen" auswählbar.

### Nur-Nachweis-Zitieren

Beim Einfügen von Annotationen in Word oder LibreOffice wahlweise **nur die Zitation mit
Fundstelle** — ohne Zitattext und Kommentar. Umschaltbar direkt im Zitationsdialog
(„Einfügen als"), voreingestellt über die Zotero-Einstellungen.

### Citavi-Import

Zoteros Citavi-Import übernimmt nur Zitate, die an einer PDF-Stelle hängen; alle übrigen
verwirft er. FlexAnnotate legt für diese Print-Annotationen an — mit Fundstelle,
Zitattyp-Farbe und Schlagwörtern. Auf Wunsch bleibt die Notiz, die Zotero zu demselben
Zitat anlegt, erhalten.

## Installation

Fertiges XPI aus den [Releases](https://github.com/justanotherjurastudent/zotero_flexAnnotations/releases)
laden, dann in Zotero: *Werkzeuge → Plugins → Zahnrad → Add-on aus Datei installieren…*

Selbst bauen:

```powershell
powershell -File tools/build.ps1     # -> build/flexannotate.xpi
```

## Einstellungen

*Bearbeiten → Einstellungen → FlexAnnotate*

| Einstellung | Standard | Wirkung |
|---|---|---|
| Standardmäßig nur den Nachweis einfügen | aus | Annotationen werden als reine Zitation mit Fundstelle eingefügt |
| Leere Platzhalter-Anhänge behalten | aus | Platzhalter bleibt bestehen, auch wenn keine Annotation mehr daran hängt |
| Zitate ohne Dateianhang als Print-Annotationen übernehmen | **an** | Citavi-Import: Zitate, die Zotero verwirft, werden übernommen |
| Notiz zum Zitat behalten | aus | Citavi-Import: die zusätzliche Notiz zum übernommenen Zitat bleibt stehen |
| Fundstellen zitieren als | Seite → Seite, Spalte → Spalte, Paragraph → Absatz, Randnummer → Absatz, Andere → Seite | Citavi-Import: welcher CSL-Locator je Citavi-Seitentyp gesetzt wird |

## Entwicklung

```powershell
# Proxy-Datei ins Zotero-Profil (Zotero vorher schließen); lädt direkt aus src/
powershell -File tools/install-dev.ps1
powershell -File tools/install-dev.ps1 -Remove

# Zotero mit Debug-Ausgabe starten
& "$env:LOCALAPPDATA\Zotero\zotero.exe" -purgecaches -ZoteroDebugText
```

Kein npm, kein TypeScript — das Plugin folgt dem offiziellen Beispiel
`zotero/make-it-red` und kommt ohne Abhängigkeiten aus.

- [`docs/architecture.md`](docs/architecture.md) — Aufbau und die heiklen Stellen
- [`AGENTS.md`](AGENTS.md) — Arbeitsregeln und belegte Befunde zur Zotero-API
- [`docs/plan.md`](docs/plan.md) — ursprüngliche Spezifikation

### Release

`version` in `src/manifest.json` **und** in `updates.json` anheben — Zotero prüft
`update_url` gegen `updates.json`, eine veraltete Datei bietet kein Update an. Dann
`tools/build.ps1` laufen lassen und `build/flexannotate.xpi` an ein Release
`v<version>` hängen; der `update_link` in `updates.json` zeigt genau dorthin.

## Kompatibilität

Das Manifest **muss** ein `strict_max_version` setzen. Fehlt das Feld, verwirft Zotero 10
das Plugin beim Parsen und meldet nichts — es erscheint weder in der Plugin-Liste noch im
Log. Bei einer neuen Zotero-Hauptversion ist der Wert anzuheben.

Das Plugin patcht interne Zotero-Funktionen. Jeder Patch prüft vorher, ob es sein Ziel
gibt, und danach, ob er wirklich sitzt. Schlägt einer fehl, deaktiviert sich die
betroffene Funktion still und schreibt eine Warnung ins Debug-Log — die übrigen
Funktionen und Zotero selbst bleiben unberührt.

## Noch offen

- Modifier-Taste als Per-Klick-Override für das Nur-Nachweis-Zitieren
- CSV-/Markdown-Import für ganze Bücher
- Menüpunkt „Zitation der Auswahl kopieren"
- Test-Matrix aus `docs/plan.md`

## Lizenz

[AGPL-3.0-or-later](LICENSE) — dieselbe Lizenz wie Zotero selbst.
