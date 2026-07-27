import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Command,
  Download,
  Eye,
  ExternalLink,
  FileCheck2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  HardDrive,
  Languages,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import type {
  ActivitySnapshot,
  AppUpdateStatus,
  ExternalSkillPreview,
  InventorySnapshot,
  ReconciliationPreview,
  SkillContentEntry,
  SkillContentSnapshot,
  SkillHealth,
  SkillRecord,
  SourceUpdateEntry,
  SourceUpdateSnapshot,
  TeamStatus,
} from './types'
import { localizeHealthReason, messages, type Language, type Messages } from './i18n'
import { demoSkillContent, demoSnapshot } from './demo'
import { MarkdownDocument, markdownHeadings } from './markdown'
import appIcon from '../build/icon.svg'
import './App.css'

type HealthFilter = SkillHealth | 'all' | 'needs-review'
type View = 'inventory' | 'activity' | 'team' | 'settings'
type ContentMode = 'rendered' | 'source'
type WorkbenchTab = 'overview' | 'content' | 'files'
type ThemeMode = 'system' | 'light' | 'dark'
type FontFamily = 'system' | 'sans' | 'serif' | 'mono'
const fontSizes = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18] as const
type FontSize = typeof fontSizes[number]
type Accent =
  | 'forest'
  | 'ocean'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'mist-pine'
  | 'haze-blue'
  | 'red-bean'
  | 'clay-blush'
  | 'moss'
  | 'smoky-violet'
  | 'stone-taupe'
  | 'lake-teal'
type LanguagePreference = 'system' | Language
type UpdatePhase = 'idle' | 'checking' | 'success' | 'error'

interface Preferences {
  theme: ThemeMode
  accent: Accent
  language: LanguagePreference
  fontFamily: FontFamily
  fontSize: FontSize
  automaticUpdates: boolean
}

const preferenceKey = 'skillledger:preferences'
const ledgerSplitKey = 'skillledger:ledger-split'
const defaultLedgerSplit = 0.35
export const automaticUpdateIntervalMs = 24 * 60 * 60 * 1000
const themeModes: ThemeMode[] = ['system', 'light', 'dark']
const accents: Accent[] = [
  'forest',
  'ocean',
  'violet',
  'amber',
  'rose',
  'mist-pine',
  'haze-blue',
  'red-bean',
  'clay-blush',
  'moss',
  'smoky-violet',
  'stone-taupe',
  'lake-teal',
]
const languages: LanguagePreference[] = ['system', 'en', 'zh-CN']
const fontFamilies: FontFamily[] = ['system', 'sans', 'serif', 'mono']
const defaultPreferences: Preferences = {
  theme: 'system',
  accent: 'forest',
  language: 'system',
  fontFamily: 'system',
  fontSize: 10,
  automaticUpdates: true,
}

export function clampSplitRatio(value: number, minimum = 0.25, maximum = 0.65): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function readLedgerSplitRatio(): number {
  const stored = Number.parseFloat(localStorage.getItem(ledgerSplitKey) ?? '')
  return Number.isFinite(stored) ? clampSplitRatio(stored) : defaultLedgerSplit
}

function readPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}') as Partial<Preferences> & { fontSize?: unknown }
    const legacyFontSize = { small: 9, medium: 10, large: 11 }[String(stored.fontSize) as 'small' | 'medium' | 'large']
    const fontSize = typeof stored.fontSize === 'number' ? stored.fontSize : legacyFontSize
    return {
      theme: themeModes.includes(stored.theme as ThemeMode) ? stored.theme as ThemeMode : defaultPreferences.theme,
      accent: accents.includes(stored.accent as Accent) ? stored.accent as Accent : defaultPreferences.accent,
      language: languages.includes(stored.language as LanguagePreference) ? stored.language as LanguagePreference : defaultPreferences.language,
      fontFamily: fontFamilies.includes(stored.fontFamily as FontFamily) ? stored.fontFamily as FontFamily : defaultPreferences.fontFamily,
      fontSize: fontSizes.includes(fontSize as FontSize) ? fontSize as FontSize : defaultPreferences.fontSize,
      automaticUpdates: typeof stored.automaticUpdates === 'boolean' ? stored.automaticUpdates : defaultPreferences.automaticUpdates,
    }
  } catch {
    return defaultPreferences
  }
}

