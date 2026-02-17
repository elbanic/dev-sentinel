# Kiro CLI Agents

This directory contains role definitions for specialized subagents used in the TDD workflow protocol.

## Available Agents

### 1. Test Architect (`test-architect.md`)
**Purpose**: Design comprehensive test cases before implementation

**When to use**: At the start of any new feature or bug fix to plan test coverage

**Expertise**:
- Test design and strategy
- Edge case identification
- Property-based testing
- Test coverage planning

### 2. Implementer (`implementer.md`)
**Purpose**: Implement features following test specifications with minimal, clean code

**When to use**: After test design is complete, to write the actual implementation

**Expertise**:
- TDD practices
- Design patterns
- Clean code principles
- Feature implementation

### 3. Code Reviewer (`code-reviewer.md`)
**Purpose**: Critical review of implementation quality and adherence to standards

**When to use**: After implementation is complete, before refactoring

**Expertise**:
- Code quality assessment
- Pattern adherence verification
- Security and performance review
- Test coverage validation

**Outputs**: APPROVED or REJECTED with detailed feedback

### 4. Refactorer (`refactorer.md`)
**Purpose**: Improve code quality while keeping all tests passing

**When to use**: After code review approval, to enhance maintainability

**Expertise**:
- Code refactoring techniques
- Performance optimization
- Code smell elimination
- Clean code principles

## TDD Workflow

```
🧪 test-architect → ⚙️ implementer → 🔍 code-reviewer → ✨ refactorer
                                           │
                                      REJECT → back to implementer
```

## Usage with Kiro CLI

### Manual Orchestration

The main agent orchestrates the workflow by calling subagents in sequence:

```typescript
// Example workflow for adding a new feature
1. Call test-architect subagent
   - Input: Feature requirements
   - Output: Comprehensive test specifications

2. Call implementer subagent
   - Input: Test specifications from step 1
   - Output: Implementation with passing tests

3. Call code-reviewer subagent
   - Input: Implementation from step 2
   - Output: APPROVED or REJECTED with feedback

4. If REJECTED: Return to step 2 with feedback
   If APPROVED: Proceed to step 5

5. Call refactorer subagent
   - Input: Approved implementation
   - Output: Refactored code with improved quality
```

### Using use_subagent Tool

```json
{
  "command": "InvokeSubagents",
  "content": {
    "subagents": [
      {
        "agent_name": "test-architect",
        "query": "Design test cases for [feature description]",
        "relevant_context": "[requirements and constraints]"
      }
    ]
  }
}
```

### Context Passing

Each subagent runs in isolated context, so the main agent must explicitly pass information:

```json
{
  "command": "InvokeSubagents",
  "content": {
    "subagents": [
      {
        "agent_name": "implementer",
        "query": "Implement [feature] following these test cases",
        "relevant_context": "[test specifications from test-architect]"
      }
    ]
  }
}
```

## Best Practices

1. **Always Start with Test Architect**: Design tests before implementation
2. **Pass Complete Context**: Subagents need full context to work effectively
3. **Wait for Completion**: Don't proceed to next stage until current stage completes
4. **Handle Rejections**: If code reviewer rejects, loop back to implementer with feedback
5. **Verify Tests**: Ensure all tests pass at each stage

## Differences from Claude Code

**Claude Code**: Subagents automatically chain together based on `.claude/agents/` definitions

**Kiro CLI**: Main agent explicitly orchestrates each stage using `use_subagent` tool

## Tips

- Read the role definition files to understand each agent's capabilities
- Provide clear, specific queries to subagents
- Include all necessary context when delegating
- Review subagent outputs before proceeding to next stage
- Use parallel subagents only for independent tasks

## Example Session

```
User: "Add a new GraphQL mutation to update learning spec status"

Main Agent:
1. Delegates to test-architect
   → Receives test specifications

2. Delegates to implementer with test specs
   → Receives implementation

3. Delegates to code-reviewer with implementation
   → Receives APPROVED

4. Delegates to refactorer with approved code
   → Receives refactored implementation

5. Presents final result to user
```
