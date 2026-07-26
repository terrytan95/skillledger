import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Command,
  FileCheck2,
  GitBranch,
  HardDrive,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import type {
  ActivitySnapshot,
  InventorySnapshot,
  ReconciliationPreview,
  SkillHealth,
  SkillRecord,
  TeamStatus,
} from './types'
import { demoSnapshot } from './demo'
import './App.css'

type HealthFilter = SkillHealth | 'all'
type PrimaryView = 'inventory' | 'activity' | 'team'

const healthLabel: Record<SkillHealth, string> = {
  healthy: 'Healthy',
  review: 'Review',
  missing: 'Missing',
  broken: 'Broken',
}

function StatusChip({ health }: { health: SkillHealth }) {
  const Icon = health === 'healthy' ? CheckCircle2 : AlertTriangle
  return (
    <span className={`status-chip status-${health}`}>
      <Icon size={13} aria-hidden="true" />
      {healthLabel[health]}
    </span>
  )
}

function AgentPills({ skill, limit = 5 }: { skill: SkillRecord; limit?: number }) {
  return (
    <div className="agent-pills" aria-label={`${skill.agents.length} Agent destinations`}>
      {skill.agents.slice(0, limit).map((agent) => (
        <span className="agent-pill" key={`${skill.id}-${agent.id}`}>{agent.label}</span>
      ))}
      {skill.agents.length > limit && <span className="agent-pill agent-pill-more">+{skill.agents.length - limit}</span>}
    </div>
  )
}

