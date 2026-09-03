<#
.SYNOPSIS
    Richtet die Proxy-Datei ein, mit der Zotero das Plugin direkt aus src/ lädt.

.DESCRIPTION
    Legt im Profil unter extensions/ eine Textdatei an, die nach der Plugin-ID benannt ist
    und den absoluten Pfad zum Quellordner enthält. Danach lädt Zotero bei jedem Start den
    aktuellen Stand aus src/ — kein XPI-Build nötig.

    Zotero muss dafür geschlossen sein.

.LINK
    https://www.zotero.org/support/dev/client_coding/plugin_development
#>
[CmdletBinding()]
param(
	[string]$ProfileDir,
	[switch]$Remove
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'src'
$pluginID = (Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json).applications.zotero.id

if (Get-Process -Name zotero -ErrorAction SilentlyContinue) {
	Write-Warning 'Zotero läuft. Bitte schließen, sonst überschreibt Zotero die Änderungen beim Beenden.'
}

if (-not $ProfileDir) {
	$profilesRoot = Join-Path $env:APPDATA 'Zotero\Zotero\Profiles'
	$candidates = @(Get-ChildItem $profilesRoot -Directory -ErrorAction SilentlyContinue)
	if ($candidates.Count -eq 0) {
		throw "Kein Zotero-Profil gefunden unter $profilesRoot"
	}
	if ($candidates.Count -gt 1) {
		throw ("Mehrere Profile gefunden. Bitte -ProfileDir angeben: " +
			($candidates.FullName -join ', '))
	}
	$ProfileDir = $candidates[0].FullName
}

$extensionsDir = Join-Path $ProfileDir 'extensions'
New-Item -ItemType Directory -Force $extensionsDir | Out-Null
$proxyFile = Join-Path $extensionsDir $pluginID

if ($Remove) {
	Remove-Item $proxyFile -Force -ErrorAction SilentlyContinue
	Write-Host "Proxy-Datei entfernt: $proxyFile"
	return
}

# Ohne abschließenden Zeilenumbruch und als ASCII, damit Zotero den Pfad exakt liest
[System.IO.File]::WriteAllText($proxyFile, $src, [System.Text.Encoding]::ASCII)

# Ohne diesen Schritt scannt Zotero das extensions-Verzeichnis beim Start nicht neu und
# das Plugin bleibt unsichtbar (siehe Zotero-Doku zur Entwicklungsinstallation).
$prefsFile = Join-Path $ProfileDir 'prefs.js'
if (Test-Path $prefsFile) {
	$kept = Get-Content $prefsFile |
		Where-Object { $_ -notmatch 'extensions\.lastAppVersion|extensions\.lastAppBuildId' }
	[System.IO.File]::WriteAllLines($prefsFile, $kept)
	Write-Host 'prefs.js: lastAppVersion/lastAppBuildId entfernt (erzwingt Rescan)'
}

Write-Host "Proxy-Datei angelegt: $proxyFile"
Write-Host "  -> $src"
Write-Host ''
Write-Host 'Zotero mit Debug-Ausgabe starten:'
Write-Host '  & "$env:LOCALAPPDATA\Zotero\zotero.exe" -purgecaches -ZoteroDebugText'
