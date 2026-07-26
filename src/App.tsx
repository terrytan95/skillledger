import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Command,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import type {
  InventorySnapshot,
  ReconciliationPreview,
  SkillHealth,
  SkillRecord,
} from './types'
import { demoSnapshot } from './demo'
import './App.css'

type HealthFilter = SkillHealth | 'all'

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
  const [working, setWorking] = useState(true)
  const [message, setMessage] = useState('')
  const [journalId, setJournalId] = useState<string | null>(null)

  const loadPreview = useCallback(async (replace: boolean) => {
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
      }))
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setWorking(false)
    }
  }, [liveMode, skillId])

  useEffect(() => { void loadPreview(false) }, [loadPreview])

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
        await loadPreview(replaceCopies)
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
  } as const
  const changeCount = preview?.operations.length ?? 0
  const copyBlockers = preview?.blockers.filter((blocker) => blocker.code === 'copy-requires-confirmation').length ?? 0

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
                  void loadPreview(checked)
                }}
              />
              <span><strong>Replace independent copies</strong><small>Back up local content, then link it to the canonical skill.</small></span>
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
          <button className="active"><Boxes size={16} />Inventory</button>
          <button><Activity size={16} />Activity</button>
        </nav>
        <div className="header-actions">
          <span className={`mode-badge ${liveMode ? 'live' : ''}`}>{liveMode ? 'Live scan' : 'Demo data'}</span>
          <button className="secondary-button" onClick={() => setPlanOpen(true)}><SlidersHorizontal size={15} />Preview plan</button>
          <button className="primary-button" onClick={() => void refresh()} disabled={!window.skillLedger || loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? 'Scanning' : 'Scan now'}
          </button>
        </div>
      </header>

      <div className="control-bar">
        <div className="control-context">
          <Boxes size={16} aria-hidden="true" />
          <span><strong>Global inventory</strong><small>Ledger view</small></span>
        </div>
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search skills</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skill, source, or purpose…" />
          <kbd><Command size={11} />K</kbd>
        </label>
        <label className="health-filter">
          <span className="sr-only">Filter by health</span>
          <select value={health} onChange={(event) => setHealth(event.target.value as HealthFilter)}>
            <option value="all">All states</option>
            <option value="healthy">Healthy</option>
            <option value="review">Review</option>
            <option value="missing">Missing</option>
            <option value="broken">Broken</option>
          </select>
        </label>
      </div>

      <main>
        <LedgerView skills={skills} selected={selected} onSelect={setSelectedId} snapshot={snapshot} />
      </main>

      <footer className="app-footer">
        <span><span className="footer-dot" />Scanned {new Date(snapshot.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span>{snapshot.warnings.length ? `${snapshot.warnings.length} scan warning` : 'Read-only inventory mode'}</span>
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
