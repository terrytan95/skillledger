import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Command,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react'
import type {
  ExternalSkillPreview,
  InventorySnapshot,
  ReconciliationPreview,
  SkillContentEntry,
  SkillContentSnapshot,
  SkillHealth,
  SkillRecord,
  SourceUpdateEntry,
  SourceUpdateSnapshot,
} from './types'
import { demoSkillContent } from './demo'
import { localizeHealthReason, type Language, type Messages } from './i18n'
import { MarkdownDocument, markdownHeadings } from './markdown'

type HealthFilter = SkillHealth | 'all' | 'needs-review'
type ContentMode = 'rendered' | 'source'
type WorkbenchTab = 'overview' | 'content' | 'files'
type UpdatePhase = 'idle' | 'checking' | 'success' | 'error'

const ledgerSplitKey = 'skillledger:ledger-split'
const fileTreeWidthKey = 'skillledger:file-tree-width'
const defaultLedgerSplit = 0.35
const defaultFileTreeWidth = 176
const minimumFileTreeWidth = 140
const maximumFileTreeWidth = 480

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function clampSplitRatio(value: number, minimum = 0.18, maximum = 0.65): number {
  return clamp(value, minimum, maximum)
}

function readLedgerSplitRatio(): number {
  const stored = Number.parseFloat(localStorage.getItem(ledgerSplitKey) ?? '')
  return Number.isFinite(stored) ? clampSplitRatio(stored) : defaultLedgerSplit
}

function readFileTreeWidth(): number {
  const stored = Number.parseFloat(localStorage.getItem(fileTreeWidthKey) ?? '')
  return Number.isFinite(stored)
    ? clamp(stored, minimumFileTreeWidth, maximumFileTreeWidth)
    : defaultFileTreeWidth
}

export function resolveInventorySelection(
  snapshot: InventorySnapshot,
  currentId: string,
  preferredId?: string,
): string {
  if (preferredId && snapshot.skills.some((skill) => skill.id === preferredId)) return preferredId
  return snapshot.skills.some((skill) => skill.id === currentId)
    ? currentId
    : snapshot.skills[0]?.id ?? ''
}

type InventoryWorkspaceProps = {
  active: boolean
  snapshot: InventorySnapshot
  onSnapshot: (snapshot: InventorySnapshot) => void
  copy: Messages
  language: Language
  children: ReactNode
}

export type InventoryWorkspaceHandle = {
  closeReader: () => void
}

type InventoryWorkspaceContext = {
  snapshot: InventorySnapshot
  copy: Messages
  language: Language
  query: string
  setQuery: (query: string) => void
  health: HealthFilter
  setHealth: (health: HealthFilter) => void
  skills: SkillRecord[]
  selected: SkillRecord | undefined
  setSelectedId: (id: string) => void
  loading: boolean
  scanError: string
  liveMode: boolean
  readerOpen: boolean
  setReaderOpen: (open: boolean) => void
  skillContent: SkillContentSnapshot | null
  skillContentLoading: boolean
  skillContentError: string
  contentMode: ContentMode
  setContentMode: (mode: ContentMode) => void
  selectFile: (relativePath: string) => void
  revealSelectedSkill: () => Promise<void>
  deletingSkillId: string | null
  deleteSelectedSkill: () => Promise<void>
  sourceUpdatesBySkill: Map<string, SourceUpdateEntry>
  sourceCheckPhase: UpdatePhase
  exportPhase: 'idle' | 'working'
  inventoryMessage: string
  searchInput: React.RefObject<HTMLInputElement | null>
  refresh: () => Promise<void>
  checkSourceUpdates: () => Promise<void>
  exportInventory: () => Promise<void>
  externalSkillOpen: boolean
  setExternalSkillOpen: (open: boolean) => void
  planOpen: boolean
  setPlanOpen: (open: boolean) => void
  acceptSnapshot: (snapshot: InventorySnapshot, preferredId?: string) => void
  setSourceUpdates: (updates: SourceUpdateSnapshot | null) => void
  setInventoryMessage: (message: string) => void
}

const InventoryContext = createContext<InventoryWorkspaceContext | null>(null)

function useInventoryWorkspace(): InventoryWorkspaceContext {
  const workspace = useContext(InventoryContext)
  if (!workspace) throw new Error('Inventory workspace region must be inside InventoryWorkspace')
  return workspace
}

