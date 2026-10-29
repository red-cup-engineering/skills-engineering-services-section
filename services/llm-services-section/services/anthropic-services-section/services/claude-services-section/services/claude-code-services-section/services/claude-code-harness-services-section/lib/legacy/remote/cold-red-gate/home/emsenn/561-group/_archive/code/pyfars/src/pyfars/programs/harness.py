"""HarnessProgram — agentic-loop scaffolding.

A harness program drives one persona-agent through a multi-step loop
against a live engine. Each loop iteration:

  1. Composes a prompt from the assignment + the agent's session memory.
  2. Invokes the agent (via pydantic_ai) — the LLM may call tools.
  3. Each tool call passes through ``check-authorization`` (FOUR-valued
     gate against the agent's working fiber).
  4. Each step emits a witness on the ``harness`` channel with
     ``acting_office`` set, so the audit chain reconstructs the loop.
  5. Termination is substrate-readable: ``(assignment, status, settled)``,
     a step budget, or the agent calling ``mark_done`` / ``escalate``.

The math:

  - :func:`compute_working_fiber` builds the agent's effective scope
    from its office's deontic-profile + JuralRelation derivation.
  - :func:`check_authorization` projects each tool call's required
    predicates to the four-valued decision per the residuated-
    restriction theorem.
  - The witness chain (one per tool call, one per step) is the loop's
    audit trail — replay reproduces the agent's decisions deterministically
    given the same substrate state.

The imperative parts (the LLM call, the tool function bodies) are
isolated to two well-defined edges: pydantic_ai's ``Agent.run`` for
the model invocation, and :mod:`pyfars.sdk.tools` for the operation
primitives.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic_ai import Agent as PydanticAIAgent

from pyfars.client import uds
from pyfars.kernel.operator.auth import (
    Action,
    RequiredPredicate,
    check_authorization,
    compute_working_fiber,
)
from pyfars.kernel.witness import make_witness
from pyfars.programs.base import Program, ProgramResult, _now_iso
from pyfars.sdk import tools as sdk_tools
from pyfars.sdk.entities import Agent, Endpoint, load_one


@dataclass
class HarnessResult(ProgramResult):
    """Outcome of one harness-program run."""
    agent_slug: str = ""
    assignment_slug: str = ""
    steps_executed: int = 0
    terminated_reason: str = ""
    tool_call_count: int = 0
    denials: int = 0


class HarnessProgram(Program):
    """Long-running per-agent loop. One agent, one assignment, until settled.

    Construct with the polity root, the agent slug, the assignment
    slug, and an optional office (the agent's current acting office —
    if omitted, the working fiber composes from all of the agent's
    holdings).

    Tool surface registered with the underlying pydantic_ai Agent:

      Read-only (from :mod:`pyfars.sdk.tools`):
        show_subject, polity_facts, list_offices, read_assignments,
        recent_events.

      Memory:
        read_memory(section), update_memory_section(section, content).
        Both gated by check_authorization; updates emit a
        ``memory_section_updated`` witness on the ``memory`` channel
        in addition to mutating the session JSON.

      Termination:
        mark_done, escalate.

      Witnessing:
        append_witness.

    Each tool call is gated by ``check-authorization``. The
    ``required_predicates`` fiber for a tool call is one cell: ``power``
    over ``harness.<tool_name>``. Polities author JuralRelation cells
    (via their office deontic-profiles) granting this power; missing
    grants produce a strict-deny per the spec.
    """

    def __init__(
        self,
        root: Path,
        *,
        agent: str,
        assignment: str,
        office: str | None = None,
        session: str | None = None,
        step_budget: int = 20,
        channel: str = "harness",
    ) -> None:
        super().__init__(root)
        self.agent_slug = agent
        self.assignment_slug = assignment
        self.office_slug = office
        self.session_slug = session or f"session:{agent}:{assignment}"
        self.step_budget = step_budget
        self.channel = channel

        self.step_count = 0
        self.tool_call_count = 0
        self.denials = 0
        self.terminated_reason = ""

    # ---- run loop ----------------------------------------------------

    async def run(self) -> HarnessResult:
        started_at = _now_iso()
        self.validate()
        self.boot()
        self.emit(
            operator="harness_boot",
            details={
                "agent": self.agent_slug,
                "assignment": self.assignment_slug,
                "office": self.office_slug,
                "session": self.session_slug,
                "step_budget": self.step_budget,
                "started_at": started_at,
            },
            channel=self.channel,
            origin="HarnessProgram",
        )

        agent_record = load_one(Agent, self.system.store, self.agent_slug)
        if agent_record is None:
            self.terminated_reason = "agent_record_missing"
            return self._finish(started_at)

        ai_agent = self._build_ai_agent(agent_record)
        self._register_tools(ai_agent)

        while not self._terminated():
            await self._step(ai_agent)
            self.step_count += 1

        return self._finish(started_at)

    def _finish(self, started_at: str) -> HarnessResult:
        halted_at = _now_iso()
        self.emit(
            operator="harness_halt",
            details={
                "agent": self.agent_slug,
                "assignment": self.assignment_slug,
                "steps_executed": self.step_count,
                "tool_call_count": self.tool_call_count,
                "denials": self.denials,
                "terminated_reason": self.terminated_reason,
                "started_at": started_at,
                "halted_at": halted_at,
            },
            channel=self.channel,
            origin="HarnessProgram",
        )
        self.halt()
        return HarnessResult(
            started_at=started_at,
            halted_at=halted_at,
            agent_slug=self.agent_slug,
            assignment_slug=self.assignment_slug,
            steps_executed=self.step_count,
            terminated_reason=self.terminated_reason,
            tool_call_count=self.tool_call_count,
            denials=self.denials,
        )

    async def _step(self, ai_agent: PydanticAIAgent) -> None:
        prompt = self._compose_prompt()
        try:
            result = await ai_agent.run(prompt)
            output = str(result.output) if result is not None else ""
        except Exception as exc:
            output = ""
            self.emit(
                operator="harness_step_failed",
                details={
                    "agent": self.agent_slug,
                    "step": self.step_count,
                    "error": f"{type(exc).__name__}: {exc}",
                },
                channel=self.channel,
                kind="observation",
                origin="HarnessProgram",
            )
            self.terminated_reason = f"step_exception: {type(exc).__name__}"
            return

        self.emit(
            operator="harness_step",
            details={
                "agent": self.agent_slug,
                "assignment": self.assignment_slug,
                "step": self.step_count,
                "output_text": output[:4000],
            },
            channel=self.channel,
            origin="HarnessProgram",
        )

    # ---- agent + tool wiring -----------------------------------------

    def _build_ai_agent(self, agent_record: Agent) -> PydanticAIAgent:
        endpoint_slug = None
        from pyfars.kernel import query
        for obj in query.objects_under(
            self.system.store, agent_record.slug, ("uses-endpoint",),
        ):
            endpoint_slug = str(obj)
            break
        if endpoint_slug is None:
            raise ValueError(
                f"no (uses-endpoint) cell for agent {agent_record.slug!r}; "
                "the polity's endpoint-selection closure rules must run "
                "before the harness boots"
            )
        endpoint = load_one(Endpoint, self.system.store, endpoint_slug)
        if endpoint is None:
            raise ValueError(f"endpoint {endpoint_slug!r} not loadable")
        model_spec = f"{endpoint.provider}:{endpoint.model}"
        return PydanticAIAgent(
            model=model_spec, system_prompt=agent_record.system_prompt,
        )

    def _register_tools(self, ai_agent: PydanticAIAgent) -> None:
        root = self.root

        @ai_agent.tool_plain
        def show_subject(subject: str) -> dict:
            return self._call_tool(
                "show_subject",
                lambda: sdk_tools.show_subject(root=root, subject=subject),
            )

        @ai_agent.tool_plain
        def polity_facts() -> dict:
            return self._call_tool(
                "polity_facts",
                lambda: sdk_tools.polity_facts(root=root),
            )

        @ai_agent.tool_plain
        def list_offices() -> dict:
            return self._call_tool(
                "list_offices",
                lambda: sdk_tools.list_offices(root=root),
            )

        agent_slug = self.agent_slug

        @ai_agent.tool_plain
        def read_assignments() -> dict:
            return self._call_tool(
                "read_assignments",
                lambda: sdk_tools.read_assignments(
                    root=root, agent=agent_slug,
                ),
            )

        @ai_agent.tool_plain
        def recent_events(n: int = 50) -> dict:
            return self._call_tool(
                "recent_events",
                lambda: sdk_tools.recent_events(root=root, n=n),
            )

        session_slug = self.session_slug

        @ai_agent.tool_plain
        def read_memory(section: str) -> dict:
            return self._call_tool(
                "read_memory",
                lambda: sdk_tools.read_memory(
                    root=root, session_id=session_slug, section=section,
                ),
            )

        @ai_agent.tool_plain
        def update_memory_section(section: str, content: str) -> dict:
            return self._call_tool(
                "update_memory_section",
                lambda: sdk_tools.update_memory_section(
                    root=root,
                    session_id=session_slug,
                    section=section,
                    content=content,
                    agent=self.agent_slug,
                    acting_office=self.office_slug,
                ),
            )

        @ai_agent.tool_plain
        def append_witness(
            operator: str,
            target: str,
            details: dict | None = None,
            channel: str = "session",
        ) -> dict:
            return self._call_tool(
                "append_witness",
                lambda: sdk_tools.append_witness(
                    root=root,
                    operator=operator,
                    target=target,
                    details=details,
                    channel=channel,
                    agent=self.agent_slug,
                    acting_office=self.office_slug,
                ),
            )

        @ai_agent.tool_plain
        def mark_done(reason: str = "") -> dict:
            return self._call_tool(
                "mark_done",
                lambda: sdk_tools.append_witness(
                    root=root,
                    operator="assignment_settled",
                    target=self.assignment_slug,
                    details={"reason": reason, "by_agent": self.agent_slug},
                    channel=self.channel,
                    agent=self.agent_slug,
                    acting_office=self.office_slug,
                ),
            )

        @ai_agent.tool_plain
        def escalate(reason: str) -> dict:
            return self._call_tool(
                "escalate",
                lambda: sdk_tools.append_witness(
                    root=root,
                    operator="assignment_escalated",
                    target=self.assignment_slug,
                    details={"reason": reason, "by_agent": self.agent_slug},
                    channel=self.channel,
                    agent=self.agent_slug,
                    acting_office=self.office_slug,
                ),
            )

    def _call_tool(self, tool_name: str, fn) -> dict[str, Any]:
        """Authorize one tool invocation, run it, witness the outcome."""
        action = Action(
            name=f"harness.{tool_name}",
            required_predicates=(
                RequiredPredicate(
                    kind="power", scope_action=f"harness.{tool_name}",
                ),
            ),
        )
        working_fiber = compute_working_fiber(
            self.system.store,
            agent=self.agent_slug,
            office=self.office_slug,
        )
        decision, witness = check_authorization(
            working_fiber, action, session=self.session_slug,
        )
        try:
            self.log.append(witness)
        except OSError:
            pass
        if decision != "admit":
            self.denials += 1
            return {
                "error": "authorization denied",
                "decision": decision,
                "tool": tool_name,
            }
        self.tool_call_count += 1
        result = fn()
        if result.ok:
            return result.data
        return {"error": result.error or "tool failed"}

    # ---- prompt composition + termination ----------------------------

    def _compose_prompt(self) -> str:
        """Compose this step's prompt.

        Minimal floor: state the assignment slug and the current step;
        the agent's system-prompt carries the persona/duties context.
        Polities can author richer prompt-composition closure rules
        later (e.g. injecting recent witnesses, memory-bank sections);
        this is the substrate's starting floor.
        """
        return (
            f"You are running step {self.step_count} of an agentic harness "
            f"on assignment `{self.assignment_slug}`.\n\n"
            "Read the substrate (show_subject, recent_events, list_offices, "
            "read_assignments, polity_facts) to ground yourself, take an "
            "action (append_witness), and call `mark_done` when the "
            "assignment is settled or `escalate` if you need help."
        )

    def _terminated(self) -> bool:
        if self.step_count >= self.step_budget:
            self.terminated_reason = "step_budget_exhausted"
            return True
        try:
            value = uds.value(
                self.assignment_slug, "status", "settled", start=self.root,
            )
            if value == "t":
                self.terminated_reason = "assignment_settled"
                return True
        except Exception:
            pass
        try:
            value = uds.value(
                self.assignment_slug, "status", "escalated", start=self.root,
            )
            if value == "t":
                self.terminated_reason = "assignment_escalated"
                return True
        except Exception:
            pass
        return False

    # ---- override emit to default channel + origin -------------------

    def emit(
        self,
        *,
        operator: str,
        details: dict[str, Any],
        kind: str = "mutation",
        origin: str | None = None,
        channel: str | None = None,
    ) -> None:
        try:
            self.log.append(make_witness(
                operator=operator,
                target=str(self.root),
                before_hash=None,
                after_hash=None,
                details=details,
                agent=self.agent_slug,
                acting_office=self.office_slug,
                channel=channel or self.channel,
                kind=kind,
                origin=origin or "HarnessProgram",
            ))
        except OSError:
            pass


__all__ = ["HarnessProgram", "HarnessResult"]