function SkillInspector({ skill }: { skill: SkillRecord | undefined }) {
  if (!skill) return <div className="empty-inspector">No skill matches this view.</div>
  return (
    <aside className="skill-inspector" aria-label="Selected skill details">
      <div className="inspector-heading">
        <div className="skill-monogram" aria-hidden="true">{skill.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <p className="eyebrow">Skill detail</p>
          <h2>{skill.name}</h2>
        </div>
      </div>
      <StatusChip health={skill.health} />
      <p className="inspector-description">{skill.description}</p>
      <dl className="fact-list">
        <div><dt>Source</dt><dd>{skill.source ?? 'Local only'}</dd></div>
        <div><dt>Source state</dt><dd>{skill.sourceState}</dd></div>
        {skill.sourcePin && <div><dt>Pinned commit</dt><dd>{skill.sourcePin.revision.slice(0, 12)}</dd></div>}
        <div><dt>Agent reach</dt><dd>{skill.agents.length} destinations</dd></div>
        <div><dt>Install shape</dt><dd>{skill.agents.some((agent) => agent.kind === 'copy') ? 'Mixed' : 'Canonical + links'}</dd></div>
        <div><dt>Last tracked</dt><dd>{skill.updatedAt ? new Date(skill.updatedAt).toLocaleDateString() : 'Not tracked'}</dd></div>
      </dl>
      <div className="health-note">
        <ShieldCheck size={16} aria-hidden="true" />
        <p>{skill.healthReason}</p>
      </div>
      <div className="inspector-section">
        <span className="section-label">Available in</span>
        <AgentPills skill={skill} limit={8} />
      </div>
      <div className="path-block">
        <span className="section-label">Canonical path</span>
        <code>{skill.canonicalPath}</code>
      </div>
    </aside>
  )
}

function LedgerView({
  skills,
  selected,
  onSelect,
  snapshot,
}: {
  skills: SkillRecord[]
  selected: SkillRecord | undefined
  onSelect: (id: string) => void
  snapshot: InventorySnapshot
}) {
  return (
    <div className="ledger-layout">
      <aside className="library-rail">
        <p className="eyebrow">Library</p>
        <h2>Global skills</h2>
        <nav aria-label="Inventory groups">
          <button className="rail-item active"><Boxes size={16} />All skills <span>{snapshot.summary.total}</span></button>
          <button className="rail-item"><ShieldCheck size={16} />Healthy <span>{snapshot.summary.healthy}</span></button>
          <button className="rail-item"><AlertTriangle size={16} />Needs review <span>{snapshot.summary.review + snapshot.summary.missing + snapshot.summary.broken}</span></button>
        </nav>
        <div className="rail-source">
          <span className="section-label">Source of truth</span>
          <code>{snapshot.canonicalRoot}</code>
        </div>
      </aside>
      <section className="skill-list" aria-label="Skill inventory">
        <div className="panel-title">
          <div><p className="eyebrow">Inventory</p><h1>{skills.length} skills</h1></div>
          <span className="quiet-copy">Sorted by health</span>
        </div>
        <div className="skill-rows">
          {skills.map((skill) => (
            <button
              className={`skill-row ${selected?.id === skill.id ? 'selected' : ''}`}
              key={skill.id}
              onClick={() => onSelect(skill.id)}
            >
              <span className={`health-dot status-${skill.health}`} aria-hidden="true" />
              <span className="row-main"><strong>{skill.name}</strong><small>{skill.description}</small></span>
              <span className="row-source">{skill.sourceType ?? 'local'}</span>
              <span className="row-count">{skill.agents.length}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
      <SkillInspector skill={selected} />
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_024 / 1_024).toFixed(1)} MB`
}

function ActivityView({ onSnapshot }: { onSnapshot: (snapshot: InventorySnapshot) => void }) {
  const [activity, setActivity] = useState<ActivitySnapshot>({
    retentionDays: 30,
    totalBackupBytes: 0,
    entries: [],
  })
  const [message, setMessage] = useState('')
  const load = useCallback(async () => {
    if (!window.skillLedger) return
    setActivity(await window.skillLedger.reconcile.activity())
  }, [])

  useEffect(() => { void load() }, [load])

  const rollback = async (journalId: string) => {
    if (!window.skillLedger) return
    const result = await window.skillLedger.reconcile.rollback(journalId)
    if (result.status === 'rolled-back' || result.status === 'already-rolled-back') {
      onSnapshot(result.snapshot)
      setMessage(result.status === 'rolled-back' ? 'Rollback completed and verified.' : 'This journal was already rolled back.')
    } else {
      setMessage(result.error.message)
    }
    await load()
  }

  const discard = async (journalId: string) => {
    if (!window.skillLedger) return
    const result = await window.skillLedger.reconcile.discard(journalId)
    if (result.status === 'rejected') {
      setMessage(result.error.message)
    } else {
      setActivity(result.activity)
      setMessage(result.status === 'discarded' ? 'Rollback data discarded; audit events were retained.' : 'Rollback data was already discarded.')
    }
  }

  return (
    <section className="workspace-view" aria-label="Reconciliation activity">
      <div className="workspace-heading">
        <div><p className="eyebrow">Recovery ledger</p><h1>Activity</h1></div>
        <div className="metric-card"><HardDrive size={16} /><strong>{formatBytes(activity.totalBackupBytes)}</strong><span>rollback data</span></div>
      </div>
      <div className="policy-note"><ShieldCheck size={17} /><p>Verified backups expire after 30 days only when a newer successful journal exists for every affected skill. Incomplete, corrupt, and rollback-incomplete journals stay protected.</p></div>
      {message && <p className="workspace-message" aria-live="polite">{message}</p>}
      <div className="activity-list">
        {activity.entries.map((entry) => (
          <article className="activity-row" key={entry.journalId}>
            <div className={`activity-status status-${entry.status}`}><span />{entry.status}</div>
            <div><strong>{entry.skillIds.join(', ') || 'Unreadable journal'}</strong><small>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : entry.journalId}</small></div>
            <div className="activity-size">{formatBytes(entry.backupBytes)}</div>
            <div className="row-actions">
              {entry.rollbackAvailable && <button className="secondary-button" onClick={() => void rollback(entry.journalId)}>Rollback</button>}
              {entry.rollbackAvailable && <button className="icon-button" onClick={() => void discard(entry.journalId)} aria-label={`Discard rollback for ${entry.skillIds.join(', ')}`}><Trash2 size={14} /></button>}
              {entry.protected && <span className="protected-label">Protected</span>}
            </div>
          </article>
        ))}
        {activity.entries.length === 0 && <p className="empty-workspace">No reconciliation journals yet.</p>}
      </div>
    </section>
  )
}

function TeamView() {
  const [team, setTeam] = useState<TeamStatus | null>(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (window.skillLedger) setTeam(await window.skillLedger.team.status())
  }, [])
  useEffect(() => { void load() }, [load])

  const importDocument = async (file: File | undefined, kind: 'policy' | 'manifest') => {
    if (!file || !window.skillLedger) return
    const json = await file.text()
    const result = kind === 'policy'
      ? await window.skillLedger.team.importPolicy(json)
      : await window.skillLedger.team.importManifest(json)
    setTeam(result.team)
    setMessage(result.status === 'imported'
      ? `${kind === 'policy' ? 'Shared policy' : 'Signed manifest'} imported.`
      : result.message)
  }

  return (
    <section className="workspace-view" aria-label="Team controls">
      <div className="workspace-heading">
        <div><p className="eyebrow">Local trust plane</p><h1>Team</h1></div>
        <span className={`team-state ${team?.enabled && !team.error ? 'ready' : ''}`}>{team?.enabled ? (team.error ? 'Needs manifest' : 'Enforced') : 'Personal mode'}</span>
      </div>
      <div className="team-grid">
        <article className="team-card">
          <FileCheck2 size={19} />
          <div><p className="eyebrow">Shared policy</p><h2>{team?.name ?? 'No team policy'}</h2></div>
          <p>Defines trusted Ed25519 signers, managed GitHub repositories, and minimum approval roles.</p>
          <label className="secondary-button upload-button"><Upload size={14} />Import policy<input type="file" accept="application/json,.json" onChange={(event) => { void importDocument(event.target.files?.[0], 'policy'); event.target.value = '' }} /></label>
        </article>
        <article className="team-card">
          <ShieldCheck size={19} />
          <div><p className="eyebrow">Signed manifest</p><h2>{team?.signerId ?? 'Not verified'}</h2></div>
          <p>Pins exact commits and content hashes, then grants scoped restore, update, or copy-replacement approvals.</p>
          <label className="secondary-button upload-button"><Upload size={14} />Import manifest<input type="file" accept="application/json,.json" onChange={(event) => { void importDocument(event.target.files?.[0], 'manifest'); event.target.value = '' }} /></label>
        </article>
      </div>
      {message && <p className="workspace-message" aria-live="polite">{message}</p>}
      {team?.error && <div className="team-error"><AlertTriangle size={16} /><p>{team.error}</p></div>}
      <div className="team-detail-grid">
        <div><GitBranch size={15} /><span><strong>{team?.managedRepositories.length ?? 0}</strong> managed repositories</span></div>
        <div><Users size={15} /><span><strong>{team?.signerRoles.join(', ') || 'No'}</strong> signer role</span></div>
        <div><Boxes size={15} /><span><strong>{team?.manifestSkillCount ?? 0}</strong> manifest skills</span></div>
      </div>
      {team?.managedRepositories.map((managed) => (
        <div className="managed-repo" key={managed.repository}>
          <strong>{managed.repository}</strong>
          <span>{managed.paths.join(' · ')}</span>
        </div>
      ))}
      <div className="policy-note"><ShieldCheck size={17} /><p>Private keys never enter SkillLedger. Import is local; source operations are blocked unless the installed manifest signature, managed path, signer role, and explicit action approval all match.</p></div>
    </section>
  )
}

function PlanPanel({
  liveMode,
  onClose,
  onSnapshot,
  skillId,
}: {
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
      setMessage('Live scan is required before creating a reconciliation plan.')
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
  }, [liveMode, skillId])

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
        setMessage(result.status === 'applied' ? 'Applied and verified. Rollback remains available.' : 'This plan was already applied.')
      } else if (result.status === 'rolled-back') {
        onSnapshot(result.snapshot)
        setMessage(`Apply failed safely and was rolled back: ${result.error.message}`)
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
        setMessage(result.status === 'rolled-back' ? 'Previous Agent state restored and verified.' : 'This journal was already rolled back.')
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
    'create-symlink': 'Create Agent link',
    'repair-symlink': 'Repair broken link',
    'replace-copy': 'Replace independent copy',
    'restore-canonical': 'Restore pinned source',
    'update-canonical': 'Replace canonical drift',
  } as const
  const changeCount = preview?.operations.length ?? 0
  const copyBlockers = preview?.blockers.filter((blocker) => blocker.code === 'copy-requires-confirmation').length ?? 0
  const sourceBlockers = preview?.blockers.filter((blocker) => (
    blocker.code === 'source-restore-requires-confirmation'
    || blocker.code === 'source-update-requires-confirmation'
  )).length ?? 0

  return (
    <div className="plan-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="plan-panel" role="dialog" aria-modal="true" aria-label="Reconciliation preview" onMouseDown={(event) => event.stopPropagation()}>
        <div className="plan-title"><div><p className="eyebrow">Hash-bound preview · {skillId}</p><h2>Reconciliation plan</h2></div><button className="icon-button" onClick={onClose} aria-label="Close preview"><X size={18} /></button></div>
        <div className="plan-scroll">
          <div className="plan-summary"><strong>{working && !preview ? '—' : changeCount}</strong><span>{preview?.status === 'blocked' ? `${preview.blockers.length} blocker${preview.blockers.length === 1 ? '' : 's'} must be resolved` : 'verified changes ready for review'}</span></div>
          {preview?.operations.length ? (
            <ol className="plan-steps">
              {preview.operations.map((operation, index) => (
                <li key={operation.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{operationLabel[operation.kind]}</strong><p>{operation.skillId} · {operation.agentId}</p></div>
                </li>
              ))}
            </ol>
          ) : !working && <p className="plan-empty">{preview?.status === 'noop' ? 'Everything already matches the canonical library.' : 'No safe changes are currently available.'}</p>}
          {preview?.blockers.length ? (
            <div className="plan-blockers">
              <span className="section-label">Needs a decision</span>
              {preview.blockers.map((blocker) => (
                <div key={`${blocker.skillId}-${blocker.agentId}`}><AlertTriangle size={14} /><p><strong>{blocker.skillId} · {blocker.agentId}</strong>{blocker.message}</p></div>
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
              <span><strong>Replace independent copies</strong><small>Back up local content, then link it to the canonical skill.</small></span>
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
              <span><strong>Use the pinned GitHub source</strong><small>Download the exact commit, verify its SHA-256 tree, and atomically restore or update canonical content.</small></span>
            </label>
          ) : null}
          <div className="plan-safety"><ShieldCheck size={18} /><p>Every plan is bound to SHA-256 preconditions. Journal and backups are durable before same-volume atomic swaps; failed verification rolls back automatically.</p></div>
          {message && <p className="plan-message" aria-live="polite">{message}</p>}
        </div>
        <div className="plan-actions">
          {journalId && <button className="secondary-button wide" onClick={() => void rollback()} disabled={working}>Rollback last apply</button>}
          <button className="primary-button wide" onClick={() => void applyPlan()} disabled={working || preview?.status !== 'ready' || changeCount === 0}>
            {working ? 'Working…' : `Apply ${changeCount || ''} change${changeCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </aside>
    </div>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<InventorySnapshot>(demoSnapshot)
  const [query, setQuery] = useState('')
  const [health, setHealth] = useState<HealthFilter>('all')
  const [selectedId, setSelectedId] = useState(demoSnapshot.skills[0]?.id ?? '')
  const [loading, setLoading] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [liveMode, setLiveMode] = useState(false)
  const [view, setView] = useState<PrimaryView>('inventory')

  const refresh = useCallback(async () => {
    if (!window.skillLedger) return
    setLoading(true)
    try {
      const next = await window.skillLedger.scan()
      setSnapshot(next)
      setSelectedId((current) => next.skills.some((skill) => skill.id === current) ? current : next.skills[0]?.id ?? '')
      setLiveMode(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const skills = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return snapshot.skills.filter((skill) => {
      const matchesHealth = health === 'all' || skill.health === health
      const matchesQuery = !normalized || `${skill.name} ${skill.description} ${skill.source ?? ''}`.toLowerCase().includes(normalized)
      return matchesHealth && matchesQuery
    }).sort((a, b) => {
      const order: Record<SkillHealth, number> = { broken: 0, missing: 1, review: 2, healthy: 3 }
      return order[a.health] - order[b.health] || a.name.localeCompare(b.name)
    })
  }, [health, query, snapshot.skills])

  const selected = snapshot.skills.find((skill) => skill.id === selectedId) ?? skills[0]

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <div><strong>SkillLedger</strong><small>Your skills, one source of truth.</small></div>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button className={view === 'inventory' ? 'active' : ''} onClick={() => setView('inventory')}><Boxes size={16} />Inventory</button>
          <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><Activity size={16} />Activity</button>
          <button className={view === 'team' ? 'active' : ''} onClick={() => setView('team')}><Users size={16} />Team</button>
        </nav>
        <div className="header-actions">
          <span className={`mode-badge ${liveMode ? 'live' : ''}`}>{liveMode ? 'Live scan' : 'Demo data'}</span>
          {view === 'inventory' && <button className="secondary-button" onClick={() => setPlanOpen(true)}><SlidersHorizontal size={15} />Preview plan</button>}
          <button className="primary-button" onClick={() => void refresh()} disabled={!window.skillLedger || loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? 'Scanning' : 'Scan now'}
          </button>
        </div>
      </header>

      <div className={`control-bar ${view !== 'inventory' ? 'simple' : ''}`}>
        <div className="control-context">
          {view === 'inventory' ? <Boxes size={16} aria-hidden="true" /> : view === 'activity' ? <Activity size={16} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />}
          <span><strong>{view === 'inventory' ? 'Global inventory' : view === 'activity' ? 'Recovery history' : 'Team governance'}</strong><small>{view === 'inventory' ? 'Ledger view' : view === 'activity' ? 'Journal and retention' : 'Policies and signed manifests'}</small></span>
        </div>
        {view === 'inventory' && <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search skills</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skill, source, or purpose…" />
          <kbd><Command size={11} />K</kbd>
        </label>}
        {view === 'inventory' && <label className="health-filter">
          <span className="sr-only">Filter by health</span>
          <select value={health} onChange={(event) => setHealth(event.target.value as HealthFilter)}>
            <option value="all">All states</option>
            <option value="healthy">Healthy</option>
            <option value="review">Review</option>
            <option value="missing">Missing</option>
            <option value="broken">Broken</option>
          </select>
        </label>}
      </div>

      <main>
        {view === 'inventory' && <LedgerView skills={skills} selected={selected} onSelect={setSelectedId} snapshot={snapshot} />}
        {view === 'activity' && <ActivityView onSnapshot={setSnapshot} />}
        {view === 'team' && <TeamView />}
      </main>

      <footer className="app-footer">
        <span><span className="footer-dot" />Scanned {new Date(snapshot.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span>{snapshot.warnings.length ? `${snapshot.warnings.length} scan warning` : view === 'inventory' ? 'Hash-bound inventory' : view === 'activity' ? '30-day safe retention' : 'Local policy enforcement'}</span>
      </footer>
      {planOpen && (
        <PlanPanel
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
