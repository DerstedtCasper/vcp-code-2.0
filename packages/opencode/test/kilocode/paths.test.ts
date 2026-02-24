import { test, expect, describe } from "bun:test"
import { KilocodePaths } from "../../src/kilocode/paths"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

describe("KilocodePaths", () => {
  describe("vscodeGlobalStorages", () => {
    test("returns both vcpcode and kilocode storage paths in priority order", () => {
      const paths = KilocodePaths.vscodeGlobalStorages()

      expect(paths.length).toBeGreaterThanOrEqual(2)
      expect(paths[0]).toEndWith(path.join("globalStorage", "vcpcode.vcp-code"))
      expect(paths.some((p) => p.endsWith(path.join("globalStorage", "kilocode.kilo-code")))).toBe(true)
    })
  })

  describe("skillDirectories", () => {
    test("discovers skills from .kilocode/skills/", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const skillDir = path.join(dir, ".kilocode", "skills", "test-skill")
          await fs.mkdir(skillDir, { recursive: true })
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: test-skill
description: A test skill
---
# Test instructions`,
          )
        },
      })

      const result = await KilocodePaths.skillDirectories({
        projectDir: tmp.path,
        worktreeRoot: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result).toHaveLength(1)
      expect(result[0]).toEndWith(".kilocode")
    })

    test("returns empty array when no .kilocode/skills/ exists", async () => {
      await using tmp = await tmpdir()

      const result = await KilocodePaths.skillDirectories({
        projectDir: tmp.path,
        worktreeRoot: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result).toHaveLength(0)
    })

    test("discovers skills from nested .kilocode directories", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Root level skill
          const rootSkillDir = path.join(dir, ".kilocode", "skills", "root-skill")
          await fs.mkdir(rootSkillDir, { recursive: true })
          await Bun.write(
            path.join(rootSkillDir, "SKILL.md"),
            `---
name: root-skill
description: Root level skill
---
# Root instructions`,
          )

          // Nested project skill
          const nestedDir = path.join(dir, "packages", "nested")
          const nestedSkillDir = path.join(nestedDir, ".kilocode", "skills", "nested-skill")
          await fs.mkdir(nestedSkillDir, { recursive: true })
          await Bun.write(
            path.join(nestedSkillDir, "SKILL.md"),
            `---
name: nested-skill
description: Nested skill
---
# Nested instructions`,
          )
        },
      })

      // Run from nested directory, should find both
      const nestedPath = path.join(tmp.path, "packages", "nested")
      const result = await KilocodePaths.skillDirectories({
        projectDir: nestedPath,
        worktreeRoot: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result).toHaveLength(2)
      const nestedSegment = path.join("packages", "nested")
      expect(result.some((d) => d.includes(nestedSegment))).toBe(true)
      expect(result.some((d) => !d.includes(nestedSegment))).toBe(true)
    })

    test("handles .kilocode directory without skills subdirectory", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create .kilocode but not skills/
          await fs.mkdir(path.join(dir, ".kilocode"), { recursive: true })
          await Bun.write(path.join(dir, ".kilocode", "config.json"), "{}")
        },
      })

      const result = await KilocodePaths.skillDirectories({
        projectDir: tmp.path,
        worktreeRoot: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result).toHaveLength(0)
    })

    test("handles symlinked skill directories", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create actual skill in a different location
          const actualDir = path.join(dir, "shared-skills", "my-skill")
          await fs.mkdir(actualDir, { recursive: true })
          await Bun.write(
            path.join(actualDir, "SKILL.md"),
            `---
name: my-skill
description: Symlinked skill
---
# Instructions`,
          )

          // Create .kilocode/skills/ and symlink the skill
          const skillsDir = path.join(dir, ".kilocode", "skills")
          await fs.mkdir(skillsDir, { recursive: true })
          await fs.symlink(actualDir, path.join(skillsDir, "my-skill"))
        },
      })

      const result = await KilocodePaths.skillDirectories({
        projectDir: tmp.path,
        worktreeRoot: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result).toHaveLength(1)
      expect(result[0]).toEndWith(".kilocode")
    })

    test("discovers multiple skills in same directory", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const skillsDir = path.join(dir, ".kilocode", "skills")

          // First skill
          const skill1 = path.join(skillsDir, "skill-one")
          await fs.mkdir(skill1, { recursive: true })
          await Bun.write(
            path.join(skill1, "SKILL.md"),
            `---
name: skill-one
description: First skill
---
# First`,
          )

          // Second skill
          const skill2 = path.join(skillsDir, "skill-two")
          await fs.mkdir(skill2, { recursive: true })
          await Bun.write(
            path.join(skill2, "SKILL.md"),
            `---
name: skill-two
description: Second skill
---
# Second`,
          )
        },
      })

      const result = await KilocodePaths.skillDirectories({
        projectDir: tmp.path,
        worktreeRoot: tmp.path,
        skipGlobalPaths: true,
      })

      // Should return the .kilocode directory (not skills/ subdirectory)
      expect(result).toHaveLength(1)
      expect(result[0]).toEndWith(".kilocode")
    })
  })
})
