#!/usr/bin/env pwsh
# Push ballsDeepnit valuable files to rezonette repo via GitHub API
# Creates blobs, tree, commit, and updates branch ref

$ErrorActionPreference = "Stop"
$repo = "waveformer1984/rezonette"
$branch = "feat/ballsdeepnit-consolidation"
$sourceRepo = "waveformer1984/ballsDeepnit"

# Files to transfer: source path -> destination path in rezonette
$fileMappings = @(
    @{ src = "unzipped_protoflow/src/index.js";         dst = "software/protoflow/index.js" },
    @{ src = "unzipped_protoflow/src/bluetoothHub.js";  dst = "software/protoflow/bluetoothHub.js" },
    @{ src = "unzipped_protoflow/src/taskScheduler.js"; dst = "software/protoflow/taskScheduler.js" },
    @{ src = "unzipped_protoflow/src/udpValidator.js";  dst = "software/protoflow/udpValidator.js" },
    @{ src = "unzipped_protoflow/src/scaffolder.js";    dst = "software/protoflow/scaffolder.js" },
    @{ src = "network_agent/main.py";                   dst = "agents/network_agent/main.py" },
    @{ src = "network_agent/__init__.py";               dst = "agents/network_agent/__init__.py" },
    @{ src = "network_agent/modules/__init__.py";       dst = "agents/network_agent/modules/__init__.py" },
    @{ src = "network_agent/modules/adapters.py";       dst = "agents/network_agent/modules/adapters.py" },
    @{ src = "network_agent/modules/connectivity.py";   dst = "agents/network_agent/modules/connectivity.py" },
    @{ src = "network_agent/modules/diagnostics.py";    dst = "agents/network_agent/modules/diagnostics.py" },
    @{ src = "network_agent/modules/fixes.py";          dst = "agents/network_agent/modules/fixes.py" },
    @{ src = "network_agent/modules/lan_scan.py";       dst = "agents/network_agent/modules/lan_scan.py" },
    @{ src = "network_agent/rules/network_rules.json";  dst = "agents/network_agent/rules/network_rules.json" },
    @{ src = "automation/self-heal/fix-references.sh";  dst = "automation/self-heal/fix-references.sh" },
    @{ src = "automation/self-heal/fix-yaml.sh";        dst = "automation/self-heal/fix-yaml.sh" },
    @{ src = "automation/test/run-all-tests.sh";        dst = "automation/test/run-all-tests.sh" },
    @{ src = "automation/setup/install-dependencies.sh"; dst = "automation/setup/install-dependencies.sh" },
    @{ src = "automation/templates/create-module.sh";   dst = "automation/templates/create-module.sh" }
)

Write-Host "=== Fetching files from $sourceRepo ===" -ForegroundColor Cyan

# Step 1: Get base tree SHA from branch
$branchData = gh api "repos/$repo/git/ref/heads/$branch" | ConvertFrom-Json
$commitSha = $branchData.object.sha
$commitData = gh api "repos/$repo/git/commits/$commitSha" | ConvertFrom-Json
$baseTreeSha = $commitData.tree.sha

Write-Host "Base commit: $commitSha"
Write-Host "Base tree:   $baseTreeSha"

# Step 2: Create blobs for each file
$treeEntries = @()

foreach ($mapping in $fileMappings) {
    $srcPath = $mapping.src
    $dstPath = $mapping.dst
    
    Write-Host "  Fetching: $srcPath -> $dstPath" -ForegroundColor Yellow
    
    try {
        $fileData = gh api "repos/$sourceRepo/contents/$srcPath" | ConvertFrom-Json
        $content = $fileData.content -replace "`n","" -replace "`r",""
        
        # Create blob
        $blobJson = @{ content = $content; encoding = "base64" } | ConvertTo-Json -Compress
        $blob = $blobJson | gh api "repos/$repo/git/blobs" -X POST --input - | ConvertFrom-Json
        
        $treeEntries += @{
            path = $dstPath
            mode = "100644"
            type = "blob"
            sha  = $blob.sha
        }
        Write-Host "    Blob created: $($blob.sha.Substring(0,7))" -ForegroundColor Green
    }
    catch {
        Write-Host "    SKIP (not found or error): $srcPath" -ForegroundColor Red
    }
}

# Step 3: Also add a README for protoflow
$protoflowReadme = @"
# ProtoFlow — Orchestration Engine

Ported from ballsDeepnit. Core orchestration modules for Rezonate wearable instrument system.

## Modules

