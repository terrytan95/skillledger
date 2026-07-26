import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import path from 'node:path'
import type { PathFingerprint } from '../src/types'

export async function fingerprint(entryPath: string): Promise<PathFingerprint> {
  try {
    const stats = await lstat(entryPath)
    if (stats.isSymbolicLink()) {
      const target = await readlink(entryPath)
      return {
        kind: 'symlink',
        sha256: null,
        linkTarget: path.resolve(path.dirname(entryPath), target),
      }
    }
    if (stats.isFile()) {
      return {
        kind: 'file',
        sha256: createHash('sha256').update(await readFile(entryPath)).digest('hex'),
        linkTarget: null,
      }
    }
    if (!stats.isDirectory()) return { kind: 'other', sha256: null, linkTarget: null }

    const hash = createHash('sha256')
    const visit = async (directory: string, relative = ''): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries.sort((left, right) => (
        Buffer.compare(Buffer.from(left.name), Buffer.from(right.name))
      ))) {
        const childRelative = path.posix.join(relative, entry.name)
        const childPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          hash.update(`directory\0${childRelative}\0`)
          await visit(childPath, childRelative)
        } else if (entry.isFile()) {
          hash.update(`file\0${childRelative}\0`)
          hash.update(await readFile(childPath))
          hash.update('\0')
        } else if (entry.isSymbolicLink()) {
          hash.update(`symlink\0${childRelative}\0${await readlink(childPath)}\0`)
        } else {
          hash.update(`other\0${childRelative}\0`)
        }
      }
    }
    await visit(entryPath)
    return { kind: 'directory', sha256: hash.digest('hex'), linkTarget: null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing', sha256: null, linkTarget: null }
    }
    throw error
  }
}

export function fingerprintsMatch(left: PathFingerprint, right: PathFingerprint): boolean {
  return left.kind === right.kind
    && left.sha256 === right.sha256
    && left.linkTarget === right.linkTarget
}
