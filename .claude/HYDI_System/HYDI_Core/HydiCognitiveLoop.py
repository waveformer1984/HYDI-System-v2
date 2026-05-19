#!/usr/bin/env python3
"""
HydiCognitiveLoop — ReAct (Reason + Act) autonomous agent loop.

Architecture:
  1. REASON   — Claude reasons about the goal given short-term + long-term memory
  2. ACT       — Execute the chosen tool in the sandbox
  3. OBSERVE   — Capture the result
  4. STORE     — Write error lessons to long-term memory; push step to short-term
  5. LOOP      — Repeat until final_answer or budget exhausted

Usage (CLI):
  python HydiCognitiveLoop.py --goal "Summarize all HYDI agents and what they do"
  python HydiCognitiveLoop.py --goal "..." --max-iterations 15

Environment:
  ANTHROPIC_API_KEY  — required
"""
import argparse
import datetime
import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Ensure UTF-8 output on Windows
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    import anthropic
except ImportError:
    print(json.dumps({"error": "anthropic package not installed — run: pip install anthropic"}))
    sys.exit(1)

from HydiMemory import HydiMemory
from HydiToolSandbox import HydiToolSandbox

_LOG_DIR = Path(__file__).resolve().parent.parent / "HYDI_Vault" / "AuditLogs"
_MODEL = "claude-opus-4-7"
_TOKEN_BUDGET = 80_000  # hard stop before runaway cost

_SYSTEM_PROMPT = """\
You are Hydi, the autonomous intelligence core of ProtoForge Labs.
Your role is to reason, plan, execute tools, and iterate until you reach a complete answer.

For EVERY response you MUST output a single valid JSON object — no markdown, no prose:
{
  "thought": "<your reasoning about the current state and what to do next>",
  "action": "tool_call" | "final_answer",
  "tool": "python_exec" | "file_read" | "file_write" | null,
  "tool_input": "<string — the code, path, or JSON params>",
  "answer": "<string — only when action=final_answer, else null>"
}

Available tools:
  python_exec    — Execute Python code in a sandbox. Set result = <value> to capture output.
  file_read      — Read a file by absolute path.
  file_write     — Write a file. tool_input = JSON {"path": "...", "content": "..."}
  trade_execute  — Propose a financial trade through the governance gate.
                   tool_input = JSON {"symbol":"AAPL","action":"buy","quantity":10,
                   "price":195.0,"strategy_id":"my_strategy","rationale":"optional reason"}
                   Returns TRADE APPROVED or TRADE BLOCKED with reason and audit hash.
                   ALWAYS use this tool for any financial action — never use python_exec for trades.

Constraints:
  - Keep thoughts concise (1-3 sentences)
  - Write minimal, correct Python — no subprocess, no socket, no ctypes
  - Credentials and ~/.ssh are blocked at the sandbox level
  - Always emit valid JSON — no trailing commas, no comments
  - If a tool fails, diagnose and retry differently or declare final_answer with what you know
"""


@dataclass
class Step:
    iteration: int
    thought: str
    tool: Optional[str]
    tool_input: Optional[str]
    observation: str
    timestamp: str = field(default_factory=lambda: datetime.datetime.utcnow().isoformat())


@dataclass
class CognitiveState:
    goal: str
    session_id: str
    max_iterations: int = 10
    iterations: int = 0
    tokens_used: int = 0
    short_term: list[Step] = field(default_factory=list)
    completed: bool = False
    final_answer: Optional[str] = None