export const InventoryWorkspace = forwardRef<InventoryWorkspaceHandle, InventoryWorkspaceProps>(
  function InventoryWorkspace(
    { active, snapshot, onSnapshot, copy, language, children },
    ref,
  ) {
    const [query, setQuery] = useState('')
    const [health, setHealth] = useState<HealthFilter>('all')
    const [selectedId, setSelectedId] = useState(snapshot.skills[0]?.id ?? '')
    const [loading, setLoading] = useState(false)
    const [scanError, setScanError] = useState('')
    const [planOpen, setPlanOpen] = useState(false)
    const [externalSkillOpen, setExternalSkillOpen] = useState(false)
    const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null)
    const [liveMode, setLiveMode] = useState(false)
    const [readerOpen, setReaderOpen] = useState(false)
    const [skillContent, setSkillContent] = useState<SkillContentSnapshot | null>(null)
    const [skillContentLoading, setSkillContentLoading] = useState(false)
    const [skillContentError, setSkillContentError] = useState('')
    const [contentMode, setContentMode] = useState<ContentMode>('rendered')
    const [sourceUpdates, setSourceUpdates] = useState<SourceUpdateSnapshot | null>(null)
    const [sourceCheckPhase, setSourceCheckPhase] = useState<UpdatePhase>('idle')
    const [exportPhase, setExportPhase] = useState<'idle' | 'working'>('idle')
    const [inventoryMessage, setInventoryMessage] = useState('')
    const contentRequest = useRef(0)
    const searchInput = useRef<HTMLInputElement>(null)

    const acceptSnapshot = useCallback((next: InventorySnapshot, preferredId?: string) => {
      onSnapshot(next)
      setSelectedId((current) => resolveInventorySelection(next, current, preferredId))
    }, [onSnapshot])

    const refresh = useCallback(async () => {
      if (!window.skillLedger) return
      setLoading(true)
      setScanError('')
      try {
        const next = await window.skillLedger.scan()
        acceptSnapshot(next)
        setSourceUpdates(null)
        setSourceCheckPhase('idle')
        setInventoryMessage('')
        setLiveMode(true)
      } catch (error) {
        setScanError((error as Error).message)
      } finally {
        setLoading(false)
      }
    }, [acceptSnapshot])

    const loadSkillContent = useCallback(async (skill: SkillRecord, relativePath = 'SKILL.md') => {
      const request = ++contentRequest.current
      setSkillContentLoading(true)
      setSkillContentError('')
      try {
        const next = window.skillLedger
          ? await window.skillLedger.readSkillContent(skill.id, relativePath)
          : demoSkillContent(skill, relativePath)
        if (request === contentRequest.current) setSkillContent(next)
      } catch (error) {
        if (request === contentRequest.current) {
          setSkillContent(null)
          setSkillContentError((error as Error).message)
        }
      } finally {
        if (request === contentRequest.current) setSkillContentLoading(false)
      }
    }, [])

    const checkSourceUpdates = useCallback(async () => {
      if (!window.skillLedger) return
      setSourceCheckPhase('checking')
      setInventoryMessage('')
      try {
        const result = await window.skillLedger.checkSourceUpdates()
        setSourceUpdates(result)
        setSourceCheckPhase('success')
        setInventoryMessage(result.summary.failed
          ? `${result.summary.failed} ${copy.sourceChecksFailed}`
          : result.summary.available
            ? `${result.summary.available} ${copy.sourceUpdatesFound}`
            : copy.allSourcesCurrent)
      } catch (error) {
        setSourceCheckPhase('error')
        setInventoryMessage(`${copy.sourceCheckFailed}: ${(error as Error).message}`)
      }
    }, [copy])

    const exportInventory = useCallback(async () => {
      if (!window.skillLedger) return
      setExportPhase('working')
      setInventoryMessage('')
      try {
        const result = await window.skillLedger.exportInventory()
        if (result.status === 'exported') {
          setInventoryMessage(`${copy.inventoryExported}: ${result.fileName}`)
        }
      } catch (error) {
        setInventoryMessage(`${copy.exportFailed}: ${(error as Error).message}`)
      } finally {
        setExportPhase('idle')
      }
    }, [copy])

    const skills = useMemo(() => {
      const normalized = query.trim().toLowerCase()
      return snapshot.skills.filter((skill) => {
        const matchesHealth = health === 'all'
          || (health === 'needs-review' ? skill.health !== 'healthy' : skill.health === health)
        const matchesQuery = !normalized || `${skill.name} ${skill.description} ${skill.source ?? ''}`.toLowerCase().includes(normalized)
        return matchesHealth && matchesQuery
      }).sort((a, b) => {
        const order: Record<SkillHealth, number> = { broken: 0, missing: 1, review: 2, healthy: 3 }
        return order[a.health] - order[b.health] || a.name.localeCompare(b.name)
      })
    }, [health, query, snapshot.skills])

    const selected = skills.find((skill) => skill.id === selectedId) ?? skills[0]
    const sourceUpdatesBySkill = useMemo(
      () => new Map(sourceUpdates?.entries.map((entry) => [entry.skillId, entry]) ?? []),
      [sourceUpdates],
    )

    useEffect(() => { void refresh() }, [refresh])
    useEffect(() => {
      setSelectedId((current) => resolveInventorySelection(snapshot, current))
    }, [snapshot])
    useEffect(() => {
      if (!selected) {
        contentRequest.current += 1
        setSkillContent(null)
        setSkillContentLoading(false)
        setSkillContentError('')
        setReaderOpen(false)
        return
      }
      setContentMode('rendered')
      void loadSkillContent(selected)
    }, [loadSkillContent, selected?.id, snapshot.scannedAt])
    useEffect(() => {
      if (!active) setReaderOpen(false)
    }, [active])
    useEffect(() => {
      const focusSearch = (event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
        setReaderOpen(false)
        requestAnimationFrame(() => {
          searchInput.current?.focus()
          searchInput.current?.select()
        })
      }
      window.addEventListener('keydown', focusSearch)
      return () => window.removeEventListener('keydown', focusSearch)
    }, [])
    useEffect(() => {
      if (!readerOpen) return
      const closeReader = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setReaderOpen(false)
      }
      window.addEventListener('keydown', closeReader)
      return () => window.removeEventListener('keydown', closeReader)
    }, [readerOpen])

    useImperativeHandle(ref, () => ({
      closeReader: () => setReaderOpen(false),
    }), [])

    const selectFile = (relativePath: string) => {
      if (selected) void loadSkillContent(selected, relativePath)
    }

    const revealSelectedSkill = async () => {
      if (!selected || !window.skillLedger) return
      try {
        await window.skillLedger.revealSkill(selected.id)
      } catch (error) {
        setSkillContentError((error as Error).message)
      }
    }

    const deleteSelectedSkill = async () => {
      if (
        !selected
        || !window.skillLedger
        || !window.confirm(copy.deleteSkillConfirmation.replace('{skill}', selected.name))
      ) return
      setDeletingSkillId(selected.id)
      setInventoryMessage('')
      try {
        const result = await window.skillLedger.deleteSkill(selected.id)
        if (result.status === 'applied' || result.status === 'already-applied') {
          acceptSnapshot(result.snapshot)
          setInventoryMessage(`${copy.deletedSkill}: ${selected.name}`)
        } else {
          if (result.status === 'rolled-back') acceptSnapshot(result.snapshot)
          setInventoryMessage(`${copy.deleteFailed}: ${result.error.message}`)
        }
      } catch (error) {
        setInventoryMessage(`${copy.deleteFailed}: ${(error as Error).message}`)
      } finally {
        setDeletingSkillId(null)
      }
    }

    return (
      <InventoryContext.Provider value={{
        snapshot,
        copy,
        language,
        query,
        setQuery,
        health,
        setHealth,
        skills,
        selected,
        setSelectedId,
        loading,
        scanError,
        liveMode,
        readerOpen,
        setReaderOpen,
        skillContent,
        skillContentLoading,
        skillContentError,
        contentMode,
        setContentMode,
        selectFile,
        revealSelectedSkill,
        deletingSkillId,
        deleteSelectedSkill,
        sourceUpdatesBySkill,
        sourceCheckPhase,
        exportPhase,
        inventoryMessage,
        searchInput,
        refresh,
        checkSourceUpdates,
        exportInventory,
        externalSkillOpen,
        setExternalSkillOpen,
        planOpen,
        setPlanOpen,
        acceptSnapshot,
        setSourceUpdates,
        setInventoryMessage,
      }}>
        {children}
      </InventoryContext.Provider>
    )
  },
)

