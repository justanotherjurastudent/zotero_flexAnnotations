# FlexAnnotate

**Sprache / Language: [🇩🇪 Deutsch](#deutsch) · [🇬🇧 English](#english)**

Zotero-Plugin für drei Lücken im Arbeitsablauf mit gedruckten Quellen — Annotationen ohne
Datei, Nur-Nachweis-Zitieren und der Citavi-Import von Zitaten ohne Anhang.
A Zotero plugin that closes three gaps in the workflow with printed sources — annotations
without a file, citation-only citing, and the Citavi import of citations without an
attachment.

Entwickelt und geprüft gegen **Zotero 10.0.1** / Developed and tested against
**Zotero 10.0.1**.

---

## Deutsch

Zotero-Plugin für drei Lücken im Arbeitsablauf mit gedruckten Quellen: Annotationen ohne
Datei, Nur-Nachweis-Zitieren und der Citavi-Import von Zitaten ohne Anhang.

### Wozu

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

### Funktionen

#### Print-Annotationen

Annotationen mit manuell gepflegter Seitenangabe für Quellen **ohne** Dateianhang —
Printbücher, Kommentare, Gesetzessammlungen. Rechtsklick auf einen Titel →
*Print-Annotation hinzufügen…*; Seite, Locator-Typ, Zitat, Kommentar, Farbe und Typ
eintragen. Bearbeiten und Löschen über das Kontextmenü, sowohl im Item-Baum als auch im
Annotations-Bereich rechts.

Die Annotationen verhalten sich anschließend wie gewöhnliche Zotero-Annotationen: sie
erscheinen im Annotations-Tab, lassen sich durchsuchen und taggen und sind im
Word-/LibreOffice-Dialog „Anmerkung hinzufügen" auswählbar.

#### Nur-Nachweis-Zitieren

Beim Einfügen von Annotationen in Word oder LibreOffice wahlweise **nur die Zitation mit
Fundstelle** — ohne Zitattext und Kommentar. Umschaltbar direkt im Zitationsdialog
(„Einfügen als"), voreingestellt über die Zotero-Einstellungen.

#### Citavi-Import

Zoteros Citavi-Import übernimmt nur Zitate, die an einer PDF-Stelle hängen; alle übrigen
verwirft er. FlexAnnotate legt für diese Print-Annotationen an — mit Fundstelle,
Zitattyp-Farbe und Schlagwörtern. Auf Wunsch bleibt die Notiz, die Zotero zu demselben
Zitat anlegt, erhalten.

### Plattformen

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

### Sprachen

Die Oberfläche liegt auf **Deutsch** und **Englisch** vor. Die Sprache folgt der
Einstellung von Zotero (*Bearbeiten → Einstellungen → Allgemein → Sprache*); für jede
andere Sprache greift Englisch. Zotero registriert die Fluent-Dateien unter
`src/locale/<locale>/flexannotate.ftl` selbst — eine weitere Sprache braucht nur einen
neuen Ordner mit denselben IDs.

### Installation

Fertiges XPI aus den [Releases](https://github.com/justanotherjurastudent/zotero_flexAnnotations/releases)
laden, dann in Zotero: *Werkzeuge → Plugins → Zahnrad → Add-on aus Datei installieren…*

Selbst bauen:

```powershell
powershell -File tools/build.ps1     # -> build/flexannotate.xpi
```

### Einstellungen

*Bearbeiten → Einstellungen → FlexAnnotate*

| Einstellung | Standard | Wirkung |
|---|---|---|
| Standardmäßig nur den Nachweis einfügen | aus | Annotationen werden als reine Zitation mit Fundstelle eingefügt |
| Leere Platzhalter-Anhänge behalten | aus | Platzhalter bleibt bestehen, auch wenn keine Annotation mehr daran hängt |
| Zitate ohne Dateianhang als Print-Annotationen übernehmen | **an** | Citavi-Import: Zitate, die Zotero verwirft, werden übernommen |
| Notiz zum Zitat behalten | aus | Citavi-Import: die zusätzliche Notiz zum übernommenen Zitat bleibt stehen |
| Fundstellen zitieren als | Seite → Seite, Spalte → Spalte, Paragraph → Absatz, Randnummer → Absatz, Andere → Seite | Citavi-Import: welcher CSL-Locator je Citavi-Seitentyp gesetzt wird |

### Entwicklung

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

#### Release

`version` in `src/manifest.json` **und** in `updates.json` anheben — Zotero prüft
`update_url` gegen `updates.json`, eine veraltete Datei bietet kein Update an. Dann
`tools/build.ps1` laufen lassen und `build/flexannotate.xpi` an ein Release
`v<version>` hängen; der `update_link` in `updates.json` zeigt genau dorthin.

Die Manifest-Datei des Plugins ist `src/manifest.json`; sie wird beim Bauen ins XPI
gepackt. Der Zotero-Add-on-Scraper
([`syt2/zotero-addons-scraper`](https://github.com/syt2/zotero-addons-scraper)) liest
daraus `id`, `version`, `name`, `description` sowie `strict_min_version` /
`strict_max_version` und findet das XPI über das Release-Asset `flexannotate.xpi`.

### Kompatibilität

Das Manifest **muss** ein `strict_max_version` setzen. Fehlt das Feld, verwirft Zotero 10
das Plugin beim Parsen und meldet nichts — es erscheint weder in der Plugin-Liste noch im
Log. Bei einer neuen Zotero-Hauptversion ist der Wert anzuheben.

Das Plugin patcht interne Zotero-Funktionen. Jeder Patch prüft vorher, ob es sein Ziel
gibt, und danach, ob er wirklich sitzt. Schlägt einer fehl, deaktiviert sich die
betroffene Funktion still und schreibt eine Warnung ins Debug-Log — die übrigen
Funktionen und Zotero selbst bleiben unberührt.

### Lizenz

[AGPL-3.0-or-later](LICENSE) — dieselbe Lizenz wie Zotero selbst.

---

## English

A Zotero plugin for three gaps in the workflow with printed sources: annotations without
a file, citation-only citing, and the Citavi import of citations without an attachment.

### Why

Zotero stores passages as annotations only when a file attachment is present — a PDF,
EPUB, or HTML snapshot. An annotation without a file parent cannot be created at all. For
disciplines that work mostly with printed sources, this removes a central step. The
typical case in law is the commentary or textbook that exists as a book, not as a PDF;
citations reference a margin number, section, column, or page. Anyone citing from it can
only file the passage as a free-form note: it does not appear in the annotations tab and
is not offered as a passage when citing in Word or LibreOffice. The pinpoint gets retyped
for every reference.

Two more points. When inserting an annotation, Zotero always writes the quoted text along
with quotation marks — too much for a plain footnote reference ("Author, Work, para. 12"),
and deleting it afterwards easily damages the Zotero field. And Zotero's Citavi importer
only takes citations anchored to a spot in a PDF; it discards all others without
replacement — 15 of 57 citations in one test export.

The plugin closes these three gaps:

- Annotations for sources without a file, with a freely chosen locator type
- Citing optionally with the pinpoint only, without the quoted text
- Citavi import of the non-anchored citations too

Intended for law, history, theology, philology, and classics — and for people switching
from Citavi.

### Features

#### Print annotations

Annotations with a manually maintained page reference for sources **without** a file
attachment — printed books, commentaries, statute collections. Right-click a title →
*Add print annotation…*; enter page, locator type, quote, comment, color, and type. Edit
and delete via the context menu, both in the item tree and in the annotations pane on the
right.

The annotations then behave like ordinary Zotero annotations: they appear in the
annotations tab, can be searched and tagged, and are selectable in the Word/LibreOffice
"Add note" dialog.

#### Citation-only citing

When inserting annotations into Word or LibreOffice, optionally **only the citation with
the pinpoint** — without the quoted text and comment. Toggled directly in the citation
dialog ("Insert as"), with a default set in the Zotero preferences.

#### Citavi import

Zotero's Citavi import only takes citations attached to a spot in a PDF; it discards all
others. FlexAnnotate creates print annotations for them — with the pinpoint, citation-type
color, and tags. Optionally, the note Zotero creates for the same citation is kept.

### Platforms

Everywhere Zotero 7 or 10 runs: **Windows, macOS** (Intel and Apple Silicon) **and
Linux**. The plugin consists solely of JavaScript and XUL, contains no
platform-dependent code, and creates files only through Zotero's own mechanisms
(`Zotero.getTempDirectory()`, `PathUtils.join()`).

Two limitations come from Zotero, not from the plugin:

- **Zotero for iOS and Android** does not support plugins at all. The print annotations
  still sync there — they are ordinary Zotero annotations; only creating and editing them
  is not possible there.
- **Citation-only citing** requires one of the word-processor plugins: Word is available
  for Windows and macOS, LibreOffice for all three systems.

Only the scripts under `tools/` are PowerShell — they are needed for building, not for
using the plugin.

### Languages

The interface is available in **German** and **English**. The language follows Zotero's
setting (*Edit → Preferences → General → Language*); any other language falls back to
English. Zotero registers the Fluent files under `src/locale/<locale>/flexannotate.ftl`
itself — another language only needs a new folder with the same IDs.

### Installation

Download the built XPI from the
[Releases](https://github.com/justanotherjurastudent/zotero_flexAnnotations/releases),
then in Zotero: *Tools → Plugins → gear icon → Install Add-on From File…*

Build it yourself:

```powershell
powershell -File tools/build.ps1     # -> build/flexannotate.xpi
```

### Preferences

*Edit → Preferences → FlexAnnotate*

| Preference | Default | Effect |
|---|---|---|
| Insert the pinpoint only by default | off | Annotations are inserted as a plain citation with the pinpoint |
| Keep empty placeholder attachments | off | The placeholder stays even when no annotation is attached to it any more |
| Import citations without a file attachment as print annotations | **on** | Citavi import: citations Zotero discards are imported |
| Keep the note for the citation | off | Citavi import: the extra note for the imported citation is kept |
| Cite pinpoints as | Page → page, Column → column, Paragraph → paragraph, Margin number → paragraph, Other → page | Citavi import: which CSL locator is set per Citavi page type |

### Development

```powershell
# Proxy file into the Zotero profile (close Zotero first); loads straight from src/
powershell -File tools/install-dev.ps1
powershell -File tools/install-dev.ps1 -Remove

# Start Zotero with debug output
& "$env:LOCALAPPDATA\Zotero\zotero.exe" -purgecaches -ZoteroDebugText
```

No npm, no TypeScript — the plugin follows the official `zotero/make-it-red` example and
has no dependencies.

- [`docs/architecture.md`](docs/architecture.md) — technical reference: structure, control
  flow, data model, and the delicate spots in Zotero's internals (English)
- [`AGENTS.md`](AGENTS.md) — working rules and verified findings on the Zotero API
- [`docs/plan.md`](docs/plan.md) — original specification

#### Release

Bump `version` in `src/manifest.json` **and** in `updates.json` — Zotero checks
`update_url` against `updates.json`, and a stale file offers no update. Then run
`tools/build.ps1` and attach `build/flexannotate.xpi` to a release `v<version>`; the
`update_link` in `updates.json` points exactly there.

The plugin's manifest file is `src/manifest.json`; it is packed into the XPI at build
time. The Zotero add-on scraper
([`syt2/zotero-addons-scraper`](https://github.com/syt2/zotero-addons-scraper)) reads
`id`, `version`, `name`, `description`, and `strict_min_version` / `strict_max_version`
from it, and finds the XPI through the release asset `flexannotate.xpi`.

### Compatibility

The manifest **must** set a `strict_max_version`. Without the field, Zotero 10 discards
the plugin while parsing and reports nothing — it appears neither in the plugin list nor
in the log. Raise the value for a new major Zotero version.

The plugin patches internal Zotero functions. Each patch first checks that its target
exists and afterwards that it actually took. If one fails, the affected feature disables
itself silently and writes a warning to the debug log — the other features and Zotero
itself are unaffected.

### License

[AGPL-3.0-or-later](LICENSE) — the same license as Zotero itself.