- **bluetoothHub.js** — BLE gateway for wearable device discovery and connection
- **taskScheduler.js** — Scheduled task runner with intensity levels
- **udpValidator.js** — UDP protocol validation for Hydi compliance
- **scaffolder.js** — Project scaffolding with template support
- **index.js** — Main orchestrator that runs all modules in parallel

## Origin

These modules were originally developed in the ballsDeepnit repo and consolidated here.
"@

$readmeBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($protoflowReadme))
$readmeBlobJson = @{ content = $readmeBase64; encoding = "base64" } | ConvertTo-Json -Compress
$readmeBlob = $readmeBlobJson | gh api "repos/$repo/git/blobs" -X POST --input - | ConvertFrom-Json
$treeEntries += @{ path = "software/protoflow/README.md"; mode = "100644"; type = "blob"; sha = $readmeBlob.sha }

# Add network agent README
$naReadme = @"
# Network Agent

Ported from ballsDeepnit. Local network diagnostics agent for device connectivity.

## Features

- Adapter discovery and gateway detection
- Connectivity tests (ping, DNS, HTTPS)
- LAN scanning for device discovery
- Diagnostic issue detection
- Automated fix suggestions

## Usage

``````bash
python -m agents.network_agent.main --json
``````

## Origin

Originally developed in ballsDeepnit for ProtoForge network diagnostics.
"@

$naBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($naReadme))
$naBlobJson = @{ content = $naBase64; encoding = "base64" } | ConvertTo-Json -Compress
$naBlob = $naBlobJson | gh api "repos/$repo/git/blobs" -X POST --input - | ConvertFrom-Json
$treeEntries += @{ path = "agents/network_agent/README.md"; mode = "100644"; type = "blob"; sha = $naBlob.sha }

Write-Host "`n=== Creating tree with $($treeEntries.Count) entries ===" -ForegroundColor Cyan

# Step 4: Create tree
$treePayload = @{
    base_tree = $baseTreeSha
    tree = $treeEntries
} | ConvertTo-Json -Depth 5 -Compress

$tree = $treePayload | gh api "repos/$repo/git/trees" -X POST --input - | ConvertFrom-Json
Write-Host "Tree created: $($tree.sha.Substring(0,7))" -ForegroundColor Green

# Step 5: Create commit
$commitPayload = @{
    message = "feat: consolidate ballsDeepnit modules into rezonette`n`nPorted from waveformer1984/ballsDeepnit:`n- ProtoFlow orchestration (BLE hub, task scheduler, UDP validator, scaffolder)`n- Network Agent (diagnostics, LAN scan, connectivity tests)`n- Automation scripts (self-heal, test, setup, templates)`n`nCloses consolidation of ballsDeepnit into rezonette."
    tree = $tree.sha
    parents = @($commitSha)
} | ConvertTo-Json -Depth 3 -Compress

$commit = $commitPayload | gh api "repos/$repo/git/commits" -X POST --input - | ConvertFrom-Json
Write-Host "Commit created: $($commit.sha.Substring(0,7))" -ForegroundColor Green

# Step 6: Update branch ref
$refPayload = @{ sha = $commit.sha; force = $false } | ConvertTo-Json -Compress
$refPayload | gh api "repos/$repo/git/refs/heads/$branch" -X PATCH --input - | Out-Null
Write-Host "Branch updated: $branch -> $($commit.sha.Substring(0,7))" -ForegroundColor Green

# Step 7: Create PR
Write-Host "`n=== Creating Pull Request ===" -ForegroundColor Cyan
$prBody = @"
## Consolidate ballsDeepnit into Rezonette

Ports valuable modules from ``ballsDeepnit`` into the main Rezonette repo.

### What's included

**ProtoFlow Orchestration** (``software/protoflow/``)
- ``bluetoothHub.js`` — BLE gateway for wearable device discovery
- ``taskScheduler.js`` — Scheduled task runner with intensity levels
- ``udpValidator.js`` — UDP protocol validation (Hydi compliance)
- ``scaffolder.js`` — Project scaffolding with templates
- ``index.js`` — Main orchestrator

**Network Agent** (``agents/network_agent/``)
- Full Python network diagnostics agent
- Adapter discovery, connectivity tests, LAN scanning
- Diagnostic issue detection and fix suggestions

**Automation Scripts** (``automation/``)
- Self-heal scripts (fix references, fix YAML)
- Test runner
- Setup/install dependencies
- Module creation templates

### Origin
All code ported from [ballsDeepnit](https://github.com/waveformer1984/ballsDeepnit).
"@

gh pr create --repo $repo --base main --head $branch --title "feat: consolidate ballsDeepnit modules into rezonette" --body $prBody

Write-Host "`n=== DONE ===" -ForegroundColor Green