export function InventoryHeaderActions() {
  const workspace = useInventoryWorkspace()
  const {
    copy,
    liveMode,
    readerOpen,
    inventoryMessage,
    sourceCheckPhase,
    exportPhase,
    loading,
  } = workspace

  return (
    <div className="header-actions">
      <span className={`mode-badge ${liveMode ? 'live' : ''}`}>{liveMode ? copy.liveScan : copy.demoData}</span>
      <span className="header-status" aria-live="polite">{inventoryMessage}</span>
      <details
        className="inventory-actions"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute('open')
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.removeAttribute('open')
            event.currentTarget.querySelector('summary')?.focus()
          }
        }}
      >
        <summary aria-label={copy.inventoryActions}>
          <Wrench size={15} aria-hidden="true" />
          <strong>{copy.inventoryActions}</strong>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div
          className="inventory-actions-menu"
          aria-label={copy.inventoryActions}
          onMouseDown={(event) => {
            if (!(event.target as Element).closest('button')) event.preventDefault()
          }}
        >
          {!readerOpen && (
            <>
              <p>{copy.inventoryActionSkills}</p>
              <button
                type="button"
                disabled={!window.skillLedger || !liveMode}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  workspace.setExternalSkillOpen(true)
                }}
              >
                <Plus size={15} aria-hidden="true" />{copy.addSkill}
              </button>
              <div className="inventory-action-divider" aria-hidden="true" />
            </>
          )}
          <p>{copy.inventory}</p>
          {!readerOpen && <button
            type="button"
            disabled={!window.skillLedger || sourceCheckPhase === 'checking'}
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              void workspace.checkSourceUpdates()
            }}
          >
            <GitBranch size={15} aria-hidden="true" />{sourceCheckPhase === 'checking' ? copy.checkingSources : copy.checkSourceUpdates}
          </button>}
          {!readerOpen && <button
            type="button"
            disabled={!window.skillLedger || exportPhase === 'working'}
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              void workspace.exportInventory()
            }}
          >
            <Upload size={15} aria-hidden="true" />{exportPhase === 'working' ? copy.exporting : copy.exportInventory}
          </button>}
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              workspace.setPlanOpen(true)
            }}
          >
            <Wrench size={15} aria-hidden="true" />{copy.previewPlan}
          </button>
          <div className="inventory-action-divider" aria-hidden="true" />
          <button
            type="button"
            className="inventory-scan-action"
            disabled={!window.skillLedger || loading}
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              void workspace.refresh()
            }}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />{loading ? copy.scanning : copy.scanNow}
          </button>
        </div>
      </details>
    </div>
  )
}

