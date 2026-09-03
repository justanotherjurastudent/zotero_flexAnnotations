<#
.SYNOPSIS
    Packt src/ zu build/flexannotate.xpi.

.NOTES
    Die Zip-Einträge werden einzeln angelegt statt über ZipFile::CreateFromDirectory oder
    Compress-Archive: beide schreiben unter .NET Framework (Windows PowerShell 5.1)
    Backslashes als Pfadtrenner in die Einträge, z. B. "locale\de\flexannotate.ftl".
    Die Zip-Spezifikation verlangt Slashes; mit Backslashes findet Zotero die Dateien in
    Unterordnern nicht (u. a. die Fluent-Lokalisierung).
#>
[CmdletBinding()]
param(
	[string]$OutputName = 'flexannotate.xpi'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'src'
$buildDir = Join-Path $root 'build'
$output = Join-Path $buildDir $OutputName

if (-not (Test-Path (Join-Path $src 'manifest.json'))) {
	throw "manifest.json nicht gefunden in $src"
}

$manifest = Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version

New-Item -ItemType Directory -Force $buildDir | Out-Null
Remove-Item $output -Force -ErrorAction SilentlyContinue

# ZipFile/ZipFileExtensions liegen in System.IO.Compression.FileSystem,
# ZipArchive/ZipArchiveMode dagegen in System.IO.Compression — beide werden gebraucht.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open(
	$output,
	[System.IO.Compression.ZipArchiveMode]::Create
)
try {
	$prefixLength = $src.Length + 1
	foreach ($file in Get-ChildItem $src -Recurse -File) {
		$entryName = $file.FullName.Substring($prefixLength).Replace('\', '/')
		[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
			$archive,
			$file.FullName,
			$entryName,
			[System.IO.Compression.CompressionLevel]::Optimal
		) | Out-Null
	}
}
finally {
	$archive.Dispose()
}

# Gegenprobe: kein Eintrag darf einen Backslash enthalten
$check = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
	$bad = @($check.Entries | Where-Object { $_.FullName -match '\\' })
	$count = $check.Entries.Count
}
finally {
	$check.Dispose()
}
if ($bad.Count -gt 0) {
	throw "Zip-Einträge mit Backslash: $($bad.FullName -join ', ')"
}

$size = '{0:N1} KB' -f ((Get-Item $output).Length / 1KB)
Write-Host "FlexAnnotate $version -> $output ($size, $count Dateien)"
