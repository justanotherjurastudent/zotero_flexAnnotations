# FlexAnnotate

Zotero-Plugin für drei Lücken im Arbeitsablauf mit gedruckten Quellen: Annotationen ohne
Datei, Nur-Nachweis-Zitieren und der Citavi-Import von Zitaten ohne Anhang.

Entwickelt und geprüft gegen **Zotero 10.0.1**.

## Wozu

Zotero speichert Textstellen als Annotationen nur, wenn ein Dateianhang vorliegt — ein
PDF, EPUB oder HTML-Snapshot. Eine Annotation ohne Datei-Elternteil lässt sich technisch
nicht anlegen. Für Fächer, die überwiegend mit gedruckten Quellen arbeiten, entfällt
damit ein zentraler Arbeitsschritt. Der Standardfall in den Rechtswissenschaften ist der
Kommentar oder das Lehrbuch, das es als Buch gibt und nicht als PDF; zitiert wird nach
Randnummer, Paragraph, Spalte oder Seite. Wer daraus zitiert, kann die Stelle nur als
formlose Notiz ablegen: Sie erscheint nicht im Annotations-Tab und steht beim Zitieren in
Word oder LibreOffice nicht als Textstelle zur Auswahl. Die Fundstelle wird bei jedem
Beleg neu eingetippt.

Hinzu kommen zwei Punkte. Beim Einfügen einer Annotation schreibt Zotero stets den
Zitattext samt Anführungszeichen mit — für einen reinen Fußnotennachweis („Autor, Werk,
Rn. 12") zu viel, und das nachträgliche Löschen beschädigt leicht das Zotero-Feld. Und
Zoteros Citavi-Importer übernimmt nur Zitate, die an einer PDF-Stelle verankert sind;
alle übrigen verwirft er ersatzlos — bei einem Testexport 15 von 57 Zitaten.

Das Plugin schließt diese drei Lücken:

- Annotationen für Quellen ohne Datei, mit frei wählbarem Locator-Typ
- Zitieren wahlweise nur mit Fundstelle, ohne Zitattext
- Citavi-Import auch der nicht verankerten Zitate

Gedacht für Jura, Geschichte, Theologie, Philologien und Altertumswissenschaften — und
für Umsteiger von Citavi.

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

## Plattformen

Überall dort, wo Zotero 7 oder 10 läuft: **Windows, macOS** (Intel und Apple Silicon)
**und Linux**. Das Plugin besteht ausschließlich aus JavaScript und XUL, enthält keinen
plattformabhängigen Code und legt Dateien nur über Zoteros eigene Wege an
(`Zotero.getTempDirectory()`, `PathUtils.join()`).

Zwei Einschränkungen kommen nicht vom Plugin, sondern von Zotero:

- **Zotero für iOS und Android** kennt überhaupt keine Plugins. Die Print-Annotationen
  synchronisieren dorthin trotzdem — sie sind gewöhnliche Zotero-Annotationen; nur
  Anlegen und Bearbeiten geht dort nicht.
- **Nur-Nachweis-Zitieren** setzt eines der Textverarbeitungs-Plugins voraus: Word gibt
  es für Windows und macOS, LibreOffice für alle drei Systeme.

Nur die Skripte unter `tools/` sind PowerShell — sie werden zum Bauen gebraucht, nicht
zum Benutzen.

## Sprachen

Die Oberfläche liegt auf **Deutsch** und **Englisch** vor. Die Sprache folgt der
Einstellung von Zotero (*Bearbeiten → Einstellungen → Allgemein → Sprache*); für jede
andere Sprache greift Englisch. Zotero registriert die Fluent-Dateien unter
`src/locale/<locale>/flexannotate.ftl` selbst — eine weitere Sprache braucht nur einen
neuen Ordner mit denselben IDs.

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

- [`docs/architecture.md`](docs/architecture.md) — technische Referenz: Aufbau,
  Ablauflogik, Datenmodell und die heiklen Stellen in Zoteros Interna (englisch)
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

## Lizenz

[AGPL-3.0-or-later](LICENSE) — dieselbe Lizenz wie Zotero selbst.