export function InventoryWorkspaceView() {
  const workspace = useInventoryWorkspace()
  const { copy, readerOpen, selected } = workspace

  return (
    <>
      {!readerOpen && (
        <div className="control-bar">
          <div className="control-context">
            <Boxes size={16} aria-hidden="true" />
            <span><strong>{copy.globalInventory}</strong><small>{copy.ledgerView}</small></span>
          </div>
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">{copy.searchSkills}</span>
            <input
              ref={workspace.searchInput}
              value={workspace.query}
              onChange={(event) => workspace.setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
            />
            <kbd><Command size={11} />K</kbd>
          </label>
          <label className="health-filter">
            <span className="sr-only">{copy.filterByHealth}</span>
            <select value={workspace.health} onChange={(event) => workspace.setHealth(event.target.value as HealthFilter)}>
              <option value="all">{copy.allStates}</option>
              <option value="healthy">{copy.healthy}</option>
              <option value="needs-review">{copy.needsReview}</option>
              <option value="review">{copy.review}</option>
              <option value="missing">{copy.missing}</option>
              <option value="broken">{copy.broken}</option>
            </select>
          </label>
        </div>
      )}
      <main>
        {readerOpen && selected ? (
          <ReaderView
            skill={selected}
            content={workspace.skillContent}
            contentLoading={workspace.skillContentLoading}
            contentError={workspace.skillContentError}
            contentMode={workspace.contentMode}
            onContentMode={workspace.setContentMode}
            onSelectFile={workspace.selectFile}
            onBack={() => workspace.setReaderOpen(false)}
            onReveal={() => void workspace.revealSelectedSkill()}
            canReveal={Boolean(window.skillLedger)}
            copy={copy}
          />
        ) : (
          <LedgerView
            skills={workspace.skills}
            selected={selected}
            onSelect={workspace.setSelectedId}
            scanError={workspace.scanError}
            sourceUpdates={workspace.sourceUpdatesBySkill}
            health={workspace.health}
            onHealth={workspace.setHealth}
            copy={copy}
            language={workspace.language}
            content={workspace.skillContent}
            contentLoading={workspace.skillContentLoading}
            contentError={workspace.skillContentError}
            contentMode={workspace.contentMode}
            onContentMode={workspace.setContentMode}
            onSelectFile={workspace.selectFile}
            onOpenReader={() => workspace.setReaderOpen(true)}
            canManage={workspace.liveMode && Boolean(window.skillLedger)}
            deleting={workspace.deletingSkillId === selected?.id}
            onDelete={() => void workspace.deleteSelectedSkill()}
          />
        )}
      </main>
      {workspace.externalSkillOpen && (
        <ExternalSkillPanel
          copy={copy}
          onClose={() => workspace.setExternalSkillOpen(false)}
          onApplied={(next, skillId, action) => {
            workspace.acceptSnapshot(next, skillId)
            workspace.setSourceUpdates(null)
            workspace.setInventoryMessage(`${action === 'update' ? copy.updatedSkill : copy.installedSkill}: ${skillId}`)
            workspace.setExternalSkillOpen(false)
          }}
        />
      )}
      {workspace.planOpen && (
        <PlanPanel
          copy={copy}
          liveMode={workspace.liveMode}
          onClose={() => workspace.setPlanOpen(false)}
          skillId={selected?.id}
          onSnapshot={workspace.acceptSnapshot}
        />
      )}
    </>
  )
}

function StatusChip({ health, copy }: { health: SkillHealth; copy: Messages }) {
  const Icon = health === 'healthy' ? CheckCircle2 : AlertTriangle
  return (
    <span className={`status-chip status-${health}`}>
      <Icon size={13} aria-hidden="true" />
      {copy[health]}
    </span>
  )
}

function ResizableSeparator({
  className,
  label,
  value,
  minimum,
  maximum,
  onResize,
  onStep,
}: {
  className: string
  label: string
  value: number
  minimum: number
  maximum: number
  onResize: (clientX: number) => void
  onStep: (direction: -1 | 1) => void
}) {
  return (
    <div
      className={`panel-separator ${className}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        onResize(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onResize(event.clientX)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onStep(event.key === 'ArrowRight' ? 1 : -1)
      }}
    />
  )
}

function AgentPills({ skill, copy, limit = 5 }: { skill: SkillRecord; copy: Messages; limit?: number }) {
  return (
    <div className="agent-pills" aria-label={`${skill.agents.length} ${copy.agentDestinations}`}>
      {skill.agents.slice(0, limit).map((agent) => (
        <span className="agent-pill" key={`${skill.id}-${agent.id}`}>{agent.label}</span>
      ))}
      {skill.agents.length > limit && <span className="agent-pill agent-pill-more">+{skill.agents.length - limit}</span>}
    </div>
  )
}

function SkillOverview({
  skill,
  copy,
  language,
  sourceUpdate,
}: {
  skill: SkillRecord
  copy: Messages
  language: Language
  sourceUpdate?: SourceUpdateEntry
}) {
  const sourceState = {
    local: copy.sourceLocal,
    pinned: copy.sourcePinned,
    drifted: copy.sourceDrifted,
    missing: copy.sourceMissing,
  }[skill.sourceState]
  return (
    <section className="skill-overview" aria-label={copy.selectedSkillDetails}>
      <p className="inspector-description">{skill.description}</p>
      <dl className="fact-list">
        <div><dt>{copy.source}</dt><dd>{skill.source ?? copy.localOnly}</dd></div>
        <div><dt>{copy.sourceState}</dt><dd>{sourceState}</dd></div>
        {skill.sourcePin && <div><dt>{copy.pinnedCommit}</dt><dd>{skill.sourcePin.revision.slice(0, 12)}</dd></div>}
        {sourceUpdate && (
          <div>
            <dt>{copy.latestCommit}</dt>
            <dd>
              {sourceUpdate.error
                ? copy.sourceCheckFailed
                : `${sourceUpdate.latestRevision?.slice(0, 12)} · ${sourceUpdate.available ? copy.sourceUpdateAvailable : copy.sourceCurrent}`}
            </dd>
          </div>
        )}
        <div><dt>{copy.agentReach}</dt><dd>{skill.agents.length} {copy.destinations}</dd></div>
        <div><dt>{copy.installShape}</dt><dd>{skill.agents.some((agent) => agent.kind === 'copy') ? copy.mixed : copy.canonicalLinks}</dd></div>
        <div><dt>{copy.lastTracked}</dt><dd>{skill.updatedAt ? new Date(skill.updatedAt).toLocaleDateString(language) : copy.notTracked}</dd></div>
      </dl>
      <div className="health-note">
        <ShieldCheck size={16} aria-hidden="true" />
        <p>{localizeHealthReason(skill.healthReason, language)}</p>
      </div>
      <div className="inspector-section">
        <span className="section-label">{copy.availableIn}</span>
        <AgentPills skill={skill} copy={copy} limit={8} />
      </div>
      <div className="path-block">
        <span className="section-label">{copy.canonicalPath}</span>
        <code>{skill.canonicalPath}</code>
      </div>
    </section>
  )
}

function SkillFileTree({
  entries,
  selectedPath,
  onSelect,
  copy,
}: {
  entries: SkillContentEntry[]
  selectedPath?: string
  onSelect: (path: string) => void
  copy: Messages
}) {
  return (
    <nav className="skill-file-tree" aria-label={copy.skillFiles}>
      <p className="section-label">{copy.files}</p>
      {entries.map((entry) => {
        const label = entry.path.split('/').at(-1) ?? entry.path
        const style = { paddingLeft: `${12 + entry.depth * 14}px` }
        if (entry.kind === 'directory') {
          return (
            <div className="file-tree-row directory" key={entry.path} style={style}>
              <Folder size={14} aria-hidden="true" />
              <span>{label}/</span>
              <ChevronRight size={13} aria-hidden="true" />
            </div>
          )
        }
        return (
          <button
            className={`file-tree-row ${selectedPath === entry.path ? 'selected' : ''}`}
            key={entry.path}
            style={style}
            onClick={() => onSelect(entry.path)}
          >
            <FileText size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function ContentModeControl({
  mode,
  onMode,
  copy,
  sourceOnly,
}: {
  mode: ContentMode
  onMode: (mode: ContentMode) => void
  copy: Messages
  sourceOnly: boolean
}) {
  return (
    <div className="content-mode-control" role="group" aria-label={copy.content}>
      <button className={!sourceOnly && mode === 'rendered' ? 'active' : ''} disabled={sourceOnly} onClick={() => onMode('rendered')}>
        <Eye size={13} aria-hidden="true" />{copy.rendered}
      </button>
      <button className={sourceOnly || mode === 'source' ? 'active' : ''} onClick={() => onMode('source')}>
        <Code2 size={13} aria-hidden="true" />{copy.source}
      </button>
    </div>
  )
}

function SkillDocument({
  content,
  loading,
  error,
  mode,
  onMode,
  copy,
}: {
  content: SkillContentSnapshot | null
  loading: boolean
  error: string
  mode: ContentMode
  onMode: (mode: ContentMode) => void
  copy: Messages
}) {
  if (loading) return <div className="content-state">{copy.loadingSkillContent}</div>
  if (error) return <div className="content-state error">{copy.skillContentLoadFailed}: {error}</div>
  if (!content) return <div className="content-state">{copy.noReadableContent}</div>
  const sourceOnly = !content.selectedPath.toLowerCase().endsWith('.md')
  return (
    <section className="skill-document">
      <div className="document-tools">
        <span><FileText size={13} aria-hidden="true" />{content.selectedPath}</span>
        <ContentModeControl mode={mode} onMode={onMode} copy={copy} sourceOnly={sourceOnly} />
      </div>
      <div className="document-scroll">
        {sourceOnly || mode === 'source'
          ? <pre className="source-document"><code>{content.content}</code></pre>
          : <MarkdownDocument source={content.content} />}
      </div>
    </section>
  )
}

function LedgerView({
  skills,
  selected,
  onSelect,
  scanError,
  sourceUpdates,
  health,
  onHealth,
  copy,
  language,
  content,
  contentLoading,
  contentError,
  contentMode,
  onContentMode,
  onSelectFile,
  onOpenReader,
  canManage,
  deleting,
  onDelete,
}: {
  skills: SkillRecord[]
  selected: SkillRecord | undefined
  onSelect: (id: string) => void
  scanError: string
  sourceUpdates: Map<string, SourceUpdateEntry>
  health: HealthFilter
  onHealth: (health: HealthFilter) => void
  copy: Messages
  language: Language
  content: SkillContentSnapshot | null
  contentLoading: boolean
  contentError: string
  contentMode: ContentMode
  onContentMode: (mode: ContentMode) => void
  onSelectFile: (path: string) => void
  onOpenReader: () => void
  canManage: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const [tab, setTab] = useState<WorkbenchTab>('content')
  const [splitRatio, setSplitRatio] = useState(readLedgerSplitRatio)
  const [fileTreeWidth, setFileTreeWidth] = useState(readFileTreeWidth)
  const layout = useRef<HTMLDivElement>(null)
  const contentLayout = useRef<HTMLDivElement>(null)
  useEffect(() => { setTab('content') }, [selected?.id])
  useEffect(() => { localStorage.setItem(ledgerSplitKey, String(splitRatio)) }, [splitRatio])
  useEffect(() => { localStorage.setItem(fileTreeWidthKey, String(fileTreeWidth)) }, [fileTreeWidth])

  const splitGeometry = () => {
    const container = layout.current
    const rail = container?.querySelector<HTMLElement>('.library-rail')
    const separator = container?.querySelector<HTMLElement>('.ledger-separator')
    if (!container || !rail || !separator) return null

    const bounds = container.getBoundingClientRect()
    const minimum = Math.max(0.18, 200 / bounds.width)
    const maximum = Math.max(
      minimum,
      Math.min(0.65, (bounds.width - rail.offsetWidth - separator.offsetWidth - 360) / bounds.width),
    )
    return { bounds, minimum, maximum, railWidth: rail.offsetWidth, separatorWidth: separator.offsetWidth }
  }

  const resize = (clientX: number) => {
    const geometry = splitGeometry()
    if (!geometry) return
    const next = (
      clientX - geometry.bounds.left - geometry.railWidth - geometry.separatorWidth / 2
    ) / geometry.bounds.width
    setSplitRatio(clampSplitRatio(next, geometry.minimum, geometry.maximum))
  }

  const fileTreeGeometry = () => {
    const container = contentLayout.current
    const separator = container?.querySelector<HTMLElement>('.file-tree-separator')
    if (!container || !separator) return null

    const bounds = container.getBoundingClientRect()
    const maximum = Math.max(
      minimumFileTreeWidth,
      Math.min(maximumFileTreeWidth, bounds.width * 0.45),
    )
    return { bounds, maximum, separatorWidth: separator.offsetWidth }
  }

  const resizeFileTree = (clientX: number) => {
    const geometry = fileTreeGeometry()
    if (!geometry) return
    setFileTreeWidth(clamp(
      clientX - geometry.bounds.left - geometry.separatorWidth / 2,
      minimumFileTreeWidth,
      geometry.maximum,
    ))
  }

  return (
    <div
      className="ledger-layout"
      ref={layout}
      style={{ '--skill-list-width': `${splitRatio * 100}%` } as CSSProperties}
    >
      <aside className="library-rail">
        <nav aria-label={copy.inventoryGroups}>
          <button title={copy.allSkills} aria-label={copy.allSkills} className={`rail-item ${health === 'all' ? 'active' : ''}`} aria-current={health === 'all' ? 'page' : undefined} onClick={() => onHealth('all')}><Boxes size={17} /></button>
          <button title={copy.healthy} aria-label={copy.healthy} className={`rail-item ${health === 'healthy' ? 'active' : ''}`} aria-current={health === 'healthy' ? 'page' : undefined} onClick={() => onHealth('healthy')}><ShieldCheck size={17} /></button>
          <button title={copy.needsReview} aria-label={copy.needsReview} className={`rail-item ${health === 'needs-review' ? 'active' : ''}`} aria-current={health === 'needs-review' ? 'page' : undefined} onClick={() => onHealth('needs-review')}><AlertTriangle size={17} /></button>
        </nav>
      </aside>
      <section className="skill-list" aria-label={copy.skillInventory}>
        <div className="panel-title">
          <div><p className="eyebrow">{copy.inventory}</p><h1>{skills.length} {copy.skills}</h1></div>
          <span className="quiet-copy">{copy.sortedByHealth}</span>
        </div>
        {scanError && <div className="team-error" role="alert"><AlertTriangle size={16} /><p>{copy.scanFailed}: {scanError}</p></div>}
        <div className="skill-rows">
          {skills.map((skill) => (
            <button
              className={`skill-row ${selected?.id === skill.id ? 'selected' : ''}`}
              key={skill.id}
              onClick={() => onSelect(skill.id)}
            >
              <span className={`health-dot status-${skill.health}`} aria-hidden="true" />
              <span className="row-main"><strong>{skill.name}</strong><small>{skill.description}</small></span>
              <span className="row-source">{skill.sourceType ?? copy.localOnly}</span>
              <span className="row-count">{skill.agents.length}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
      <ResizableSeparator
        className="ledger-separator"
        label={copy.resizePanels}
        value={splitRatio * 100}
        minimum={18}
        maximum={65}
        onResize={resize}
        onStep={(direction) => {
          const geometry = splitGeometry()
          setSplitRatio((current) => clampSplitRatio(
            current + direction * 0.02,
            geometry?.minimum,
            geometry?.maximum,
          ))
        }}
      />
      <section className="workbench-detail" aria-label={copy.selectedSkillDetails}>
        {!selected ? <div className="empty-inspector">{copy.noSkillMatches}</div> : (
          <>
            <header className="workbench-heading">
              <div className="skill-monogram" aria-hidden="true">{selected.name.slice(0, 2).toUpperCase()}</div>
              <div className="workbench-title">
                <div><h2>{selected.name}</h2><StatusChip health={selected.health} copy={copy} /></div>
                <span>{copy.source} <strong>{selected.source ?? copy.localOnly}</strong></span>
              </div>
              <div className="workbench-actions">
                {canManage && (
                  <button className="secondary-button danger-button" onClick={onDelete} disabled={deleting}>
                    <Trash2 size={14} aria-hidden="true" />{deleting ? copy.deletingSkill : copy.deleteSkill}
                  </button>
                )}
                <button className="secondary-button open-reader-button" onClick={onOpenReader}>
                  <BookOpen size={14} aria-hidden="true" />{copy.openReader}
                </button>
              </div>
            </header>
            <nav className="workbench-tabs" aria-label={copy.skillDetail}>
              {(['overview', 'content', 'files'] as WorkbenchTab[]).map((item) => (
                <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>
                  {copy[item]}
                </button>
              ))}
            </nav>
            <div className="workbench-panel">
              {tab === 'overview' && (
                <SkillOverview
                  skill={selected}
                  copy={copy}
                  language={language}
                  sourceUpdate={sourceUpdates.get(selected.id)}
                />
              )}
              {tab === 'content' && (
                <div
                  className="skill-content-layout"
                  ref={contentLayout}
                  style={{ '--file-tree-width': `${fileTreeWidth}px` } as CSSProperties}
                >
                  <SkillFileTree entries={content?.files ?? []} selectedPath={content?.selectedPath} onSelect={onSelectFile} copy={copy} />
                  <ResizableSeparator
                    className="file-tree-separator"
                    label={copy.resizeFileTree}
                    value={fileTreeWidth}
                    minimum={minimumFileTreeWidth}
                    maximum={maximumFileTreeWidth}
                    onResize={resizeFileTree}
                    onStep={(direction) => {
                      const geometry = fileTreeGeometry()
                      setFileTreeWidth((current) => clamp(
                        current + direction * 12,
                        minimumFileTreeWidth,
                        geometry?.maximum ?? maximumFileTreeWidth,
                      ))
                    }}
                  />
                  <SkillDocument content={content} loading={contentLoading} error={contentError} mode={contentMode} onMode={onContentMode} copy={copy} />
                </div>
              )}
              {tab === 'files' && (
                <div className="files-panel">
                  <div className="files-panel-heading">
                    <p className="eyebrow">{copy.skillFiles}</p>
                    <span>{content?.files.length ?? 0}</span>
                  </div>
                  {(content?.files ?? []).map((entry) => (
                    entry.kind === 'directory' ? (
                      <div className="file-list-row directory" key={entry.path}>
                        <Folder size={14} aria-hidden="true" /><strong>{entry.path}/</strong><span>{copy.directory}</span>
                      </div>
                    ) : (
                      <button className="file-list-row" key={entry.path} onClick={() => { onSelectFile(entry.path); setTab('content') }}>
                        <FileText size={14} aria-hidden="true" /><strong>{entry.path}</strong><span>{copy.file}</span><ArrowRight size={13} aria-hidden="true" />
                      </button>
                    )
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function ReaderView({
  skill,
  content,
  contentLoading,
  contentError,
  contentMode,
  onContentMode,
  onSelectFile,
  onBack,
  onReveal,
  canReveal,
  copy,
}: {
  skill: SkillRecord
  content: SkillContentSnapshot | null
  contentLoading: boolean
  contentError: string
  contentMode: ContentMode
  onContentMode: (mode: ContentMode) => void
  onSelectFile: (path: string) => void
  onBack: () => void
  onReveal: () => void
  canReveal: boolean
  copy: Messages
}) {
  const headings = content?.selectedPath.toLowerCase().endsWith('.md')
    ? markdownHeadings(content.content).filter((heading) => heading.level <= 3)
    : []

  return (
    <section className="reader-view" aria-label={copy.openReader}>
      <header className="reader-toolbar">
        <button className="reader-back" onClick={onBack} aria-label={copy.backToWorkbench}>
          <ArrowLeft size={16} aria-hidden="true" /><strong>{skill.name}</strong>
        </button>
        <span className="reader-separator">/</span>
        <span className="reader-path">{content?.selectedPath ?? 'SKILL.md'}</span>
        <StatusChip health={skill.health} copy={copy} />
        <button className="reader-reveal" onClick={onReveal} disabled={!canReveal}>
          <FolderOpen size={15} aria-hidden="true" />{copy.revealInFinder}
        </button>
      </header>
      <div className="reader-layout">
        <aside className="reader-files">
          <SkillFileTree entries={content?.files ?? []} selectedPath={content?.selectedPath} onSelect={onSelectFile} copy={copy} />
        </aside>
        <section className="reader-document">
          <SkillDocument content={content} loading={contentLoading} error={contentError} mode={contentMode} onMode={onContentMode} copy={copy} />
        </section>
        <aside className="reader-outline">
          <p className="section-label">{copy.onThisPage}</p>
          {headings.map((heading) => (
            <button
              className={`outline-level-${heading.level}`}
              key={heading.id}
              onClick={() => document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {heading.text}
            </button>
          ))}
        </aside>
      </div>
    </section>
  )
}

function ExternalSkillPanel({
  copy,
  onClose,
  onApplied,
}: {
  copy: Messages
  onClose: () => void
  onApplied: (
    snapshot: InventorySnapshot,
    skillId: string,
    action: ExternalSkillPreview['action'],
  ) => void
}) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<ExternalSkillPreview | null>(null)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  const parseLink = async () => {
    if (!window.skillLedger) return
    setWorking(true)
    setMessage('')
    setPreview(null)
    try {
      setPreview(await window.skillLedger.previewExternalSkill(url.trim()))
    } catch (error) {
      const reason = (error as Error).message
      setMessage(reason.toLowerCase().includes('timed out') ? copy.githubSkillTimeout : reason)
    } finally {
      setWorking(false)
    }
  }

  const install = async () => {
    if (!window.skillLedger || !preview) return
    setWorking(true)
    setMessage('')
    try {
      const result = await window.skillLedger.installExternalSkill(preview.planId)
      if (result.status === 'applied' || result.status === 'already-applied') {
        onApplied(result.snapshot, preview.skillId, preview.action)
      } else {
        setMessage(result.error.message)
      }
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setWorking(false)
    }
  }
  const updating = preview?.action === 'update'

  return (
    <div className="plan-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="plan-panel external-skill-panel" role="dialog" aria-modal="true" aria-label={copy.addExternalSkill} onMouseDown={(event) => event.stopPropagation()}>
        <div className="plan-title">
          <div><p className="eyebrow">GitHub</p><h2>{copy.addExternalSkill}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label={copy.closePreview}><X size={18} /></button>
        </div>
        <div className="plan-scroll">
          <p className="external-skill-description">{copy.externalSkillDescription}</p>
          <form className="github-skill-form" onSubmit={(event) => { event.preventDefault(); void parseLink() }}>
            <label htmlFor="github-skill-url">{copy.githubSkillUrl}</label>
            <input
              id="github-skill-url"
              type="url"
              required
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                setPreview(null)
                setMessage('')
              }}
              placeholder={copy.githubSkillPlaceholder}
              autoFocus
            />
            <button className="secondary-button" type="submit" disabled={working || !url.trim()}>
              <GitBranch size={14} aria-hidden="true" />{working && !preview ? copy.parsingLink : copy.parseLink}
            </button>
          </form>
          {preview && (
            <section className="external-skill-preview" aria-label={updating ? copy.skillReadyToUpdate : copy.skillReady}>
              <div><p className="eyebrow">{updating ? copy.skillReadyToUpdate : copy.skillReady}</p><h3>{preview.name}</h3><p>{preview.description}</p></div>
              <dl>
                <div><dt>{copy.source}</dt><dd>{preview.repository}</dd></div>
                <div><dt>{copy.sourcePath}</dt><dd><code>{preview.path || '/'}</code></dd></div>
                <div><dt>{copy.pinnedCommit}</dt><dd><code>{preview.revision.slice(0, 12)}</code></dd></div>
                <div><dt>{updating ? copy.updateDestinations : copy.installDestinations}</dt><dd>{preview.destinations.join(' · ')}</dd></div>
              </dl>
            </section>
          )}
          {message && <p className="workspace-message" role="alert">{message}</p>}
        </div>
        <div className="plan-actions">
          <button className="secondary-button" onClick={onClose}>{copy.cancel}</button>
          <button className="primary-button" onClick={() => void install()} disabled={!preview || working}>
            {updating ? <RefreshCw size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            {working && preview
              ? updating ? copy.updatingSkill : copy.installingSkill
              : updating ? copy.updateSkill : copy.installSkill}
          </button>
        </div>
      </aside>
    </div>
  )
}

function PlanPanel({
  copy,
  liveMode,
  onClose,
  onSnapshot,
  skillId,
}: {
  copy: Messages
  liveMode: boolean
  onClose: () => void
  onSnapshot: (snapshot: InventorySnapshot) => void
  skillId: string | undefined
}) {
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null)
  const [replaceCopies, setReplaceCopies] = useState(false)
  const [restorePinned, setRestorePinned] = useState(false)
  const [working, setWorking] = useState(true)
  const [message, setMessage] = useState('')
  const [journalId, setJournalId] = useState<string | null>(null)

  const loadPreview = useCallback(async (replace: boolean, restore: boolean) => {
    if (!window.skillLedger || !liveMode || !skillId) {
      setWorking(false)
      setMessage(copy.liveScanRequired)
      return
    }
    setWorking(true)
    setMessage('')
    try {
      setPreview(await window.skillLedger.reconcile.preview({
        skillIds: [skillId],
        copyPolicy: replace ? 'replace-with-symlink' : 'preserve',
        sourcePolicy: restore ? 'restore-pinned' : 'preserve',
      }))
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setWorking(false)
    }
  }, [copy.liveScanRequired, liveMode, skillId])

  useEffect(() => { void loadPreview(false, false) }, [loadPreview])

  const applyPlan = async () => {
    if (!preview || preview.status !== 'ready' || !window.skillLedger) return
    setWorking(true)
    setMessage('')
    try {
      const result = await window.skillLedger.reconcile.apply(preview.planId)
      if (result.status === 'applied' || result.status === 'already-applied') {
        onSnapshot(result.snapshot)
        setJournalId(result.journalId)
        setMessage(result.status === 'applied' ? copy.appliedVerified : copy.planAlreadyApplied)
      } else if (result.status === 'rolled-back') {
        onSnapshot(result.snapshot)
        setMessage(`${copy.applyFailedRolledBack} ${result.error.message}`)
      } else {
        setMessage(result.error.message)
      }
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setWorking(false)
    }
  }

  const rollback = async () => {
    if (!journalId || !window.skillLedger) return
    setWorking(true)
    setMessage('')
    try {
      const result = await window.skillLedger.reconcile.rollback(journalId)
      if (result.status === 'rolled-back' || result.status === 'already-rolled-back') {
        onSnapshot(result.snapshot)
        setMessage(result.status === 'rolled-back' ? copy.previousStateRestored : copy.journalAlreadyRolledBack)
        setJournalId(null)
        await loadPreview(replaceCopies, restorePinned)
      } else {
        setMessage(result.error.message)
      }
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setWorking(false)
    }
  }

  const operationLabel = {
    'create-symlink': copy.createAgentLink,
    'repair-symlink': copy.repairBrokenLink,
    'replace-copy': copy.replaceIndependentCopy,
    'restore-canonical': copy.restorePinnedSource,
    'update-canonical': copy.replaceCanonicalDrift,
    'remove-path': copy.removeSkillPath,
    'write-lock': copy.updateSourceLock,
  } as const
  const changeCount = preview?.operations.length ?? 0
  const onlyCreatesLinks = Boolean(changeCount && preview?.operations.every((operation) => operation.kind === 'create-symlink'))
  const copyBlockers = preview?.blockers.filter((blocker) => blocker.code === 'copy-requires-confirmation').length ?? 0
  const sourceBlockers = preview?.blockers.filter((blocker) => (
    blocker.code === 'source-restore-requires-confirmation'
    || blocker.code === 'source-update-requires-confirmation'
  )).length ?? 0

  return (
    <div className="plan-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="plan-panel" role="dialog" aria-modal="true" aria-label={copy.reconciliationPlan} onMouseDown={(event) => event.stopPropagation()}>
        <div className="plan-title"><div><p className="eyebrow">{copy.hashBoundPreview} · {skillId}</p><h2>{copy.reconciliationPlan}</h2><p className="plan-description">{copy.repairPlanDescription}</p></div><button className="icon-button" onClick={onClose} aria-label={copy.closePreview}><X size={18} /></button></div>
        <div className="plan-scroll">
          <div className="plan-summary"><strong>{working && !preview ? '—' : changeCount}</strong><span>{preview?.status === 'blocked' ? `${preview.blockers.length} ${preview.blockers.length === 1 ? copy.blocker : copy.blockers} ${copy.blockersMustBeResolved}` : onlyCreatesLinks ? copy.createLinksReady : copy.verifiedChangesReady}</span></div>
          {preview?.operations.length ? (
            <ol className="plan-steps">
              {preview.operations.map((operation, index) => (
                <li key={operation.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{operationLabel[operation.kind]}</strong><p>{operation.skillId} · {operation.agentId}</p><code>{operation.targetPath}</code></div>
                </li>
              ))}
            </ol>
          ) : !working && <p className="plan-empty">{preview?.status === 'noop' ? copy.everythingMatches : copy.noSafeChanges}</p>}
          {preview?.blockers.length ? (
            <div className="plan-blockers">
              <span className="section-label">{copy.needsDecision}</span>
              {preview.blockers.map((blocker) => (
                <div key={`${blocker.skillId}-${blocker.agentId ?? 'universal'}`}><AlertTriangle size={14} /><p><strong>{blocker.skillId}{blocker.agentId ? ` · ${blocker.agentId}` : ''}</strong>{blocker.message}</p></div>
              ))}
            </div>
          ) : null}
          {copyBlockers > 0 || replaceCopies ? (
            <label className="copy-confirmation">
              <input
                type="checkbox"
                checked={replaceCopies}
                onChange={(event) => {
                  const checked = event.target.checked
                  setReplaceCopies(checked)
                  void loadPreview(checked, restorePinned)
                }}
              />
              <span><strong>{copy.replaceCopies}</strong><small>{copy.replaceCopiesDescription}</small></span>
            </label>
          ) : null}
          {sourceBlockers > 0 || restorePinned ? (
            <label className="copy-confirmation">
              <input
                type="checkbox"
                checked={restorePinned}
                onChange={(event) => {
                  const checked = event.target.checked
                  setRestorePinned(checked)
                  void loadPreview(replaceCopies, checked)
                }}
              />
              <span><strong>{copy.usePinnedSource}</strong><small>{copy.usePinnedSourceDescription}</small></span>
            </label>
          ) : null}
          <div className="plan-safety"><ShieldCheck size={18} /><p>{copy.planSafety}</p></div>
          {message && <p className="plan-message" aria-live="polite">{message}</p>}
        </div>
        <div className="plan-actions">
          {journalId && <button className="secondary-button wide" onClick={() => void rollback()} disabled={working}>{copy.rollbackLastApply}</button>}
          <button className="primary-button wide" onClick={() => void applyPlan()} disabled={working || preview?.status !== 'ready' || changeCount === 0}>
            {working ? copy.working : `${copy.apply} ${changeCount} ${changeCount === 1 ? copy.change : copy.changes}`}
          </button>
        </div>
      </aside>
    </div>
  )
}
