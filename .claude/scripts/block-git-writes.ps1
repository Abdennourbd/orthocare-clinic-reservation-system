<#
    PreToolUse hook — blocks Bash commands that WRITE to git, plus a few
    catastrophic shell commands.

    Exit 2 blocks the tool call and returns stderr to the calling agent.
    Exit 0 lets it through.

    Design notes:
    - Uses ConvertFrom-Json (native to PowerShell). No dependency on jq, which
      is rarely installed on Windows.
    - Classifies by git SUBCOMMAND, not by substring. That is what lets
      `git log --grep=commit` through while blocking `git commit`.
    - Splits chained commands on && || ; | and newlines, so
      `cd src && git commit -am wip` is caught in its second segment.
    - Skips git's global options between `git` and the subcommand, so
      `git -C . reset --hard` is caught.
    - If the payload does not parse as JSON it scans the raw text instead of
      failing open — a guard that allows everything when confused is no guard.
#>

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- read stdin
$raw = ''
try { $raw = [Console]::In.ReadToEnd() } catch { $raw = '' }
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$cmd = $null
try {
    $cmd = ($raw | ConvertFrom-Json).tool_input.command
} catch {
    $cmd = $raw
}
if ([string]::IsNullOrWhiteSpace($cmd)) { exit 0 }

# -------------------------------------------------------------------- deny
function Deny([string]$reason) {
    $msg = @"
BLOCKED by block-git-writes.ps1 — $reason

Agents on this project never write to git. The user tests and commits their
own work.

What to do instead: stop here and tell the user the step is ready, with a
suggested commit message, for example:

    git add -A && git commit -m "<what this step did>" && git push

Read-only git remains available: git status, git diff, git log, git show.
"@
    [Console]::Error.WriteLine($msg)
    exit 2
}

# --------------------------------------------------------------- tokenizer
function Get-Tokens([string]$segment) {
    $matches = [regex]::Matches($segment, '"[^"]*"|''[^'']*''|[^\s]+')
    return @($matches | ForEach-Object { $_.Value.Trim('"', "'") })
}

# Returns the git subcommand of a segment, or $null when the segment is not a
# git invocation. Global options (and their values) are skipped.
function Get-GitSubcommand([string]$segment) {
    $tokens = Get-Tokens $segment
    if ($tokens.Count -eq 0) { return $null }

    $gitIndex = -1
    for ($i = 0; $i -lt $tokens.Count; $i++) {
        if ($tokens[$i] -match '(^|[\\/])git(\.exe)?$') { $gitIndex = $i; break }
    }
    if ($gitIndex -lt 0) { return $null }

    # Global options that consume the NEXT token as their value.
    $valueOpts = @('-C', '-c', '--git-dir', '--work-tree', '--namespace',
                   '--exec-path', '--config-env')

    for ($j = $gitIndex + 1; $j -lt $tokens.Count; $j++) {
        $t = $tokens[$j]
        if ($t.StartsWith('-')) {
            if ($valueOpts -contains $t) { $j++ }   # also skip its value
            continue
        }
        return $t.ToLowerInvariant()
    }
    return $null
}

# ------------------------------------------------------------------ rules
$blockedSubcommands = @(
    'commit', 'push', 'add', 'merge', 'rebase', 'reset', 'checkout', 'switch',
    'restore', 'cherry-pick', 'revert', 'stash', 'tag', 'clean'
)

$segments = [regex]::Split($cmd, '&&|\|\||;|\||\r?\n')

foreach ($segment in $segments) {
    $s = $segment.Trim()
    if ([string]::IsNullOrWhiteSpace($s)) { continue }

    # --- git writes
    $sub = Get-GitSubcommand $s
    if ($sub -and ($blockedSubcommands -contains $sub)) {
        Deny "``git $sub`` writes to the repository."
    }

    # --- privilege escalation
    if ($s -match '(^|\s)sudo(\s|$)') {
        Deny 'sudo is not allowed.'
    }

    # --- world-writable permissions
    if ($s -match '(^|\s)chmod(\s+-\S+)*\s+0?777(\s|$)') {
        Deny 'chmod 777 makes files world-writable.'
    }

    # --- rm -rf against a root or wildcard target
    if ($s -match '(^|\s)rm(\s|$)') {
        $recursive = ($s -match '\s-[a-zA-Z]*r[a-zA-Z]*(\s|$)') -or ($s -match '\s--recursive(\s|$)')
        $force     = ($s -match '\s-[a-zA-Z]*f[a-zA-Z]*(\s|$)') -or ($s -match '\s--force(\s|$)')
        if ($recursive -and $force -and ($s -match '\s(/|/\*|~|~/\*?|[A-Za-z]:\\?|\.|\*)\s*$')) {
            Deny 'rm -rf against a root, home or wildcard target.'
        }
    }
}

exit 0
