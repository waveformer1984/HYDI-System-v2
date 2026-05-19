"""
HydiToolSandbox — Isolated execution environment for LLM-generated code.

Security model:
  - Python code runs in a subprocess (not exec()) so it can't touch parent memory
  - Dangerous stdlib modules are blocked by static scan before execution
  - File writes are confined to HYDI_Vault/AgentOutput/
  - File reads are blocked from credential dirs
  - 30-second hard timeout per execution
"""
import os
import sys
import json
import subprocess
import tempfile
import textwrap

# Dirs that are off-limits for file reads
_BLOCKED_READ_PREFIXES = [
    os.path.abspath(os.path.expanduser("~/.ssh")),
    os.path.abspath(os.path.expanduser("~/.aws")),
    os.path.abspath(os.path.expanduser("~/.gnupg")),
    os.path.abspath(os.path.expanduser("~/AppData/Roaming")),
]

# Module names that must not appear in submitted code
_BLOCKED_TOKENS = [
    "subprocess",
    "os.system",
    "os.popen",
    "shutil.rmtree",
    "shutil.move",
    "socket",
    "ftplib",
    "smtplib",
    "ctypes",
    "winreg",
    "__import__",
    "importlib",
    "eval(",
    "exec(",
]

_TIMEOUT_SECONDS = 30
_MAX_OUTPUT_CHARS = 4000
_MAX_FILE_READ_BYTES = 1_000_000  # 1 MB

# Safe output directory for file writes
_OUTPUT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "HYDI_Vault", "AgentOutput")
)


class HydiToolSandbox:
    # ---------------------------------------------------------------- python

    def run_python(self, code: str) -> str:
        """Execute Python code in a subprocess. Returns stdout or error string."""
        if not code or not code.strip():
            return "Error: empty code provided"

        # Static safety scan
        for token in _BLOCKED_TOKENS:
            if token in code:
                return f"Error: blocked operation '{token}' detected — rewrite without it."

        # Wrap so the sandbox captures a 'result' variable if set
        wrapper = textwrap.dedent(f"""\
import json as _json, sys as _sys
try:
    result = None
{textwrap.indent(code, '    ')}
    if result is not None:
        print(_json.dumps({{"result": result}}))
except Exception as _e:
    print(_json.dumps({{"error": str(_e)}}))
""")

        tmp = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".py", delete=False, encoding="utf-8"
            ) as f:
                f.write(wrapper)
                tmp = f.name

            proc = subprocess.run(
                [sys.executable, tmp],
                capture_output=True,
                text=True,
                timeout=_TIMEOUT_SECONDS,
                env={k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY",)},
            )
            output = (proc.stdout + proc.stderr).strip() or "Execution complete, no output."
            return output[:_MAX_OUTPUT_CHARS]

        except subprocess.TimeoutExpired:
            return f"Error: execution timed out after {_TIMEOUT_SECONDS}s"
        except Exception as e:
            return f"Error spawning process: {e}"
        finally:
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

    # ------------------------------------------------------------------ file

    def read_file(self, path: str) -> str:
        """Read a file safely, enforcing blocked-path rules."""
        abs_path = os.path.abspath(path)

        for blocked in _BLOCKED_READ_PREFIXES:
            if abs_path.startswith(blocked):
                return f"Error: reading from '{path}' is not permitted."

        if not os.path.exists(abs_path):
            return f"Error: file not found: {abs_path}"

        if os.path.getsize(abs_path) > _MAX_FILE_READ_BYTES:
            return f"Error: file exceeds 1 MB read limit — use python_exec to process it in chunks."

        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(8000)
            return content
        except Exception as e:
            return f"Error reading file: {e}"

    def write_file(self, path: str, content: str) -> str:
        """
        Write a file, confined to HYDI_Vault/AgentOutput/.
        'path' can be a filename or full path; anything outside the output dir
        is redirected to the output dir using only the basename.
        """
        os.makedirs(_OUTPUT_DIR, exist_ok=True)
        abs_path = os.path.abspath(path)

        if not abs_path.startswith(_OUTPUT_DIR):
            # Redirect to safe output dir using filename only
            abs_path = os.path.join(_OUTPUT_DIR, os.path.basename(path))

        try:
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Written to {abs_path}"
        except Exception as e:
            return f"Error writing file: {e}"
