<#
    PreToolUse hook — restricts Write/Edit to the agent memory directory.

    Wired into the frontmatter of ortho-security and ortho-reviewer only.
    Those two are read-only auditors, but `memory:` re-enables Write/Edit for
    them, which would silently void their tools: restriction. This hook is what
    actually keeps them read-only.

    ortho-db deliberately does NOT carry this hook: writing to prisma/ and src/
    is its job.

    Exit 2 blocks the tool call and returns stderr to the calling agent.
    Exit 0 lets it through.
#>

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- read stdin
$raw = ''
try { $raw = [Console]::In.ReadToEnd() } catch { $raw = '' }
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$target = $null
try {
    $target = ($raw | ConvertFrom-Json).tool_input.file_path
} catch {
    # Unparseable payload: block rather than fail open.
    [Console]::Error.WriteLine('BLOCKED — hook payload could not be parsed; refusing the write.')
    exit 2
}
if ([string]::IsNullOrWhiteSpace($target)) { exit 0 }

# ------------------------------------------------------- normalise the paths
# GetFullPath resolves ".." so a traversal cannot escape the allow-list.
$cwd = (Get-Location).Path

function Resolve-Full([string]$p) {
    if ([System.IO.Path]::IsPathRooted($p)) {
        return [System.IO.Path]::GetFullPath($p)
    }
    return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($cwd, $p))
}

$full = Resolve-Full $target

$allowedRoots = @(
    (Resolve-Full '.claude/agent-memory'),
    (Resolve-Full '.claude/agent-memory-local')
)

$sep = [System.IO.Path]::DirectorySeparatorChar
foreach ($root in $allowedRoots) {
    $prefix = $root.TrimEnd($sep) + $sep
    if ($full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { exit 0 }
    if ($full.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { exit 0 }
}

# Claude Code may place per-project agent memory under the USER directory
# (~/.claude/projects/<slug>/memory/) rather than inside the repository. Allow
# that location too, so the guard stays correct wherever memory actually lands.
# This is deliberately narrow: only .../projects/<one segment>/memory/... is
# allowed, so the rest of ~/.claude (settings, agents, transcripts) stays
# protected.
# NB: $home is a reserved PowerShell automatic variable — assigning to it throws.
$userHome = [Environment]::GetFolderPath('UserProfile')
$memoryPattern = '^' + [regex]::Escape((Join-Path $userHome '.claude')) +
                 '\\projects\\[^\\]+\\memory(\\|$)'
if ($full -match $memoryPattern) { exit 0 }

$msg = @"
BLOCKED by block-writes-outside-memory.ps1

Attempted write: $full

You are a read-only agent. You may only write inside your memory directory:
$($allowedRoots -join "`n")

What to do instead: report the problem as a finding, with its file:line and the
correction to apply. An implementation agent makes the change, not you.
"@
[Console]::Error.WriteLine($msg)
exit 2
