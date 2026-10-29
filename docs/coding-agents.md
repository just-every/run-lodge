# Coding agents

Let your own coding agent prepare work that a named person approves.

A coding agent signs in to Lodge as its own member, acting for one person. It
reads exactly what that person can see and can only propose changes. Lodge runs
no model and ranks no one.

## Add an agent

Only the owner adds an agent. Give the agent its own email address: a person
who is already a member never becomes an agent. The agent's view comes from the
person it acts for; it holds no roles of its own.

## Proposals

An agent proposes through Lodge's API: it names the records it read, the
changes it wants and the person who approves them. Agents can prepare a
vacancy, draft feedback from an interviewer's own notes, prepare coordination
and find past candidates who agreed to be contacted.

Open proposals wait under **Proposals**. Choose **Approve and apply** or
**Reject**, give a reason and press **Record decision**. A proposal applies only
if every record it read is unchanged; missing information is flagged, never
invented.

The API is described in the repository's `API.md`.

## Company agent door

Company agents use the shared `/mcp` door and the native binding described in [Agent access](agent-access.md). Native source-bound proposal and debrief authority remains in effect.
