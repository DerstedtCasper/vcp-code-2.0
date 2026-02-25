# @novacode/nova-gateway

Unified Nova Gateway package for OpenCode providing authentication, AI provider integration, and API access.

## Features

- **Authentication**: Device authorization flow for Nova Gateway
- **AI Provider**: OpenRouter-based provider with Nova Gateway integration
- **API Integration**: Profile, balance, and model management
- **TUI Helpers**: Utilities for terminal UI components

## Installation

```bash
bun add @novacode/nova-gateway
```

## Usage

### Plugin Registration

```typescript
import { KiloAuthPlugin } from "@novacode/nova-gateway"

// Register with OpenCode
const plugins = [KiloAuthPlugin]
```

### Provider Usage

```typescript
import { createKilo } from "@novacode/nova-gateway"

const provider = createKilo({
  novacodeToken: process.env.KILOCODE_API_KEY,
  novacodeOrganizationId: "org-123",
})

const model = provider.languageModel("anthropic/claude-sonnet-4")
```

### API Access

```typescript
import { fetchProfile, fetchBalance } from "@novacode/nova-gateway"

const profile = await fetchProfile(token)
const balance = await fetchBalance(token)
```

## License

MIT
