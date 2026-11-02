---
name: OpenAPI codegen availability
description: Current package-firewall behavior affecting the workspace's Orval-based API client generation.
---

When API client code generation fails because Orval is missing, an offline install may also fail because a transitive archive is absent from the local package store. The normal package fetch for Orval can return 403 from Replit's package firewall. Do not switch registries or bypass the firewall. Keep the OpenAPI definition authoritative and use an existing generated hook or a local typed request temporarily; retry code generation when the package is available.

**Why:** Code generation was blocked by the environment's package security controls, not by the API definition.

**How to apply:** Before hand-maintaining generated files, confirm the approved package source is available. If it is not, keep the workaround isolated and regenerate the client when access is restored.
