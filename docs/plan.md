# Entwicklungsplan: Zotero-Plugin „FlexAnnotate" (Arbeitstitel)

> **Historisches Dokument — der ursprüngliche Plan, nicht der Ist-Zustand.**
> Geschrieben für Zotero 7 und vor der Umsetzung. Überholt sind insbesondere: der
> npm-/TypeScript-Aufbau (das Plugin kommt ohne Abhängigkeiten aus), der Einhängepunkt
> für Feature B (`insertAnnotations` existiert nicht, siehe `src/integrationPatch.js`),
> der Per-Klick-Override über eine Modifier-Taste (ersetzt durch das Auswahlfeld
> „Einfügen als" im Zitationsdialog) und der Citavi-Import, den der Plan noch nicht kennt.
> Verbindlich sind [`architecture.md`](architecture.md) und [`../README.md`](../README.md).

> Dieses Dokument dient als Arbeits- und Task-Spezifikation für einen Coding-Agenten (Codex).
> Zielgruppe: Agent mit vollem Dateisystem-Zugriff auf dieses Repo; Zotero wird lokal installiert betrieben.

## 1. Ziel und Umfang

Das Plugin soll zwei Lücken in Zotero (7+) schließen, ohne Zotero selbst zu forken:

**Feature A – Print-Annotationen:** Annotationen mit manuell gepflegter Seitenangabe für Quellen **ohne** Dateianhang (Printbücher etc.). Die Annotationen sollen sich in der Zotero-UI wie gewöhnliche Annotationen verhalten (Annotations-Tab, Tags, Suche, auswählbar im Word-Plugin „Anmerkung hinzufügen", Zitation mit Locator).

**Feature B – Nur-Nachweis-Zitieren:** Beim Einfügen von Annotationen in Word/LibreOffice optional **nur die Zitation inkl. Seitenangabe** einfügen (ohne Zitattext und Kommentar), gesteuert über eine globale Voreinstellung und einen per-Klick-Override.

Nicht-Ziele: kein eigenes Zitations-Layout, kein Fork von Zotero, keine Änderung am Word-Plugin selbst (nur Client-seitige Hooks).

## 2. Voraussetzungen und Setup (Phase 0)

- Node.js LTS, npm; Repo aus `windingwind/zotero-plugin-template` klonen/ableiten (TypeScript, esbuild, `zotero-plugin-scaffold`, Hot-Reload via `npm start`).
- Zotero-Evaluationsprofil (separates Profil mit Testbibliothek: ein Print-Buch ohne Anhang, ein PDF-Titel, ein EPUB).
- Word 365 (Windows/macOS) oder LibreOffice mit installiertem Zotero-Plugin als Testumgebung.
- `AGENTS.md` im Repo anlegen: Build-Kommandos (`npm start`, `npm run build`, `npm run build-dev`), Hinweis „Interne Zotero-APIs sind nicht stabil – keine Annahmen ohne Prüfung im laufenden Zotero via Run JavaScript".

## 3. Recherche-Landmarken im Zotero-Quellcode

Vor Implementierung diese Dateien im Repo `zotero/zotero` lesen (nur lesen, nicht ändern):

| Pfad | Relevanz |
|---|---|
| `chrome/content/zotero/xpcom/annotations.js` | Annotationen-Datenmodell, Felder wie `annotationPageLabel`, `annotationText`, `annotationColor`, `annotationType`, `annotationSortIndex` |
| `chrome/content/zotero/xpcom/data/item.js` / `items.js` | Anlegen von Items (`new Zotero.Item('annotation')`), Parent-Beziehung |
| `chrome/content/zotero/integration.js` | Session-Logik, Einfügen von Annotationen (`insertAnnotations` bzw. äquivalente Methode in aktueller Version), `addNote`-Befehl |
| `chrome/content/zotero/elements/annotationRow.js` | Darstellung im Annotations-Tab |
| `chrome/content/zotero/xpcom/reader.js` | Öffnen von Annotationen im Reader |

Wichtig: Die Annotation-Objekte in Zotero sind Items vom Typ `annotation` mit Eltern-Attachment. Seite 1 der Recherche: klären, ob ein `annotation`-Item technisch auch unter einem **normalen Titel-Item** (nicht Attachment) liegen kann und was UI/Sync dann machen (Spike A2).

## 4. Meilensteine

### M1 – Spike: Datenmodell (Zeit: 1 Agent-Durchlauf)
- **A1:** Per „Tools → Developer → Run JavaScript" im Zotero-Testprofil: Annotation-Item unter einem PDF-Anhang anlegen, `annotationPageLabel` setzen, prüfen, dass es im Annotations-Tab erscheint und im Word-Plugin wählbar ist. Ergebnis dokumentieren.
- **A2:** Dasselbe Experiment mit einem Titel-Item als Parent (ohne Attachment). Dokumentieren: funktioniert die Anzeige? Sync? Word-Plugin? Crash-Risiken?
- **A3:** Entscheidung: **Pfad 1** (verstecktes Platzhalter-Attachment + echte Annotations-Items darunter) vs. **Pfad 2** (Annotation direkt am Titel-Item). Standardentscheidung: Pfad 1, da er alle nativen Mechanismen unangetastet lässt.
- **Abbruchkriterium:** Wenn weder Pfad funktioniert, Feature A auf „Notiz-basiert mit strukturiertem Seitenfeld + eigene Zitationskopier-Funktion" reduzieren (Fallback, geringerer Wert).

### M2 – Feature A: Print-Annotationen anlegen (Pfad 1)
- Beim ersten Anlegen einer Print-Annotation für einen Titel: einmalig ein Platzhalter-Attachment erzeugen – bevorzugt ein gebündeltes, winziges 1-Seiten-PDF aus den Plugin-Assets; Alternative: Linked-URL-Attachment. Kennzeichnung über Namenskonvention und Plugin-Relation/Tag (z. B. `#flexannotate-placeholder`), damit es erkannt und bereinigt werden kann.
- Annotations-Item darunter anlegen: Typ (highlight/note), `annotationText` (Zitat), `annotationComment` (eigener Kommentar), `annotationColor`, `annotationPageLabel` = manuelle Druck-Seitenzahl.
- **UI:** Kontextmenü auf Titel-Item: „Print-Annotation hinzufügen…" → XHTML-Dialog (Seite, Zitat, Kommentar, Farbe, Typ). Fluent-Lokalisierung (mindestens en-US, de).
- **Bereinigung:** Beim Löschen der letzten Annotation unter einem Platzhalter-Attachment → Platzhalter automatisch entfernen (Einstellung: behalten).
- **Akzeptanzkriterien:** Print-Annotation erscheint im Annotations-Tab, ist im Word-„Anmerkung hinzufügen"-Dialog wählbar und wird dort mit der hinterlegten Seitenzahl als Locator zitiert; Sync in ein zweites Profil überlebt den Roundtrip.

### M3 – Feature A: Bearbeiten und Import
- Annotation bearbeiten: Seitenangabe und Text nachträglich ändern (Kontextmenü im Annotations-Tab oder eigener Dialog).
- (Optional) CSV/Markdown-Import: Liste `Seite; Zitat; Kommentar; Farbe` → Batch-Anlage für ganze Bücher.

### M4 – Feature B: Nur-Nachweis-Zitieren im Textverarbeitungs-Plugin
- **Hook:** `Zotero.Integration.Session.prototype.insertAnnotations` (bzw. die in der installierten Zotero-Version tatsächlich verwendete Methode – vorher prüfen, Zotero 8–10 haben den Zitationsdialog umgebaut) per Wrapper patchen: Original merken, im Wrapper prüfen, ob Modus „nur Nachweis" aktiv ist; wenn ja, pro Annotation nur das Zitationsfeld (Titel-Item + Locator aus `annotationPageLabel`) einfügen, Fließtext/HTML weglassen.
- **Steuerung:** 
  - Voreinstellung im Plugin-Einstellungspanel: Standard = „vollständige Annotation" | „nur Nachweis".
  - Per-Invocation-Override: Modifier-Taste (z. B. Alt/Option beim Klick auf „Anmerkung hinzufügen") invertiert die Voreinstellung. UI-Patch des Zotero-Dialogs (Checkbox) nur, wenn stabil machbar – sonst bewusst weglassen und im README dokumentieren.
- **Fallback-Fallback:** Zusätzlich Menüpunkt „Zitation der Auswahl kopieren" (Annotation auswählen → formatierte Zitation mit Seitenzahl via Quick-Copy/CSL in die Zwischenablage). Statischer Text, kein Live-Feld – im Menü klar kennzeichnen.
- **Akzeptanzkriterien:** In Word 365 und LibreOffice wird bei aktivem Modus ausschließlich eine normale Zotero-Zitation mit Locator eingefügt; Literaturverzeichnis aktualisiert sich korrekt; bei deaktiviertem Modus verhält sich alles exakt wie ohne Plugin (Regressionstest!).

### M5 – Härtung und Verteilung
- Feature-Detection statt Versionsvergleich: Patch nur anwenden, wenn Zielfunktion existiert; sonst sauber deaktivieren und Log-Warnung.
- Deinstallation: Patches zurücknehmen, Platzhalter-Attachments optional entfernen (Nachfrage-Dialog).
- Fehlerbehandlung: alle internen Aufrufe mit try/catch und Fehlermeldungs-Log (`Zotero.debug` + Error-Notification).
- GitHub-Actions-Build des XPI, Release mit Changelog; Einreichung ins Zotero-Plugin-Verzeichnis; README (de/en) mit Screencast.

## 5. Test-Matrix (manuell, pro Release)

| Szenario | Erwartung |
|---|---|
| Print-Annotation anlegen, im Annotations-Tab prüfen | Sichtbar, mit Seitenzahl, editierbar |
| Word: „Anmerkung hinzufügen", Print-Annotation, Modus „vollständig" | Zitat + Zitation wie nativ |
| Word: Print-Annotation, Modus „nur Nachweis" | Nur Zitationsfeld mit Locator |
| Word: PDF-Annotation, Modus „nur Nachweis" | Nur Zitationsfeld mit PDF-Seite |
| Modifier-Taste beim Klick | Invertiert die Voreinstellung |
| Sync Profil A → Profil B | Annotationen + Seitenzahlen intakt |
| Plugin deaktivieren/deinstallieren | Zotero verhält sich unauffällig; Zitationen im Dokument bleiben intakt |
| Zotero-Update (nächste Hauptversion) | Plugin deaktiviert Feature sauber statt zu crashen |

## 6. Risiken

- **Interne APIs instabil:** `insertAnnotations` und der Zitationsdialog werden gerade aktiv weiterentwickelt (Zotero 8–10). Mitigation: M4 so kapseln, dass Feature B einzeln abschaltbar ist.
- **Nicht-Attachment-Parents:** Zotero könnte Annotationen ohne Attachment-Eltern in Sync/Website nicht verarbeiten. Mitigation: Pfad 1 (Platzhalter-Attachment) als Standard.
- **Platzhalter-PDF vs. Metadaten-Sichtbarkeit:** Das Platzhalter-Attachment könnte Nutzer verwirren. Mitigation: Kennzeichnung, Einstellung „Platzhalter verbergen" (falls technisch machbar: aus Ansicht filtern, ohne Sync zu manipulieren).

## 7. Definition of Done

1. Alle Akzeptanzkriterien aus M2 und M4 erfüllt, Test-Matrix einmal komplett durchgelaufen.
2. `npm run build` liefert fehlerfreies XPI (tsc --noEmit + esbuild).
3. README mit Installations- und Nutzungsanleitung (de/en), Einstellungen dokumentiert.
4. Mindestens ein Release auf GitHub mit signiertem Tag; Release-Notes erwähnen die beiden zugehörigen Zotero-Foren-FR-Threads.
