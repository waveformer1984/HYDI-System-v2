# 🧩 PROTOFORGE INTEGRATION RULES

## CORE DISCIPLINE

```markdown
1. NO AGENT duplicates another agent's role
2. ALL communication goes through event system
3. HEIDI has final routing authority
4. FINANCE can override ANY agent on budget issues
5. SECURITY can override ANY agent on risk issues
6. USER (J) overrides EVERYTHING
```

## EVENT SYSTEM RULES

### Communication Protocol
- All inter-agent communication uses the event bus
- No direct agent-to-agent calls
- Event format: `{id, type, source_agent, target_agent, priority, payload, timestamp}`
- Priority levels: `critical`, `high`, `medium`, `low`

### Event Routing
- HEIDI routes all events
- Agents subscribe to specific event types
- Broadcast events go to all subscribed agents
- Targeted events go to specific agents

### Event Handling
- Each agent handles only its designated event types
- Agents cannot handle events outside their scope
- Escalation goes through HEIDI
- No event modification in transit

## AUTHORITY MATRIX

### Primary Authority
1. **USER (J)** - Absolute override authority
2. **HEIDI** - Final routing and coordination authority
3. **FINANCE** - Budget override authority
4. **SECURITY** - Risk override authority

### Secondary Authority
- **URSULA** - Strategic advisory authority
- **GRIND** - Execution pressure authority
- **VENT'OR** - Human support authority

### Operational Authority
- All other agents have authority only within their designated scope
- No agent can override another agent within the same authority level
- Cross-disciplinary decisions require HEIDI coordination

## SCOPE BOUNDARIES

### No Overlap Zones
- **ARCHITECT**: Design only, no construction
- **CONSTRUCTION**: Build only, no design
- **FINANCE**: Money only, no operations
- **FUNDING**: Acquisition only, no spending
- **OUTREACH**: External only, no internal operations

### Shared Resources
- **ENERGY**: Power systems only, no facility control
- **FACILITY**: Building systems only, no power generation
- **AI SYSTEMS**: Infrastructure only, no application logic
- **SECURITY**: Protection only, no operations

### Handoff Points
- Design → Construction (via HEIDI)
- Budget → Operations (via FINANCE)
- Strategy → Execution (via HEIDI)
- Risk → Action (via SECURITY)

## CONFLICT RESOLUTION

### Priority Rules
1. Safety and security conflicts → SECURITY overrides
2. Budget conflicts → FINANCE overrides
3. Strategic conflicts → HEIDI decides
4. Operational conflicts → HEIDI mediates
5. User conflicts → USER overrides all

### Escalation Path
1. Agent detects conflict
2. Agent escalates to HEIDI
3. HEIDI assesses and routes
4. HEIDI enforces resolution
5. All agents comply

### Resolution Methods
- **Budget**: Reallocate or defer
- **Timeline**: Adjust or prioritize
- **Scope**: Reduce or expand
- **Authority**: Clarify or delegate

## MEMORY CONSISTENCY

### Single Source of Truth
- All agents read from UCL (Unified Cognitive Layer)
- No agent creates its own knowledge base
- UCL updates go through HEIDI
- Memory conflicts resolved by HEIDI

### Data Types
- **Static**: Identity, mission, architecture (immutable)
- **Dynamic**: Tasks, financial data, progress (mutable)
- **Vector**: Patterns, decisions, outcomes (learned)

### Update Rules
- Only designated agents can update specific data types
- Updates must be event-triggered
- All updates logged in UCL
- No direct memory modification

## ENFORCEMENT PROTOCOLS

### Violation Detection
- HEIDI monitors for scope violations
- FINANCE monitors for budget violations
- SECURITY monitors for risk violations
- UCL monitors for memory violations

### Violation Response
1. Immediate event escalation
2. Agent isolation if necessary
3. System rollback if needed
4. Authority enforcement
5. Documentation and review

### Recovery Procedures
- Identify violation source
- Isolate affected systems
- Restore from last known good state
- Implement prevention measures
- Update integration rules if needed

## COMPLIANCE CHECKLIST

### Agent Development
- [ ] Clear scope definition
- [ ] No role overlap
- [ ] Event system integration
- [ ] Authority boundaries defined
- [ ] UCL integration

### System Integration
- [ ] Event routing functional
- [ ] Authority matrix enforced
- [ ] Memory consistency maintained
- [ ] Conflict resolution working
- [ ] Violation detection active

### Operational Readiness
- [ ] All agents role-locked
- [ ] Event system stable
- [ ] UCL accessible to all
- [ ] Integration rules enforced
- [ ] User override functional

---

## 🧠 FINAL WARNING

This system only works if you:
1. **NEVER** let agents overlap their roles
2. **ALWAYS** use the event system
3. **RESPECT** the authority matrix
4. **ENFORCE** the integration rules

Break these rules and you get chaos.
Follow them and you get an organization that actually works.

The choice is yours.