function resolveLanguage(preference: LanguagePreference): Language {
  if (preference !== 'system') return preference
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
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
  const layout = useRef<HTMLDivElement>(null)
  useEffect(() => { setTab('content') }, [selected?.id])
  useEffect(() => { localStorage.setItem(ledgerSplitKey, String(splitRatio)) }, [splitRatio])

  const splitGeometry = () => {
    const container = layout.current
    const rail = container?.querySelector<HTMLElement>('.library-rail')
    const separator = container?.querySelector<HTMLElement>('.ledger-separator')
    if (!container || !rail || !separator) return null

    const bounds = container.getBoundingClientRect()
    const minimum = Math.max(0.25, 250 / bounds.width)
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
      <div
        className="ledger-separator"
        role="separator"
        aria-label={copy.resizePanels}
        aria-orientation="vertical"
        aria-valuemin={25}
        aria-valuemax={65}
        aria-valuenow={Math.round(splitRatio * 100)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          resize(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX)
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const geometry = splitGeometry()
          setSplitRatio((current) => clampSplitRatio(
            current + (event.key === 'ArrowRight' ? 0.02 : -0.02),
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
                <div className="skill-content-layout">
                  <SkillFileTree entries={content?.files ?? []} selectedPath={content?.selectedPath} onSelect={onSelectFile} copy={copy} />
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

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_024 / 1_024).toFixed(1)} MB`
}

function ActivityView({
  onSnapshot,
  copy,
  language,
}: {
  onSnapshot: (snapshot: InventorySnapshot) => void
  copy: Messages
  language: Language
}) {
  const [activity, setActivity] = useState<ActivitySnapshot>({
    retentionDays: 30,
    totalBackupBytes: 0,
    entries: [],
  })
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    if (!window.skillLedger) return
    setLoadError('')
    try {
      setActivity(await window.skillLedger.reconcile.activity())
    } catch (error) {
      setLoadError((error as Error).message)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const rollback = async (journalId: string) => {
    if (!window.skillLedger) return
    try {
      const result = await window.skillLedger.reconcile.rollback(journalId)
      if (result.status === 'rolled-back' || result.status === 'already-rolled-back') {
        onSnapshot(result.snapshot)
        setMessage(result.status === 'rolled-back' ? copy.rollbackCompleted : copy.journalAlreadyRolledBack)
      } else {
        setMessage(result.error.message)
      }
      await load()
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  const discard = async (journalId: string) => {
    if (!window.skillLedger) return
    try {
      const result = await window.skillLedger.reconcile.discard(journalId)
      if (result.status === 'rejected') {
        setMessage(result.error.message)
      } else {
        setActivity(result.activity)
        setMessage(result.status === 'discarded' ? copy.rollbackDataDiscarded : copy.rollbackDataAlreadyDiscarded)
      }
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  const statusLabels: Record<ActivitySnapshot['entries'][number]['status'], string> = {
    verified: copy.verified,
    'rolled-back': copy.rolledBack,
    discarded: copy.discarded,
    incomplete: copy.incomplete,
    'rollback-incomplete': copy.rollbackIncomplete,
    corrupt: copy.corrupt,
  }

  return (
    <section className="workspace-view" aria-label={copy.reconciliationActivity}>
      <div className="workspace-heading">
        <div><p className="eyebrow">{copy.recoveryLedger}</p><h1>{copy.activity}</h1></div>
        <div className="metric-card"><HardDrive size={16} /><strong>{formatBytes(activity.totalBackupBytes)}</strong><span>{copy.rollbackData}</span></div>
      </div>
      <div className="policy-note"><ShieldCheck size={17} /><p>{copy.retentionPolicy}</p></div>
      {message && <p className="workspace-message" aria-live="polite">{message}</p>}
      {loadError && <div className="team-error" role="alert"><AlertTriangle size={16} /><p>{copy.activityLoadFailed}: {loadError}</p></div>}
      <div className="activity-list">
        {activity.entries.map((entry) => (
          <article className="activity-row" key={entry.journalId}>
            <div className={`activity-status status-${entry.status}`}><span />{statusLabels[entry.status]}</div>
            <div><strong>{entry.skillIds.join(', ') || copy.unreadableJournal}</strong><small>{entry.createdAt ? new Date(entry.createdAt).toLocaleString(language) : entry.journalId}</small></div>
            <div className="activity-size">{formatBytes(entry.backupBytes)}</div>
            <div className="row-actions">
              {entry.rollbackAvailable && <button className="secondary-button" onClick={() => void rollback(entry.journalId)}>{copy.rollback}</button>}
              {entry.rollbackAvailable && <button className="icon-button" onClick={() => void discard(entry.journalId)} aria-label={`${copy.discardRollback}: ${entry.skillIds.join(', ')}`}><Trash2 size={14} /></button>}
              {entry.protected && <span className="protected-label">{copy.protected}</span>}
            </div>
          </article>
        ))}
        {!loadError && activity.entries.length === 0 && <p className="empty-workspace">{copy.noJournals}</p>}
      </div>
    </section>
  )
}

function TeamView({ copy }: { copy: Messages }) {
  const [team, setTeam] = useState<TeamStatus | null>(null)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    if (!window.skillLedger) return
    setLoadError('')
    try {
      setTeam(await window.skillLedger.team.status())
    } catch (error) {
      setLoadError((error as Error).message)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const importDocument = async (file: File | undefined, kind: 'policy' | 'manifest') => {
    if (!file || !window.skillLedger) return
    setMessage('')
    try {
      const json = await file.text()
      const result = kind === 'policy'
        ? await window.skillLedger.team.importPolicy(json)
        : await window.skillLedger.team.importManifest(json)
      setTeam(result.team)
      setMessage(result.status === 'imported'
        ? kind === 'policy' ? copy.policyImported : copy.manifestImported
        : result.message)
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  return (
    <section className="workspace-view" aria-label={copy.teamControls}>
      <div className="workspace-heading">
        <div><p className="eyebrow">{copy.localTrustPlane}</p><h1>{copy.team}</h1></div>
        <span className={`team-state ${team?.enabled && !team.error ? 'ready' : ''}`}>{team?.enabled ? (team.error ? copy.needsManifest : copy.enforced) : copy.personalMode}</span>
      </div>
      <div className="team-grid">
        <article className="team-card">
          <FileCheck2 size={19} />
          <div><p className="eyebrow">{copy.sharedPolicy}</p><h2>{team?.name ?? copy.noTeamPolicy}</h2></div>
          <p>{copy.sharedPolicyDescription}</p>
          <label className="secondary-button upload-button"><Upload size={14} />{copy.importPolicy}<input type="file" accept="application/json,.json" onChange={(event) => { void importDocument(event.target.files?.[0], 'policy'); event.target.value = '' }} /></label>
        </article>
        <article className="team-card">
          <ShieldCheck size={19} />
          <div><p className="eyebrow">{copy.signedManifest}</p><h2>{team?.signerId ?? copy.notVerified}</h2></div>
          <p>{copy.signedManifestDescription}</p>
          <label className="secondary-button upload-button"><Upload size={14} />{copy.importManifest}<input type="file" accept="application/json,.json" onChange={(event) => { void importDocument(event.target.files?.[0], 'manifest'); event.target.value = '' }} /></label>
        </article>
      </div>
      {message && <p className="workspace-message" aria-live="polite">{message}</p>}
      {loadError && <div className="team-error" role="alert"><AlertTriangle size={16} /><p>{copy.teamLoadFailed}: {loadError}</p></div>}
      {team?.error && <div className="team-error"><AlertTriangle size={16} /><p>{team.error}</p></div>}
      <div className="team-detail-grid">
        <div><GitBranch size={15} /><span><strong>{team?.managedRepositories.length ?? 0}</strong> {copy.managedRepositories}</span></div>
        <div><Users size={15} /><span><strong>{team?.signerRoles.map((role) => role === 'owner' ? copy.owner : copy.maintainer).join(', ') || copy.noSignerRole}</strong> {copy.signerRole}</span></div>
        <div><Boxes size={15} /><span><strong>{team?.manifestSkillCount ?? 0}</strong> {copy.manifestSkills}</span></div>
      </div>
      {team?.managedRepositories.map((managed) => (
        <div className="managed-repo" key={managed.repository}>
          <strong>{managed.repository}</strong>
          <span>{managed.paths.join(' · ')}</span>
        </div>
      ))}
      <div className="policy-note"><ShieldCheck size={17} /><p>{copy.teamSecurity}</p></div>
    </section>
  )
}

function ExternalSkillPanel({
  copy,
  onClose,
  onInstalled,
}: {
  copy: Messages
  onClose: () => void
  onInstalled: (snapshot: InventorySnapshot, skillId: string) => void
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
      setMessage((error as Error).message)
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
        onInstalled(result.snapshot, preview.skillId)
      } else {
        setMessage(result.error.message)
      }
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setWorking(false)
    }
  }

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
            <section className="external-skill-preview" aria-label={copy.skillReady}>
              <div><p className="eyebrow">{copy.skillReady}</p><h3>{preview.name}</h3><p>{preview.description}</p></div>
              <dl>
                <div><dt>{copy.source}</dt><dd>{preview.repository}</dd></div>
                <div><dt>{copy.sourcePath}</dt><dd><code>{preview.path || '/'}</code></dd></div>
                <div><dt>{copy.pinnedCommit}</dt><dd><code>{preview.revision.slice(0, 12)}</code></dd></div>
                <div><dt>{copy.installDestinations}</dt><dd>{preview.destinations.join(' · ')}</dd></div>
              </dl>
            </section>
          )}
          {message && <p className="workspace-message" role="alert">{message}</p>}
        </div>
        <div className="plan-actions">
          <button className="secondary-button" onClick={onClose}>{copy.cancel}</button>
          <button className="primary-button" onClick={() => void install()} disabled={!preview || working}>
            <Plus size={14} aria-hidden="true" />{working && preview ? copy.installingSkill : copy.installSkill}
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

function SettingsView({
  preferences,
  copy,
  appVersion,
  updateStatus,
  onPreference,
  onCheckUpdates,
  onOpenUpdates,
  onInstallUpdate,
}: {
  preferences: Preferences
  copy: Messages
  appVersion: string
  updateStatus: AppUpdateStatus | null
  onPreference: <Key extends keyof Preferences>(key: Key, value: Preferences[Key]) => void
  onCheckUpdates: () => void
  onOpenUpdates: () => void
  onInstallUpdate: () => void
}) {
  const updatePhase = updateStatus?.phase ?? 'idle'
  const downloadLabel = `${copy.downloadingUpdate}${updateStatus?.downloadPercent == null ? '' : ` ${Math.round(updateStatus.downloadPercent)}%`}`
  const [fontSizeBefore, setFontSizeBefore] = useState<FontSize>(preferences.fontSize)
  const [fontSizeDragging, setFontSizeDragging] = useState(false)
  const fontSizeInput = useRef<HTMLInputElement>(null)
  const fontSizeProgress = (preferences.fontSize - fontSizes[0]) / (fontSizes.at(-1)! - fontSizes[0]) * 100
  const fontSizeThumbPosition = 5 + (preferences.fontSize - fontSizes[0]) * 10
  const themeOptions = [
    { value: 'system' as const, label: copy.system, Icon: Monitor },
    { value: 'light' as const, label: copy.light, Icon: Sun },
    { value: 'dark' as const, label: copy.dark, Icon: Moon },
  ]
  const accentLabels: Record<Accent, string> = {
    forest: copy.forest,
    ocean: copy.ocean,
    violet: copy.violet,
    amber: copy.amber,
    rose: copy.rose,
    'mist-pine': copy.mistPine,
    'haze-blue': copy.hazeBlue,
    'red-bean': copy.redBean,
    'clay-blush': copy.clayBlush,
    moss: copy.moss,
    'smoky-violet': copy.smokyViolet,
    'stone-taupe': copy.stoneTaupe,
    'lake-teal': copy.lakeTeal,
  }

  return (
    <div className="settings-layout">
      <aside className="settings-intro">
        <div className="settings-icon"><Settings size={19} aria-hidden="true" /></div>
        <p className="eyebrow">{copy.settings}</p>
        <h1>{copy.settingsTitle}</h1>
        <p>{copy.settingsIntro}</p>
      </aside>

      <div className="settings-sections">
        <section className="settings-section">
          <div className="settings-section-title">
            <Palette size={18} aria-hidden="true" />
            <div><h2>{copy.appearance}</h2><p>{copy.appearanceDescription}</p></div>
          </div>
          <div className="setting-row">
            <div><strong>{copy.theme}</strong><span>{copy.themeDescription}</span></div>
            <div className="segmented-control" role="radiogroup" aria-label={copy.theme}>
              {themeOptions.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  className={preferences.theme === value ? 'selected' : ''}
                  role="radio"
                  aria-checked={preferences.theme === value}
                  onClick={() => onPreference('theme', value)}
                >
                  <Icon size={14} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row accent-row">
            <div><strong>{copy.accentColor}</strong><span>{copy.accentDescription}</span></div>
            <details
              className="accent-select"
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
              <summary aria-label={`${copy.accentColor}: ${accentLabels[preferences.accent]}`}>
                <span className={`accent-swatch swatch-${preferences.accent}`} aria-hidden="true" />
                <strong>{accentLabels[preferences.accent]}</strong>
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <div className="accent-menu" role="radiogroup" aria-label={copy.accentColor}>
                {accents.map((accent) => (
                  <button
                    key={accent}
                    className={preferences.accent === accent ? 'selected' : ''}
                    role="radio"
                    aria-checked={preferences.accent === accent}
                    onClick={(event) => {
                      onPreference('accent', accent)
                      event.currentTarget.closest('details')?.removeAttribute('open')
                    }}
                  >
                    <span className={`accent-swatch swatch-${accent}`} aria-hidden="true" />
                    <span>{accentLabels[accent]}</span>
                    {preferences.accent === accent && <Check size={13} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Languages size={18} aria-hidden="true" />
            <div><h2>{copy.language}</h2><p>{copy.languageDescription}</p></div>
          </div>
          <label className="setting-row">
            <div><strong>{copy.appLanguage}</strong><span>{copy.appLanguageDescription}</span></div>
            <select value={preferences.language} onChange={(event) => onPreference('language', event.target.value as LanguagePreference)}>
              <option value="system">{copy.followSystem}</option>
              <option value="en">{copy.english}</option>
              <option value="zh-CN">{copy.simplifiedChinese}</option>
            </select>
          </label>
          <label className="setting-row">
            <div><strong>{copy.interfaceFont}</strong><span>{copy.interfaceFontDescription}</span></div>
            <select value={preferences.fontFamily} onChange={(event) => onPreference('fontFamily', event.target.value as FontFamily)}>
              <option value="system">{copy.fontDefault}</option>
              <option value="sans">{copy.fontSans}</option>
              <option value="serif">{copy.fontSerif}</option>
              <option value="mono">{copy.fontMono}</option>
            </select>
          </label>
          <div className="font-size-row">
            <div className="font-size-row-heading">
              <div>
                <strong id="font-size-label">{copy.interfaceFontSize}</strong>
                <span id="font-size-description">{copy.fontSizeDragDescription}</span>
              </div>
              <output htmlFor="font-size-range">{copy.fontSizeCurrent} {preferences.fontSize} px</output>
            </div>
            <div
              className={`font-size-control ${fontSizeDragging ? 'dragging' : ''}`}
              style={{ '--font-size-fill': `${fontSizeProgress}%` } as CSSProperties}
            >
              <span className="font-size-bubble" style={{ left: `${fontSizeThumbPosition}%` }}>{preferences.fontSize} px</span>
              <input
                id="font-size-range"
                ref={fontSizeInput}
                type="range"
                min={fontSizes[0]}
                max={fontSizes.at(-1)}
                step={1}
                value={preferences.fontSize}
                aria-labelledby="font-size-label"
                aria-describedby="font-size-description"
                aria-valuetext={`${preferences.fontSize} ${copy.fontSizePixels}${preferences.fontSize === 10 ? `, ${copy.fontDefault}` : ''}`}
                onChange={(event) => onPreference('fontSize', Number(event.target.value) as FontSize)}
                onPointerDown={() => {
                  setFontSizeBefore(preferences.fontSize)
                  setFontSizeDragging(true)
                }}
                onPointerUp={() => setFontSizeDragging(false)}
                onPointerCancel={() => setFontSizeDragging(false)}
                onBlur={() => setFontSizeDragging(false)}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
                    setFontSizeBefore(preferences.fontSize)
                  }
                }}
              />
              <div className="font-size-ticks" aria-hidden="true">
                {fontSizes.map((size) => (
                  <span
                    className={preferences.fontSize === size ? 'selected' : ''}
                    key={size}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      setFontSizeBefore(preferences.fontSize)
                      onPreference('fontSize', size)
                      fontSizeInput.current?.focus()
                    }}
                  >
                    {size}
                  </span>
                ))}
              </div>
            </div>
            <div className="font-size-preview">
              <div className="font-size-preview-card" style={{ '--preview-font-size': `${fontSizeBefore}px` } as CSSProperties}>
                <span>{copy.fontSizeBefore} · {fontSizeBefore} px</span>
                <div className="font-size-preview-copy">
                  <p>{copy.fontSizeSampleTitle}</p>
                  <small>{copy.fontSizeSampleBody}</small>
                </div>
              </div>
              <div className="font-size-preview-card active" style={{ '--preview-font-size': `${preferences.fontSize}px` } as CSSProperties}>
                <span>{copy.fontSizeLivePreview} · {preferences.fontSize} px</span>
                <div className="font-size-preview-copy">
                  <p>{copy.fontSizeSampleTitle}</p>
                  <small>{copy.fontSizeSampleBody}</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Download size={18} aria-hidden="true" />
            <div><h2>{copy.updates}</h2><p>{copy.updatesDescription}</p></div>
          </div>
          <label className="setting-row switch-row">
            <div><strong>{copy.automaticUpdates}</strong><span>{copy.automaticUpdatesDescription}</span></div>
            <input
              type="checkbox"
              checked={preferences.automaticUpdates}
              onChange={(event) => onPreference('automaticUpdates', event.target.checked)}
            />
            <span className="switch" aria-hidden="true"><span /></span>
          </label>
          <div className="setting-row update-row">
            <div>
              <strong>{copy.currentVersion} {appVersion}</strong>
              <span className={`update-status status-${updatePhase}`}>
                {!window.skillLedger && copy.desktopOnly}
                {window.skillLedger && updatePhase === 'idle' && copy.updatesDescription}
                {updatePhase === 'checking' && copy.checking}
                {updatePhase === 'error' && copy.updateFailed}
                {updatePhase === 'available' && updateStatus && `${copy.updateAvailable}: ${updateStatus.latestVersion}`}
                {updatePhase === 'downloading' && downloadLabel}
                {updatePhase === 'downloaded' && updateStatus && `${copy.readyToInstall}: ${updateStatus.latestVersion}`}
                {updatePhase === 'up-to-date' && updateStatus && `${copy.upToDate} (${updateStatus.latestVersion})`}
              </span>
            </div>
            {updatePhase === 'downloaded' ? (
              <button className="primary-button" onClick={onInstallUpdate}><Download size={14} />{copy.installUpdate}</button>
            ) : updatePhase === 'downloading' ? (
              <button className="primary-button" disabled><RefreshCw size={14} className="spin" />{downloadLabel}</button>
            ) : updatePhase === 'available' ? (
              <button className="primary-button" onClick={onOpenUpdates}><ExternalLink size={14} />{copy.viewUpdate}</button>
            ) : (
              <button className="secondary-button" disabled={!window.skillLedger || updatePhase === 'checking'} onClick={onCheckUpdates}>
                <RefreshCw size={14} className={updatePhase === 'checking' ? 'spin' : ''} />{updatePhase === 'checking' ? copy.checking : copy.checkNow}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<InventorySnapshot>(demoSnapshot)
  const [query, setQuery] = useState('')
  const [health, setHealth] = useState<HealthFilter>('all')
  const [selectedId, setSelectedId] = useState(demoSnapshot.skills[0]?.id ?? '')
  const [loading, setLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [externalSkillOpen, setExternalSkillOpen] = useState(false)
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null)
  const [liveMode, setLiveMode] = useState(false)
  const [view, setView] = useState<View>('inventory')
  const [readerOpen, setReaderOpen] = useState(false)
  const [skillContent, setSkillContent] = useState<SkillContentSnapshot | null>(null)
  const [skillContentLoading, setSkillContentLoading] = useState(false)
  const [skillContentError, setSkillContentError] = useState('')
  const [contentMode, setContentMode] = useState<ContentMode>('rendered')
  const [preferences, setPreferences] = useState(readPreferences)
  const [appVersion, setAppVersion] = useState('—')
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [sourceUpdates, setSourceUpdates] = useState<SourceUpdateSnapshot | null>(null)
  const [sourceCheckPhase, setSourceCheckPhase] = useState<UpdatePhase>('idle')
  const [exportPhase, setExportPhase] = useState<'idle' | 'working'>('idle')
  const [inventoryMessage, setInventoryMessage] = useState('')
  const automaticUpdateChecked = useRef(false)
  const contentRequest = useRef(0)
  const searchInput = useRef<HTMLInputElement>(null)
  const language = resolveLanguage(preferences.language)
  const copy = messages[language]

  const refresh = useCallback(async () => {
    if (!window.skillLedger) return
    setLoading(true)
    setScanError('')
    try {
      const next = await window.skillLedger.scan()
      setSnapshot(next)
      setSourceUpdates(null)
      setSourceCheckPhase('idle')
      setInventoryMessage('')
      setSelectedId((current) => next.skills.some((skill) => skill.id === current) ? current : next.skills[0]?.id ?? '')
      setLiveMode(true)
    } catch (error) {
      setScanError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

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

  const checkUpdates = useCallback(async () => {
    if (!window.skillLedger) return
    setUpdateStatus((current) => ({
      currentVersion: current?.currentVersion ?? appVersion,
      latestVersion: current?.latestVersion ?? appVersion,
      available: current?.available ?? false,
      phase: 'checking',
      downloadPercent: null,
    }))
    try {
      const next = await window.skillLedger.checkForUpdates()
      setAppVersion(next.currentVersion)
      setUpdateStatus(next)
    } catch {
      setUpdateStatus((current) => ({
        currentVersion: current?.currentVersion ?? appVersion,
        latestVersion: current?.latestVersion ?? appVersion,
        available: current?.available ?? false,
        phase: 'error',
        downloadPercent: null,
      }))
    }
  }, [appVersion])

  const checkSourceUpdates = async () => {
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
  }

  const exportInventory = async () => {
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
  }

  const setPreference = useCallback(<Key extends keyof Preferences>(key: Key, value: Preferences[Key]) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    void window.skillLedger?.getAppVersion().then(setAppVersion).catch(() => undefined)
  }, [])

  useEffect(() => window.skillLedger?.onUpdateState((status) => {
    setAppVersion(status.currentVersion)
    setUpdateStatus(status)
  }), [])

  useEffect(() => {
    const root = document.documentElement
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      root.dataset.theme = preferences.theme === 'system'
        ? colorScheme.matches ? 'dark' : 'light'
        : preferences.theme
    }

    localStorage.setItem(preferenceKey, JSON.stringify(preferences))
    root.dataset.accent = preferences.accent
    root.dataset.fontFamily = preferences.fontFamily
    root.style.fontSize = `${preferences.fontSize}px`
    root.lang = language
    applyTheme()
    colorScheme.addEventListener('change', applyTheme)
    return () => colorScheme.removeEventListener('change', applyTheme)
  }, [language, preferences])

  useEffect(() => {
    if (!preferences.automaticUpdates) {
      automaticUpdateChecked.current = false
      return
    }
    if (!automaticUpdateChecked.current) {
      automaticUpdateChecked.current = true
      void checkUpdates()
    }
    const interval = window.setInterval(() => void checkUpdates(), automaticUpdateIntervalMs)
    return () => window.clearInterval(interval)
  }, [checkUpdates, preferences.automaticUpdates])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setReaderOpen(false)
      setView('inventory')
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

  useEffect(() => {
    if (!selected) {
      setSkillContent(null)
      setSkillContentError('')
      setReaderOpen(false)
      return
    }
    setContentMode('rendered')
    void loadSkillContent(selected)
  }, [loadSkillContent, selected?.id, snapshot.scannedAt])

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
        setSnapshot(result.snapshot)
        setSelectedId(result.snapshot.skills[0]?.id ?? '')
        setInventoryMessage(`${copy.deletedSkill}: ${selected.name}`)
      } else {
        if (result.status === 'rolled-back') setSnapshot(result.snapshot)
        setInventoryMessage(`${copy.deleteFailed}: ${result.error.message}`)
      }
    } catch (error) {
      setInventoryMessage(`${copy.deleteFailed}: ${(error as Error).message}`)
    } finally {
      setDeletingSkillId(null)
    }
  }

  const showView = (next: View) => {
    setReaderOpen(false)
    setView(next)
  }

  return (
    <div className={`app view-${view} ${readerOpen ? 'reader-open' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <img className="brand-mark" src={appIcon} alt="" />
          <div><strong>SkillLedger</strong><small>{copy.tagline}</small></div>
        </div>
        <nav className="primary-nav" aria-label={copy.primaryNavigation}>
          <button className={view === 'inventory' ? 'active' : ''} onClick={() => showView('inventory')}><Boxes size={16} />{copy.inventory}</button>
          <button className={view === 'activity' ? 'active' : ''} onClick={() => showView('activity')}><Activity size={16} />{copy.activity}</button>
          <button className={view === 'team' ? 'active' : ''} onClick={() => showView('team')}><Users size={16} />{copy.team}</button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => showView('settings')}><Settings size={16} />{copy.settings}</button>
        </nav>
        {view === 'inventory' && (
          <div className="header-actions">
            <span className={`mode-badge ${liveMode ? 'live' : ''}`}>{liveMode ? copy.liveScan : copy.demoData}</span>
            <span className="header-status" aria-live="polite">{inventoryMessage}</span>
            {!readerOpen && <button className="primary-button" onClick={() => setExternalSkillOpen(true)} disabled={!window.skillLedger || !liveMode}>
              <Plus size={15} />{copy.addSkill}
            </button>}
            {!readerOpen && <button className="secondary-button" onClick={() => void checkSourceUpdates()} disabled={!window.skillLedger || sourceCheckPhase === 'checking'}>
              <GitBranch size={15} />{sourceCheckPhase === 'checking' ? copy.checkingSources : copy.checkSourceUpdates}
            </button>}
            {!readerOpen && <button className="secondary-button" onClick={() => void exportInventory()} disabled={!window.skillLedger || exportPhase === 'working'}>
              <Download size={15} />{exportPhase === 'working' ? copy.exporting : copy.exportInventory}
            </button>}
            <button className="secondary-button" onClick={() => setPlanOpen(true)}><Wrench size={15} />{copy.previewPlan}</button>
            <button className="primary-button" onClick={() => void refresh()} disabled={!window.skillLedger || loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? copy.scanning : copy.scanNow}
            </button>
          </div>
        )}
      </header>

      {view !== 'settings' && !readerOpen && (
        <div className={`control-bar ${view !== 'inventory' ? 'simple' : ''}`}>
          <div className="control-context">
            {view === 'inventory' ? <Boxes size={16} aria-hidden="true" /> : view === 'activity' ? <Activity size={16} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />}
            <span>
              <strong>{view === 'inventory' ? copy.globalInventory : view === 'activity' ? copy.recoveryHistory : copy.teamGovernance}</strong>
              <small>{view === 'inventory' ? copy.ledgerView : view === 'activity' ? copy.journalAndRetention : copy.policiesAndManifests}</small>
            </span>
          </div>
          {view === 'inventory' && <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">{copy.searchSkills}</span>
            <input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
            <kbd><Command size={11} />K</kbd>
          </label>}
          {view === 'inventory' && <label className="health-filter">
            <span className="sr-only">{copy.filterByHealth}</span>
            <select value={health} onChange={(event) => setHealth(event.target.value as HealthFilter)}>
              <option value="all">{copy.allStates}</option>
              <option value="healthy">{copy.healthy}</option>
              <option value="needs-review">{copy.needsReview}</option>
              <option value="review">{copy.review}</option>
              <option value="missing">{copy.missing}</option>
              <option value="broken">{copy.broken}</option>
            </select>
          </label>}
        </div>
      )}

      <main>
        {view === 'inventory' && readerOpen && selected && (
          <ReaderView
            skill={selected}
            content={skillContent}
            contentLoading={skillContentLoading}
            contentError={skillContentError}
            contentMode={contentMode}
            onContentMode={setContentMode}
            onSelectFile={selectFile}
            onBack={() => setReaderOpen(false)}
            onReveal={() => void revealSelectedSkill()}
            canReveal={Boolean(window.skillLedger)}
            copy={copy}
          />
        )}
        {view === 'inventory' && !readerOpen && (
          <LedgerView
            skills={skills}
            selected={selected}
            onSelect={setSelectedId}
            scanError={scanError}
            sourceUpdates={sourceUpdatesBySkill}
            health={health}
            onHealth={setHealth}
            copy={copy}
            language={language}
            content={skillContent}
            contentLoading={skillContentLoading}
            contentError={skillContentError}
            contentMode={contentMode}
            onContentMode={setContentMode}
            onSelectFile={selectFile}
            onOpenReader={() => setReaderOpen(true)}
            canManage={liveMode && Boolean(window.skillLedger)}
            deleting={deletingSkillId === selected?.id}
            onDelete={() => void deleteSelectedSkill()}
          />
        )}
        {view === 'activity' && <ActivityView onSnapshot={setSnapshot} copy={copy} language={language} />}
        {view === 'team' && <TeamView copy={copy} />}
        {view === 'settings' && (
          <SettingsView
            preferences={preferences}
            copy={copy}
            appVersion={appVersion}
            updateStatus={updateStatus}
            onPreference={setPreference}
            onCheckUpdates={() => void checkUpdates()}
            onOpenUpdates={() => void window.skillLedger?.openUpdatesPage()}
            onInstallUpdate={() => void window.skillLedger?.installUpdate()}
          />
        )}
      </main>

      {!readerOpen && <footer className="app-footer">
        <span><span className="footer-dot" />{copy.scanned} {new Date(snapshot.scannedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="footer-context">
          {snapshot.warnings.length
            ? `${snapshot.warnings.length} ${copy.scanWarnings}`
            : view === 'activity'
              ? copy.safeRetention
              : view === 'team'
                ? copy.localPolicyEnforcement
                : copy.readOnlyMode}
        </span>
        {updateStatus?.phase === 'downloaded' ? (
          <span className="footer-update">
            <Download size={11} aria-hidden="true" />
            v{updateStatus.latestVersion} {copy.readyToInstall}
            <button onClick={() => void window.skillLedger?.installUpdate()}>{copy.installUpdate}</button>
          </span>
        ) : updateStatus?.phase === 'downloading' ? (
          <span className="footer-update">
            <RefreshCw size={11} className="spin" aria-hidden="true" />
            {copy.downloadingUpdate} {Math.round(updateStatus.downloadPercent ?? 0)}%
          </span>
        ) : updateStatus?.phase === 'available' ? (
          <span className="footer-update">
            <Download size={11} aria-hidden="true" />
            v{updateStatus.latestVersion} {copy.updateAvailable}
            <button onClick={() => void window.skillLedger?.openUpdatesPage()}>{copy.viewUpdate}<ExternalLink size={10} aria-hidden="true" /></button>
          </span>
        ) : (
          <span className="footer-version">SkillLedger v{appVersion}</span>
        )}
      </footer>}
      {externalSkillOpen && (
        <ExternalSkillPanel
          copy={copy}
          onClose={() => setExternalSkillOpen(false)}
          onInstalled={(next, skillId) => {
            setSnapshot(next)
            setSelectedId(skillId)
            setSourceUpdates(null)
            setInventoryMessage(`${copy.installedSkill}: ${skillId}`)
            setExternalSkillOpen(false)
          }}
        />
      )}
      {planOpen && (
        <PlanPanel
          copy={copy}
          liveMode={liveMode}
          onClose={() => setPlanOpen(false)}
          skillId={selected?.id}
          onSnapshot={(next) => {
            setSnapshot(next)
            setSelectedId((current) => next.skills.some((skill) => skill.id === current) ? current : next.skills[0]?.id ?? '')
          }}
        />
      )}
    </div>
  )
}
