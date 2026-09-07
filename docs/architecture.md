# FlexAnnotate — Architecture

FlexAnnotate is a bootstrapped Zotero plugin (`strict_min_version` 7.0, `strict_max_version` 10.\*, verified
against Zotero 10.0.1) with three capabilities: annotations on items that have no file attachment ("print
annotations", carrying a manually maintained locator); citation-only insertion of annotations into Word and
LibreOffice; and an import pass that turns Citavi quotes without a PDF anchor into print annotations. This
document covers the load model, the data model, the control flow of each capability, the one destructive
operation, and the Zotero-internal pitfalls the implementation works around.

References of the form `xpcom/data/item.js:2246-2259` are paths inside `chrome/content/zotero/` of Zotero's
`omni.ja`, anchored to Zotero 10.0.1.

## Load model

`bootstrap.js` implements Zotero's bootstrapped-plugin contract: `install()`, `startup()`, `shutdown()`,
`uninstall()`, `onMainWindowLoad()`, `onMainWindowUnload()`. There is no build step, no bundler and no
dependency; the layout follows `zotero/make-it-red` (`src-2.0`).

`startup()` registers the preference pane, then loads `flexannotate.js` with
`Services.scriptloader.loadSubScriptWithOptions(url, { ignoreCache: true })`. `FlexAnnotate.init()` loads
every remaining module the same way and without a `target`, so all modules share one scope and attach
themselves to the `FlexAnnotate` namespace object. `ignoreCache` is required at every level
(see [Pitfall 3](#3-startup-cache)). Two lifecycles run in parallel:

| Lifecycle | Entry | Exit | Scope |
|---|---|---|---|
| Global patches | `FlexAnnotate.main()` | `FlexAnnotate.uninit()` | Zotero-wide prototypes, window observers |
| Per-window UI | `FlexAnnotate.addToWindow()` | `FlexAnnotate.removeFromWindow()` | DOM of one main window |

`main()` calls `patch()` on `IntegrationPatch`, `CitationDialogPatch` and `CitaviImport`; `uninit()` calls
`unpatch()` on all three. `addToAllWindows()` covers windows open at startup, `onMainWindowLoad()` later
ones. Both paths are idempotent — each injection point checks for its own element ID first.
`FlexAnnotate.storeAddedElement()` records element IDs once, not per window; `removeFromWindow()` resolves
them per document and also drops the injected `<link href="flexannotate.ftl">`.

## Module map

| Module | Responsibility |
|---|---|
| `bootstrap.js` | Lifecycle contract, preference-pane registration, first script load |
| `flexannotate.js` | Namespace, module loading, preference and logging helpers, item context menu |
| `placeholder.js` | Generation, lookup and cleanup of the placeholder attachment |
| `printAnnotations.js` | Create, update, erase annotations; page label, sort index, locator tag |
| `dialog.js` | Input mask as a XUL `<panel>` in the main window |
| `annotationMenu.js` | Context menu on `annotation-row` elements in the item pane |
| `integrationPatch.js` | Citation-only rewrite in the word-processor integration |
| `citationDialogPatch.js` | Mode selector injected into the citation dialog |
| `citaviImport.js` | Second import pass for Citavi quotes Zotero discards |
| `preferences.js` / `.xhtml` / `prefs.js` | Preference pane and defaults (branch `extensions.flexannotate.`) |

## Data model

### Annotation parent and placeholder attachment

Zotero stores annotations only under a file attachment whose `attachmentReaderType` is set — `pdf`, `epub`
or `snapshot` (`xpcom/data/item.js:2246-2259`; reader types derived from content type at
`xpcom/data/item.js:3500-3516`). An annotation whose parent is a regular item or a linked-URL attachment
throws on save.

`Placeholder.create()` therefore attaches a generated, empty single-page PDF (A4, `MediaBox [0 0 595 842]`,
346 bytes) to the regular item and tags it `#flexannotate-placeholder` as an automatic tag.
`Placeholder.ensure()` returns an existing one; `Placeholder.isPlaceholder()` identifies it by tag, not by
title, so a later UI language change leaves older attachments valid. `Placeholder.cleanUpIfEmpty()`, called
from `PrintAnnotations.erase()`, erases the attachment once its last annotation is gone, unless the
`keepEmptyPlaceholders` preference is set.

`Placeholder.buildPDF()` composes the file as ASCII and computes the xref offsets from the running string
length, so pdf.js opens it without a repair pass. The PDF is generated at runtime rather than shipped as an
asset: `Zotero.Attachments.importFromFile()` requires a real filesystem path, and inside an installed XPI
`rootURI` is a `jar:` URI with no such path. The file is written to `Zotero.getTempDirectory()` and removed
in a `finally` block.

### Annotation field rules

Enforced by Zotero, all in `xpcom/data/item.js`:

| Rule | Source |
|---|---|
| `annotationType` must be assigned before any other annotation field | `:4487` |
| `annotationText` is allowed only for `highlight` and `underline` | `:4507` |
| `annotationColor` must match `/#[a-f0-9]{6}/` (lowercase) | `:4514` |
| `annotationSortIndex` must match `/^\d{5}\|\d{6}\|\d{5}$/` for a PDF parent | `:4524` |
| Type changes are restricted to `highlight` ↔ `underline` | `:4494-4498` |
| `annotationPageLabel` is persisted as `pageLabel \|\| null` | `:2290` |

`PrintAnnotations.create()` assigns `annotationType` first. For type `note` it folds any quoted text into
the comment instead of dropping it. `PrintAnnotations.normalizeColor()` falls back to `#ffd400` for anything
failing the color pattern. An empty page label reads back as `null`, which callers must handle explicitly.
`annotationPosition` is a fixed `{ pageIndex: 0, rects: [[0, 0, 0, 0]] }` — the field is required by the PDF
parent, and no real geometry exists.

### Page label, sort order, locator type

The printed page goes into `annotationPageLabel` verbatim and, encoded, into `annotationSortIndex`, so the
annotations pane sorts by printed page rather than by creation order. `PrintAnnotations.buildSortIndex()`
extracts the first `\d+` run, clamps it to 99999 and pads it to the three-group format; a label with no
digits yields 99999 and therefore sorts last while keeping its relative order.

Zotero has no field for the *kind* of locator. The CSL locator is stored as an automatic tag
`#flexannotate-locator-<name>` on the annotation: tags are native, synchronize, and survive a round trip
through other devices. `page` is the default and is not tagged; valid names come from `Zotero.Cite.labels`.
`PrintAnnotations.applyLocatorTag()` writes it (removing any previous locator tag first),
`PrintAnnotations.getLocator()` reads it with a fallback to `page`, and
`IntegrationPatch.rewriteToCitationOnly()` consumes it as the citation item's `label`.

## Control flow

### Print annotations

`flexannotate.js` appends a separator and three `menuitem`s to `zotero-itemmenu` and manages their
visibility on `popupshowing` via `FlexAnnotate.updateMenuState()`
(see [Pitfall 9](#9-plugin-added-item-menu-entries-survive)). `Dialog.open()` and `Dialog.openForEdit()`
await `Zotero.Styles.init()` through `Dialog.ensureLocatorsReady()`, then build the panel once with
`MozXULElement.parseXULToFragment()` and cache it by ID. `Dialog.buildLocatorMenu()` fills the locator
menulist from `Zotero.Cite.labels`, labelled through `Zotero.Cite.getLocatorString()` and sorted by label;
`Dialog.buildColorMenu()` fills the color menulist from `Zotero.Annotations.COLORS` using
`Zotero.getString()` (see [Pitfall 7](#7-fluent-value-messages-vs-xul-labels)). `Dialog.accept()` requires a
non-empty page field, then calls `PrintAnnotations.create()` or `.update()`; the type menulist is disabled
in edit mode.

`AnnotationMenu` registers a single `contextmenu` listener on the document in the capture phase rather than
on the rows: `annotation-row` elements (`elements/attachmentAnnotationsBox.js:134`) are rebuilt on every
selection change, so only a delegated listener survives. The handler returns early unless the row's
annotation has a placeholder parent, leaving PDF and EPUB annotations untouched.

### Citation-only insertion

Patch target: `Zotero.Integration.Session.prototype._insertCitingResult`
(`xpcom/integration.js:1678-1701`). Zotero branches there: if any cited item is an annotation it builds a
mock note via `Zotero.EditorInstance.createNoteFromAnnotations()` and inserts that; otherwise it takes the
ordinary citation path `_insertItemsIntoDocument()`. With the `citationOnly` preference set, the patched
method calls `IntegrationPatch.rewriteToCitationOnly()` and, on success, invokes
`_insertItemsIntoDocument()` directly. Both paths are unmodified Zotero logic; only the choice of path
changes. Any error inside the patch is logged and falls through to the original method, so insertion never
fails because of the plugin.

`rewriteToCitationOnly()` returns `null` — falling back to native behaviour — when the citation is empty,
when not every cited item is an annotation, or when an annotation has no citable top-level item. Otherwise
it replaces each citation item with one addressing `annotation.topLevelItem`, carries `annotationPageLabel`
as `locator` and the locator tag as `label`, drops the stale `uris` and `itemData`, and awaits
`citation.loadItemData()`.

The citation object is mutated in place and returned. Cloning would lose the `Zotero.Integration.Citation`
prototype, and `_insertItemsIntoDocument()` (`xpcom/integration.js:1778-1785`) hands the same object to the
session, which later calls `.serialize()` on it. Mutation happens only after every annotation has been
validated. `Zotero.Integration.Session.prototype.insertAnnotations` does not exist; `insertAnnotations`
lives only on `Zotero.EditorInstance` (`editorInstance.js:392`) and is not a viable target.

### Citation dialog control

The citation dialog is a separate window, `chrome://zotero/content/integration/citationDialog.xhtml`, opened
from `xpcom/integration.js:1611`. `CitationDialogPatch.patch()` registers an observer for `domwindowopened`
through `Services.ww.registerNotification`, waits for `load`, and matches on `window.location.href`.
`CitationDialogPatch.inject()` adds a `<select>` at two points: `#settings-popup .popup`, and
`#itemDetails .popup` before its `.buttons` row. Both write the same `citationOnly` preference and are kept
in step by `syncSelects()`. Injection failures are caught and logged; the dialog stays usable without the
selector.

`citationDialog.js:244-248` shows and hides `[data-dialog-type]` elements on mode change. Injection happens
after that pass, so `CitationDialogPatch.trackDialogType()` sets the initial state itself and follows later
changes with a `MutationObserver` on the `dialog-type` attribute of `documentElement`. Labels come from
adding `flexannotate.ftl` to the dialog document's own L10n resources (`doc.l10n.addResourceIds()`) plus
`translateFragment()` on the injected rows; a hardcoded fallback prevents an unlabelled control.

### Citavi import

Zotero's importer walks `//Annotations/Annotation` — nodes carrying PDF coordinates (`Quads`) — and
additionally skips sources with no attachment (`import/citavi.js:76-80`). Quotes on printed sources have no
`<Annotation>` node at all; they exist only as `<KnowledgeItem>`. Two hooks, each answering a different
question:

| Hook | Target | Answers |
|---|---|---|
| `CitaviImport.patch()` | `Zotero.Translate.Import.prototype.translate` | *whether* a Citavi export was read; retains the translation object |
| `CitaviImport.addToWindow()` | `Zotero_File_Interface.importFile` / `.importFromClipboard` | *when* the pass runs — after Zotero's own annotation pass (`fileInterface.js:686`) |

The translation object carries both inputs the pass needs: `_itemSaver._IDMap` (Citavi `ReferenceID` →
Zotero item ID) and `_io` for the XML. `CitaviImport._afterTranslate()` matches the translator label against
`/^Citavi (?:[56]) XML/i` and parks the object in `_pending`; `_runPending()`, invoked from the `finally`
block of the patched import method, consumes it.

Ordering is load-bearing. Zotero's pass resolves a source's attachment blindly as `getAttachments()[0]`
(`import/citavi.js:76-82`), so a placeholder created first can receive Zotero's PDF annotations. If no
window exposes a writable `Zotero_File_Interface`, the pass runs directly after `translate()` with that
caveat and a warning in the log.

`CitaviImport.importPrintQuotes()` re-initialises the stream (`translation._io.init('xml/dom')`; the stream
is consumed by Zotero's pass, and `import/citavi.js:14` re-initialises it the same way), collects anchored
knowledge-item IDs from `//EntityLinks/EntityLink/SourceID`, then walks `//KnowledgeItems/KnowledgeItem`. A
node is skipped when it has no `ReferenceID`, no mapped item, a non-regular item, neither text nor comment,
or when it is anchored *and* the source has a non-placeholder attachment with an `attachmentReaderType`
(`CitaviImport.hasAnnotatableAttachment()`) — the case Zotero already handled. Skip counters are logged by
reason, so a result of `created 0` is diagnosable.

## Citavi export format

Verified against a Citavi 7.4 export (`<CitaviExchangeData Version="7.4.0.23">`, UTF-8 with BOM, 57
`KnowledgeItem`). The pass created 15 print annotations there; the other 42 quotes were already handled by
Zotero as PDF annotations.

| Finding | Consequence |
|---|---|
| `KnowledgeItem` references its source directly via `ReferenceID`; `EntityLinks` is needed only for PDF anchoring | Sources resolve without walking `EntityLinks` |
| A `KnowledgeItem` without an `EntityLink` is exactly what Zotero discards — 15 of 57 | Defines the working set |
| `PageRange` contains embedded markup: `<os>` display form, `<nt>` numbering type, `<n>` number | `CitaviImport.parsePageRange()` regex-matches `<os>` and `<nt>` out of the text content |
| `<nt>` values are `Margin`, `Paragraph`, `Column`, `Other`; a page carries no `<nt>` at all | Drives `CitaviImport.getLocatorFor()` |
| Any other `<nt>` value is treated as "other" and logged once per distinct name | An extended Citavi list does not pass unnoticed |
| `PageRangeNumber` is `-1` when no locator was recorded | Treated as "no page label" |
| `Text` is often empty with only `CoreStatement` filled — 11 of the 15 unanchored quotes | `buildAnnotationData()` uses `CoreStatement` as the quote when `Text` is empty, unlike `import/citavi.js` |
| The translator's note follows `<h1>CoreStatement</h1>\n<p>Text</p>\n<i>locator</i>` (`Citavi 5 XML.js:183-206`) | Basis of the note-matching rule below |

`CitaviImport.QUOTATION_TYPES` maps `<QuotationType>` to color and to how `CoreStatement` and `Text` are
distributed; unknown values fall back to type 1. Keywords are read as `import/citavi.js:58-65` reads them,
via `//KnowledgeItemKeywords/OnetoN`, and attached as tags.

| Value | Kind | Color | Flag |
|---|---|---|---|
| 1 | Direct quote | `#2ea8e5` | — |
| 2 | Indirect quote | `#a6507b` | `swap` — `CoreStatement` becomes the text, `Text` the comment |
| 3 | Summary | `#5fb236` | — |
| 4 | Comment | `#ff8c19` | — |
| 5 | Highlight, yellow | `#ffd400` | `dropComment` |
| 6 | Highlight, red | `#ff6666` | `dropComment` |

`CitaviImport.getLocatorFor()` resolves each `<nt>` value through its own preference, because CSL has no
equivalent for a margin number and the workable choice depends on the citation style.

| `<nt>` | Preference (branch `extensions.flexannotate.`) | Default |
|---|---|---|
| *(absent)* | `citaviLocatorPage` | `page` |
| `Column` | `citaviLocatorColumn` | `column` |
| `Paragraph` | `citaviLocatorParagraph` | `paragraph` |
| `Margin` | `citaviLocatorMargin` | `paragraph` |
| `Other`, unknown | `citaviLocatorOther` | `page` |

## Destructive operation: note removal

`CitaviImport.removeQuoteNote()` erases the note Zotero's translator created for the same knowledge item,
unless the `citaviKeepNotes` preference is set. It runs only for quotes the plugin itself imported; notes
belonging to PDF quotes are never examined. Three conditions must all hold:

1. The note hangs on the same source item (`item.getNotes()` bounds the search).
2. Its normalized plain text starts with `CoreStatement` + `Text` of this `KnowledgeItem`.
3. The remainder can only be a locator — `CitaviImport.isPageTail()`: at most `MAX_NOTE_TAIL` (60)
   characters, matching `/^[\s\d–-]*$/`.

Condition 3 is the actual safeguard. The translator strips everything but digits and hyphens from the
locator (`extractPages()` in `Citavi 5 XML.js`), so a remainder containing letters cannot have come from the
importer and marks the note as unrelated. The condition holds independently of quote length and therefore
also covers a one-word quote, which a minimum-length rule does not. Comparison runs on normalized plain text
(`stripMarkup()` then `normalizeText()`), not on markup: Zotero reshapes the HTML on save, while the running
text survives.

## Pitfalls

### 1. Silent patch failure

The plugin does not run in strict mode. Assigning to a frozen object or through an Xray wrapper does nothing
instead of throwing, so an ineffective patch is indistinguishable from a successful one. **Rule:** after
every patch, read the property back and compare identity. Every patch here does.

Concrete case: `fileInterface.js:686` calls `(0, _citavi.ImportCitaviAnnotatons)(translation)` and reads the
property from the module object at call time, so replacing it there ought to work. It does not —
`resource://zotero/require.js` loads CommonJS modules through `loader.sys.mjs` into their own sandbox whose
`exports` is frozen and writable neither directly nor via `wrappedJSObject` or `Cu.waiveXrays()`. **Rule:**
CommonJS modules reached through `require()` are unsuitable patch targets.

### 2. `Zotero_File_Interface` is not a singleton

Every window that loads `fileInterface.js` gets its own object. The import wizard does exactly that
(`import/importWizard.xhtml`, `fileInterface.js:179`), so a patch applied to the main window never sees the
wizard's import — and the failure is silent: the queued pass simply remains unclaimed. **Rule:** patch per
window, driven by `domwindowopened`. `CitaviImport._watchWindows()` inspects every opened window and skips
the majority that carry no `Zotero_File_Interface`.

### 3. Startup cache

Own scripts must be loaded with `loadSubScriptWithOptions(url, { ignoreCache: true })` at *every* level
(`xpcom/plugins.js:205-210` is how Zotero loads `bootstrap.js` itself). Plain `loadSubScript()` serves the
previous revision from the startup cache, so a fix in an inner module has no effect while the outer one is
stale. Zotero loads the preference-pane script without `ignoreCache`; changes to `preferences.js` take
effect only after a start with `-purgecaches`.

### 4. XUL only parses in privileged chrome documents

A plugin cannot register a `chrome.manifest`. `openDialog()` with a `file:` or `jar:` URL yields an empty
window: the XUL elements count as unknown tags and `onload` attributes never fire. **Rule:** build UI with
`MozXULElement.parseXULToFragment()` inside the main window, as Zotero does in `elements/*.js`. `Dialog` and
`AnnotationMenu` both do.

### 5. Locator labels require `Zotero.Styles.init()`

`Zotero.Cite.getLocatorString()` reads `Object.keys(Zotero.Styles.locales)` (`xpcom/cite.js:52-55`), and
`Styles.locales` is only assigned at the end of `Zotero.Styles.init()` (`xpcom/style.js:139-154`), so the
call throws before that. `init()` returns an in-flight initialization as a promise
(`xpcom/style.js:70-77`) and may be called any number of times. `Zotero.Cite.labels` is a static array and
is unaffected. **Rule:** `await Zotero.Styles.init()` before building any locator list. In `Dialog` this is
mandatory rather than defensive: `build()` inserts the panel before filling the list and returns the cached
panel on later calls, so one failure would leave the list empty until Zotero restarts.

`getLocatorString()` installs its per-locale map *before* populating it (`xpcom/cite.js:66-67`), so if
population aborts every later call returns `undefined`. Without the fallback to the raw locator name,
sorting by label throws and no entry is produced at all.

### 6. Preference-pane menulists

Pane scripts run in a `Cu.Sandbox(window, { sandboxPrototype: window })` *before* the XHTML fragment is
inserted (`preferences/preferences.js:313-320`; insertion at 341 and 363). Zotero then dispatches a
non-bubbling `load` event to each direct child of the pane container (`preferences/preferences.js:617`).
**Rule:** register the listener on `document` in the capture phase, and re-check on every event — other
panes fire it too. `preferences.js` chains the passes on one promise queue so two runs cannot overtake each
other, and fills all five menulists in a single pass, since five concurrent passes would each hang on their
own `await` and one failure would leave the rest empty.

Zotero resyncs a menulist whose items arrive later through a `MutationObserver` with `subtree: true`
(`preferences/preferences.js:516-539`), but only if the preference binding is already in place. Setting
`elem.value` after populating is deterministic and fires no `command` event, so it writes nothing back. A
preference pane needs its own `<linkset>` with the plugin FTL or all labels stay empty
(`preferences/preferences.js:355`).

### 7. Fluent value messages vs. XUL labels

`data-l10n-id` sets `textContent`, but a XUL `<menuitem>` displays its `label` attribute, which stays empty.
Zotero's color palette entries (`general-yellow = Yellow`) are plain value messages. **Rule:** use
`Zotero.getString()` for XUL labels, as Zotero does in `elements/zoteroSearch.js:1269`.

### 8. `strict_max_version` is mandatory on Zotero 10

Without it the plugin is dropped while the manifest is parsed: it appears neither in the plugin list nor in
`extensions.json`, and nothing is logged. `extensions.strictCompatibility` (`zotero.js:6`, `false`) is
misleading — `XPIInstall.sys.mjs:507` (toolkit `omni.ja`) sets `addon.strictCompatibility` to `true` for
every release build, meaning any version without `-beta`, `-dev` or `SOURCE`.

### 9. Plugin-added item-menu entries survive

`buildItemContextMenu()` removes only its own entries (`zoteroPane.js:4170-4173`), so appended plugin
entries persist across rebuilds. **Rule:** a plugin manages the visibility of its own entries itself, on
`popupshowing`. `FlexAnnotate.updateMenuState()` toggles `hidden` for the separator and the three entries
based on whether exactly one regular item is selected and whether the selection is a print annotation
(`FlexAnnotate.getSelectedPrintAnnotation()`). Print annotations appear both as item-tree rows under the
placeholder and as `annotation-row` elements in the item pane, so edit and delete are registered in both
menus.

## Compatibility and teardown

Every patch performs feature detection before patching and read-back verification after. On failure only the
affected capability disables itself and logs a warning; Zotero is left untouched and the remaining
capabilities keep working. Errors inside a patched method are caught and delegated to the original
implementation.

`shutdown()` calls `removeFromAllWindows()` and `uninit()`, which reverse every patch — prototype methods,
per-window `Zotero_File_Interface` methods, both `domwindowopened` observers — and remove all injected DOM,
including rows already injected into open citation dialogs.

Line references in this document are anchored to Zotero 10.0.1. After a major Zotero release they are a
starting point for verification, not a guarantee. The unpacked reference source is obtained by extracting
`omni.ja` from the running installation.
