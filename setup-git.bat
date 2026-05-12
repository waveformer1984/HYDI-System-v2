@echo off
echo Setting up Git repository...

REM Remove any corrupted git directory
if exist ".git" (
    echo Removing corrupted .git directory...
    rmdir /s /q ".git"
)

REM Create new git directory structure
mkdir ".git"
mkdir ".git\objects"
mkdir ".git\objects\packs"
mkdir ".git\refs\heads"
mkdir ".git\refs\tags"
mkdir ".git\info"

REM Create initial git config
echo [core] > ".git\config"
echo repositoryformatversion = 0 >> ".git\config"
echo filemode = false >> ".git\config"
echo bare = false >> ".git\config"
echo logallrefupdates = true >> ".git\config"
echo symlinks = false >> ".git\config"
echo ignorecase = true >> ".git\config"

REM Create HEAD file
echo ref: refs/heads/main > ".git\HEAD"

REM Add files and commit
git add .
git commit -m "Initial commit - HYDI System CLI-First Global Orchestrator"

echo Git repository setup complete!
echo Ready for GitHub push!
