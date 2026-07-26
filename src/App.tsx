import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Command,
  Database,
  GitBranch,
  Grid2X2,
  LayoutList,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import type { InventorySnapshot, SkillHealth, SkillRecord } from './types'
import { demoSnapshot } from './demo'
import './App.css'

type Design = 'ledger' | 'atlas' | 'harbor'
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

function AtlasView({
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
    <div className="atlas-shell">
      <section className="metric-strip" aria-label="Inventory metrics">
        <div><span>Tracked skills</span><strong>{snapshot.summary.total}</strong><small>Across the global library</small></div>
        <div><span>Healthy</span><strong>{snapshot.summary.healthy}</strong><small>Ready for every linked Agent</small></div>
        <div><span>Needs attention</span><strong>{snapshot.summary.review + snapshot.summary.missing + snapshot.summary.broken}</strong><small>Drift, copies, or missing content</small></div>
        <div><span>Install reach</span><strong>{snapshot.summary.agentLinks}</strong><small>Total resolved destinations</small></div>
      </section>
      <div className="atlas-workspace">
        <section className="atlas-table" aria-label="Dense skill table">
          <div className="table-heading">
            <span>Skill</span><span>State</span><span>Source</span><span>Agents</span><span>Tracked</span>
          </div>
          {skills.map((skill) => (
            <button
              className={`table-row ${selected?.id === skill.id ? 'selected' : ''}`}
              key={skill.id}
              onClick={() => onSelect(skill.id)}
            >
              <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
              <StatusChip health={skill.health} />
              <span>{skill.source ?? 'Local only'}</span>
              <span>{skill.agents.length}</span>
              <span>{skill.updatedAt ? new Date(skill.updatedAt).toLocaleDateString() : '—'}</span>
            </button>
          ))}
        </section>
        <SkillInspector skill={selected} />
      </div>
    </div>
  )
}

function HarborView({
  skills,
  selected,
  onSelect,
}: {
  skills: SkillRecord[]
  selected: SkillRecord | undefined
  onSelect: (id: string) => void
}) {
  const sources = [...new Set(skills.map((skill) => skill.source ?? 'Local'))].slice(0, 6)
  const agents = [...new Set(skills.flatMap((skill) => skill.agents.map((agent) => agent.label)))].slice(0, 9)
  return (
    <div className="harbor-shell">
      <div className="harbor-intro">
        <div><p className="eyebrow">Reconciliation map</p><h1>One library, every Agent.</h1></div>
        <p>Follow provenance from source to canonical skill to destination. Select a skill to inspect its route.</p>
      </div>
      <div className="harbor-board">
        <section className="harbor-column">
          <div className="column-heading"><GitBranch size={17} /><span>Sources</span><small>{sources.length}</small></div>
          {sources.map((source) => <div className="source-node" key={source}><Database size={15} /><span>{source}</span></div>)}
        </section>
        <section className="harbor-column harbor-skills">
          <div className="column-heading"><Boxes size={17} /><span>Canonical library</span><small>{skills.length}</small></div>
          <div className="harbor-skill-grid">
            {skills.map((skill) => (
              <button
                className={`harbor-skill ${selected?.id === skill.id ? 'selected' : ''}`}
                key={skill.id}
                onClick={() => onSelect(skill.id)}
              >
                <span className={`health-dot status-${skill.health}`} />
                <strong>{skill.name}</strong>
                <small>{skill.agents.length} routes</small>
              </button>
            ))}
          </div>
        </section>
        <section className="harbor-column">
          <div className="column-heading"><Network size={17} /><span>Destinations</span><small>{agents.length}</small></div>
          {agents.map((agent) => <div className="agent-node" key={agent}><span>{agent.slice(0, 1)}</span><strong>{agent}</strong></div>)}
        </section>
      </div>
      <div className="harbor-detail"><SkillInspector skill={selected} /></div>
    </div>
  )
}

function PlanPanel({ snapshot, onClose }: { snapshot: InventorySnapshot; onClose: () => void }) {
  const attention = snapshot.summary.review + snapshot.summary.missing + snapshot.summary.broken
  return (
    <div className="plan-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="plan-panel" role="dialog" aria-modal="true" aria-label="Reconciliation preview" onMouseDown={(event) => event.stopPropagation()}>
        <div className="plan-title"><div><p className="eyebrow">Preview only</p><h2>Reconciliation plan</h2></div><button className="icon-button" onClick={onClose} aria-label="Close preview"><X size={18} /></button></div>
        <div className="plan-summary"><strong>{attention}</strong><span>items need review before any change</span></div>
        <ol className="plan-steps">
          <li><span>01</span><div><strong>Repair broken links</strong><p>{snapshot.summary.broken} direct integrity issues</p></div></li>
          <li><span>02</span><div><strong>Restore tracked skills</strong><p>{snapshot.summary.missing} lock entries missing on disk</p></div></li>
          <li><span>03</span><div><strong>Review independent copies</strong><p>{snapshot.summary.review} items may drift from canonical content</p></div></li>
        </ol>
        <div className="plan-safety"><ShieldCheck size={18} /><p>Apply is intentionally disabled in this first release. Mutation ships with a rollback journal and command-level tests.</p></div>
        <button className="primary-button wide" disabled>Apply plan — coming next</button>
      </aside>
    </div>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<InventorySnapshot>(demoSnapshot)
  const [design, setDesign] = useState<Design>('ledger')
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
    <div className="app" data-design={design}>
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
        <div className="design-switcher" aria-label="UI direction">
          <span>Interface</span>
          <button className={design === 'ledger' ? 'active' : ''} onClick={() => setDesign('ledger')}><LayoutList size={14} />Ledger</button>
          <button className={design === 'atlas' ? 'active' : ''} onClick={() => setDesign('atlas')}><Grid2X2 size={14} />Atlas</button>
          <button className={design === 'harbor' ? 'active' : ''} onClick={() => setDesign('harbor')}><Network size={14} />Harbor</button>
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
        {design === 'ledger' && <LedgerView skills={skills} selected={selected} onSelect={setSelectedId} snapshot={snapshot} />}
        {design === 'atlas' && <AtlasView skills={skills} selected={selected} onSelect={setSelectedId} snapshot={snapshot} />}
        {design === 'harbor' && <HarborView skills={skills} selected={selected} onSelect={setSelectedId} />}
      </main>

      <footer className="app-footer">
        <span><span className="footer-dot" />Scanned {new Date(snapshot.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span>{snapshot.warnings.length ? `${snapshot.warnings.length} scan warning` : 'Read-only inventory mode'}</span>
      </footer>
      {planOpen && <PlanPanel snapshot={snapshot} onClose={() => setPlanOpen(false)} />}
    </div>
  )
}
