param(
    [Parameter(Mandatory = $true)][string]$SourceRuntime,
    [Parameter(Mandatory = $true)][string]$PackagedAssets
)
$ErrorActionPreference = 'Stop'

# An upstream runtime may contain other chat-page chunks. Check the shared
# source's actual filename and the entry that imports it, never the first glob
# result. The byte comparison prevents a stale overlay from passing by marker.
$chats = @(Get-ChildItem -LiteralPath $SourceRuntime -Filter 'chat-page-*.js' -File)
if ($chats.Count -ne 1) { throw 'Expected exactly one shared chat renderer' }
$entries = @(Get-ChildItem -LiteralPath $SourceRuntime -Filter 'index-*.js' -File)
if ($entries.Count -ne 1) { throw 'Expected exactly one shared browser entry' }
$packagedChat = Join-Path $PackagedAssets $chats[0].Name
$packagedEntry = Join-Path $PackagedAssets $entries[0].Name
if (-not (Test-Path -LiteralPath $packagedChat -PathType Leaf)) { throw 'The packaged shared chat renderer is missing' }
if (-not (Test-Path -LiteralPath $packagedEntry -PathType Leaf)) { throw 'The packaged shared browser entry is missing' }
if ((Get-FileHash -LiteralPath $chats[0].FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $packagedChat -Algorithm SHA256).Hash) {
    throw 'The packaged chat renderer differs from shared source'
}
$entryText = Get-Content -LiteralPath $packagedEntry -Raw -Encoding UTF8
if (-not $entryText.Contains('./' + $chats[0].Name)) { throw 'The packaged entry does not import the shared chat renderer' }
$chatText = Get-Content -LiteralPath $packagedChat -Raw -Encoding UTF8
foreach ($marker in @('pinkie-chat-timeline:v31', 'pinkie-thinking-segments:v1')) {
    if (-not $chatText.Contains($marker)) { throw "The shared chat renderer is missing $marker" }
}
