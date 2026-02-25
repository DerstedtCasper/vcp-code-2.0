Use VCP Code directly from your terminal for maximum flexibility.

### Install via npm

```bash
npm install -g @VCPcode/cli
```

### Older CPUs (No AVX Support)

If you're running on an older CPU without AVX support (e.g., Intel Xeon Nehalem, AMD Bulldozer, or older), the CLI may crash with "Illegal instruction". In that case, download the **baseline** variant from GitHub releases:

1. Go to [VCP Releases](https://github.com/DerstedtCasper/vcp-code-2.0/releases)
2. Download the `-baseline` variant for your platform:
   - Linux x64: `VCP-linux-x64-baseline.tar.gz`
   - macOS x64: `VCP-darwin-x64-baseline.zip`
   - Windows x64: `VCP-windows-x64-baseline.zip`
3. Extract and run the `VCP` binary directly

### Verify Installation

```bash
VCP --version
```


