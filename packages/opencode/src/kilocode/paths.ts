import * as path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

export namespace KilocodePaths {
  const VSCODE_EXTENSION_IDS = ["vcpcode.vcp-code", "kilocode.kilo-code"] as const

  function dedupePaths(paths: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (const value of paths) {
      const key = process.platform === "win32" ? value.toLowerCase() : value
      if (seen.has(key)) continue
      seen.add(key)
      result.push(value)
    }

    return result
  }

  function vscodeGlobalStorageRoot(): string {
    const home = os.homedir()
    switch (process.platform) {
      case "darwin":
        return path.join(home, "Library", "Application Support", "Code", "User", "globalStorage")
      case "win32":
        return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User", "globalStorage")
      default:
        return path.join(home, ".config", "Code", "User", "globalStorage")
    }
  }

  /**
   * Get all platform-specific VSCode global storage paths for supported extension IDs.
   * Ordered by preference: vcpcode.vcp-code, then kilocode.kilo-code.
   */
  export function vscodeGlobalStorages(): string[] {
    const root = vscodeGlobalStorageRoot()
    return dedupePaths(VSCODE_EXTENSION_IDS.map((id) => path.join(root, id)))
  }

  /**
   * Get the preferred VSCode global storage path for compatibility callers.
   * For full compatibility scanning, use `vscodeGlobalStorages()`.
   */
  export function vscodeGlobalStorage(): string {
    return vscodeGlobalStorages()[0]
  }

  /** Global Kilocode directory in user home: ~/.kilocode */
  export function globalDir(): string {
    return path.join(os.homedir(), ".kilocode")
  }

  /**
   * Discover Kilocode directories containing skills.
   * Returns parent directories (.kilocode/) for glob pattern "skills/[*]/SKILL.md".
   *
   * - Walks up from projectDir to worktreeRoot for .kilocode/
   * - Includes global ~/.kilocode/
   * - Includes VSCode extension global storage
   *
   * Does NOT copy/migrate skills - just provides paths for discovery.
   * Skills remain in their original locations and can be managed independently
   * by the Kilo VSCode extension.
   */
  export async function skillDirectories(opts: {
    projectDir: string
    worktreeRoot: string
    skipGlobalPaths?: boolean
  }): Promise<string[]> {
    const directories: string[] = []

    // 1. Walk up from project dir to worktree root for .kilocode/
    // Returns .kilocode/ directories (not .kilocode/skills/) because
    // the glob pattern "skills/[*]/SKILL.md" is applied from the parent
    const projectDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".kilocode"],
        start: opts.projectDir,
        stop: opts.worktreeRoot,
      }),
    )
    for (const dir of projectDirs) {
      const skillsDir = path.join(dir, "skills")
      if (await Filesystem.isDir(skillsDir)) {
        directories.push(dir) // Return parent (.kilocode/), not skills/
      }
    }

    if (!opts.skipGlobalPaths) {
      // 2. Global ~/.kilocode/
      const global = globalDir()
      const globalSkills = path.join(global, "skills")
      if (await Filesystem.isDir(globalSkills)) {
        directories.push(global) // Return parent, not skills/
      }

      // 3. VSCode extension global storage (marketplace-installed skills)
      for (const vscode of vscodeGlobalStorages()) {
        const vscodeSkills = path.join(vscode, "skills")
        if (await Filesystem.isDir(vscodeSkills)) {
          directories.push(vscode) // Return parent, not skills/
        }
      }
    }

    return dedupePaths(directories)
  }
}