class HydiCognitiveLoop:
    def __init__(self, goal: str, max_iterations: int = 10):
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise EnvironmentError("ANTHROPIC_API_KEY is not set.")

        session_id = hashlib.md5(f"{goal}{time.time()}".encode()).hexdigest()[:8]
        self.state = CognitiveState(
            goal=goal,
            session_id=session_id,
            max_iterations=max_iterations,
        )
        self.memory = HydiMemory()
        self.sandbox = HydiToolSandbox()
        self.client = anthropic.Anthropic(api_key=api_key)
        self._log(f"Session {session_id} started | goal: {goal[:120]}")

    # ---------------------------------------------------------------- loop

    def run(self) -> dict:
        self._log("Entering cognitive loop")

        while (
            not self.state.completed
            and self.state.iterations < self.state.max_iterations
            and self.state.tokens_used < _TOKEN_BUDGET
        ):
            self.state.iterations += 1
            self._log(f"--- iteration {self.state.iterations} ---")

            parsed = self._reason()
            if parsed is None:
                break

            thought = parsed.get("thought", "")
            action = parsed.get("action", "tool_call")

            if action == "final_answer":
                self.state.completed = True
                self.state.final_answer = parsed.get("answer", "")
                self._log(f"Final answer reached after {self.state.iterations} iterations")
                break

            tool = parsed.get("tool")
            tool_input = parsed.get("tool_input") or ""
            observation = self._act(tool, tool_input)

            step = Step(
                iteration=self.state.iterations,
                thought=thought,
                tool=tool,
                tool_input=tool_input[:500],
                observation=observation[:800],
            )
            self.state.short_term.append(step)
            self._store_lesson(step)

        result = {
            "goal": self.state.goal,
            "session_id": self.state.session_id,
            "completed": self.state.completed,
            "iterations": self.state.iterations,
            "tokens_used": self.state.tokens_used,
            "answer": self.state.final_answer,
            "timestamp": datetime.datetime.utcnow().isoformat(),
        }
        self.memory.store(f"session_{self.state.session_id}", result)
        self._log(f"Loop ended | completed={result['completed']} | tokens={result['tokens_used']}")
        return result

    # ---------------------------------------------------------------- reason

    def _reason(self) -> Optional[dict]:
        """Call Claude with the current state; return parsed JSON or None on failure."""
        messages = self._build_messages()

        try:
            response = self.client.messages.create(
                model=_MODEL,
                max_tokens=2048,
                system=_SYSTEM_PROMPT,
                messages=messages,
            )
        except Exception as e:
            self._log(f"API error: {e}")
            return None

        self.state.tokens_used += response.usage.input_tokens + response.usage.output_tokens
        raw = response.content[0].text.strip()

        # Strip markdown code fences if the model adds them
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1].lstrip("json").strip() if len(parts) >= 2 else raw

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            self._log(f"JSON parse failed — raw:\n{raw[:300]}")
            # Return a fallback so the loop terminates cleanly
            return {"action": "final_answer", "answer": f"Parse error. Raw output: {raw[:500]}"}

    def _build_messages(self) -> list[dict]:
        """Build the messages array from goal + conversation history."""
        # Retrieve relevant long-term memories
        relevant = self.memory.retrieve_relevant(self.state.goal, top_k=4)
        memory_block = ""
        if relevant:
            memory_block = "\n\nRelevant past knowledge:\n" + json.dumps(
                [{"key": m["key"], "summary": str(m["memory"])[:200]} for m in relevant],
                indent=2,
            )

        first_user = f"Goal: {self.state.goal}{memory_block}"
        messages: list[dict] = [{"role": "user", "content": first_user}]

        # Replay short-term history as assistant/user turns
        for step in self.state.short_term[-8:]:  # cap context at last 4 rounds
            messages.append({
                "role": "assistant",
                "content": json.dumps({
                    "thought": step.thought,
                    "action": "tool_call",
                    "tool": step.tool,
                    "tool_input": step.tool_input,
                    "answer": None,
                }),
            })
            messages.append({
                "role": "user",
                "content": f"Observation: {step.observation}",
            })

        return messages

    # ---------------------------------------------------------------- act

    def _act(self, tool: Optional[str], tool_input: str) -> str:
        """Dispatch to the sandbox and return an observation string."""
        if tool == "python_exec":
            obs = self.sandbox.run_python(tool_input)
        elif tool == "file_read":
            obs = self.sandbox.read_file(tool_input)
        elif tool == "file_write":
            try:
                params = json.loads(tool_input)
                obs = self.sandbox.write_file(params["path"], params["content"])
            except (json.JSONDecodeError, KeyError) as e:
                obs = f"Error: file_write tool_input must be JSON with 'path' and 'content' keys. Got: {e}"
        elif tool == "trade_execute":
            from HydiGovernanceHooks import evaluate_trade
            obs = evaluate_trade(tool_input, session_id=self.state.session_id)
        elif tool is None:
            obs = "No tool specified — nothing executed."
        else:
            obs = f"Unknown tool '{tool}'. Available: python_exec, file_read, file_write, trade_execute."

        self._log(f"Tool={tool} | obs_preview={obs[:120]}")
        return obs

    # ---------------------------------------------------------------- memory

    def _store_lesson(self, step: Step) -> None:
        """Persist error lessons to long-term memory so future sessions avoid them."""
        obs_lower = step.observation.lower()
        if any(kw in obs_lower for kw in ("error", "traceback", "failed", "exception", "timed out")):
            lesson = {
                "type": "error_lesson",
                "goal_context": self.state.goal[:120],
                "thought": step.thought[:200],
                "tool": step.tool,
                "error_summary": step.observation[:300],
                "recorded_at": step.timestamp,
            }
            self.memory.store(f"lesson_{self.state.session_id}_{step.iteration}", lesson)

    # ---------------------------------------------------------------- logging

    def _log(self, msg: str) -> None:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        line = f"[{datetime.datetime.utcnow().isoformat()}] [HYDI_LOOP:{self.state.session_id}] {msg}\n"
        log_file = _LOG_DIR / f"CognitiveLoop_{datetime.date.today()}.log"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(line)
        print(line, end="", flush=True)


# -------------------------------------------------------------------- CLI

def main() -> None:
    parser = argparse.ArgumentParser(description="Hydi Cognitive Loop")
    parser.add_argument("--goal", required=True, help="The goal for Hydi to accomplish")
    parser.add_argument(
        "--max-iterations", type=int, default=10,
        help="Maximum reasoning iterations (1-20, default 10)"
    )
    args = parser.parse_args()

    max_iter = max(1, min(20, args.max_iterations))

    loop = HydiCognitiveLoop(goal=args.goal, max_iterations=max_iter)
    result = loop.run()

    # Print result JSON as the last line — the TS server parses this
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
