<#
.SYNOPSIS
  frank/archive-folders.ps1 - move approved HYDI folders into ~\HYDI_Archive\<date>\.
.DESCRIPTION
  Phase 1 deliverable. NEVER deletes anything - it moves folders only.
  Takes an approved list file (one folder name per line, # comments ok),
  defaults to DRY-RUN (prints what would move), and logs every move to
  archive-log.jsonl next to the destination.

  Safety rails:
    - refuses to touch the canonical repo (HYDI-System-v2) or any path
      outside the scanned root
    - refuses folders that are git repos with uncommitted changes unless
      -AllowDirty is passed
    - refuses the destination if it already contains the folder name

.PARAMETER ApprovedList
  Path to a text file with one folder name per line (names relative to
  ~\, e.g. "hydi-wt-b1"). Required.

.PARAMETER Root
  Parent directory containing the folders. Default: $env:USERPROFILE.

.PARAMETER ArchiveRoot
  Archive destination root. Default: <Root>\HYDI_Archive. The actual
  target is <ArchiveRoot>\<yyyy-MM-dd>\.

.PARAMETER Execute
  Perform the moves. WITHOUT this switch the script is dry-run only.

.PARAMETER AllowDirty
  Allow moving git repos that have uncommitted tracked changes.
  (Uncommitted work would be preserved inside the archive, but it will
  not be visible to git until the folder is restored.)

.EXAMPLE
  # dry run
  powershell -File scripts\frank\archive-folders.ps1 -ApprovedList approved.txt
  # real run
  powershell -File scripts\frank\archive-folders.ps1 -ApprovedList approved.txt -Execute
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory=$true)][string]$ApprovedList,
    [string]$Root = $env:USERPROFILE,
    [string]$ArchiveRoot = (Join-Path $env:USERPROFILE 'HYDI_Archive'),
    [switch]$Execute,
    [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyy-MM-dd'
$destRoot = Join-Path $ArchiveRoot $stamp
$logPath  = Join-Path $ArchiveRoot 'archive-log.jsonl'

if (-not (Test-Path -LiteralPath $ApprovedList)) { throw "Approved list not found: $ApprovedList" }
$names = Get-Content -LiteralPath $ApprovedList |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }

$canonical = 'HYDI-System-v2'
$results = @()

foreach ($name in $names) {
    $entry = [ordered]@{ name = $name; action = 'skip'; reason = $null; from = $null; to = $null }

    # --- safety rails ---
    if ($name -eq $canonical -or $name -match '[\\/]' -or $name -match '\.\.') {
        $entry.reason = 'protected or invalid name'
        $results += [pscustomobject]$entry; continue
    }
    $src = Join-Path $Root $name
    if (-not (Test-Path -LiteralPath $src)) {
        $entry.reason = 'not found under root'
        $results += [pscustomobject]$entry; continue
    }
    if ((Get-Item -LiteralPath $src).PSIsContainer -eq $false) {
        $entry.reason = 'not a directory'
        $results += [pscustomobject]$entry; continue
    }
    $dest = Join-Path $destRoot $name
    if (Test-Path -LiteralPath $dest) {
        $entry.reason = 'already exists in archive destination'
        $results += [pscustomobject]$entry; continue
    }

    # --- dirty check for git repos ---
    $isGit = Test-Path -LiteralPath (Join-Path $src '.git')
    if ($isGit -and -not $AllowDirty) {
        Push-Location -LiteralPath $src
        try {
            $porcelain = & git status --porcelain --untracked-files=no 2>$null
            if ($porcelain | Where-Object { $_ }) {
                $entry.reason = 'git repo has uncommitted tracked changes (use -AllowDirty to override)'
                Pop-Location
                $results += [pscustomobject]$entry; continue
            }
        } finally { Pop-Location }
    }

    # --- move ---
    $entry.from = $src
    $entry.to   = $dest
    # If this is a linked worktree, its .git is a FILE pointing into the
    # canonical repo's .git\worktrees\. Capture the canonical git dir now
    # (the pointer dies once the folder moves) so we can prune the stale
    # worktree registration afterwards.
    $canonicalGit = $null
    $gitFile = Join-Path $src '.git'
    if (Test-Path -LiteralPath $gitFile -PathType Leaf) {
        $ptr = (Get-Content -LiteralPath $gitFile -Raw) -replace '\s',''
        if ($ptr -match '^gitdir:(.+)$') {
            $gitdir = $Matches[1]
            # gitdir = <canonical>\.git\worktrees\<id>  ->  canonical git = <canonical>\.git
            if ($gitdir -match '^(.*)[\\/]\.git[\\/]worktrees[\\/].*$') {
                $canonicalGit = Join-Path $Matches[1] '.git'
            }
        }
    }
    if ($Execute) {
        if ($PSCmdlet.ShouldProcess($src, "Move to $dest")) {
            try {
                New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
                Move-Item -LiteralPath $src -Destination $destRoot
                $entry.action = 'moved'
                if ($canonicalGit) {
                    # prune removes the dead worktree registration; it does
                    # not touch the moved files.
                    & git --git-dir=$canonicalGit worktree prune 2>$null
                    $entry.reason = 'moved; worktree registration pruned in canonical repo'
                }
            } catch {
                $entry.action = 'error'
                $entry.reason = $_.Exception.Message
            }
        } else { $entry.action = 'whatif' }
    } else {
        $entry.action = 'would-move'
        if ($canonicalGit) { $entry.reason = 'is a linked worktree (registration will be pruned)' }
    }
    $results += [pscustomobject]$entry
}

# --- log ---
if ($Execute) {
    New-Item -ItemType Directory -Force -Path $ArchiveRoot | Out-Null
    foreach ($r in $results) {
        $line = ($r | ConvertTo-Json -Compress)
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    }
}

# --- report ---
$results | Format-Table name, action, reason -AutoSize
$moved = @($results | Where-Object { $_.action -eq 'moved' }).Count
$would = @($results | Where-Object { $_.action -eq 'would-move' }).Count
$skipped = @($results | Where-Object { $_.action -eq 'skip' }).Count
Write-Host ""
if ($Execute) { Write-Host "Moved: $moved | Skipped: $skipped | Errors: $(@($results | Where-Object action -eq 'error').Count)" }
else { Write-Host "DRY RUN - would move: $would | Skipped: $skipped (re-run with -Execute to move)" }
Write-Host "Archive destination: $destRoot"
