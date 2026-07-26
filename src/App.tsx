import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Command,
  Download,
  ExternalLink,
  Languages,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  X,
} from 'lucide-react'
import type {
  AppUpdateInfo,
  InventorySnapshot,
  ReconciliationPreview,
  SkillHealth,
  SkillRecord,
} from './types'
import { localizeHealthReason, messages, type Language, type Messages } from './i18n'
import { demoSnapshot } from './demo'
import './App.css'

type HealthFilter = SkillHealth | 'all'
type View = 'inventory' | 'settings'
type ThemeMode = 'system' | 'light' | 'dark'
type Accent = 'forest' | 'ocean' | 'violet' | 'amber' | 'rose'
type LanguagePreference = 'system' | Language
type UpdatePhase = 'idle' | 'checking' | 'success' | 'error'

interface Preferences {
  theme: ThemeMode
  accent: Accent
  language: LanguagePreference
  automaticUpdates: boolean
}

const preferenceKey = 'skillledger:preferences'
const themeModes: ThemeMode[] = ['system', 'light', 'dark']
const accents: Accent[] = ['forest', 'ocean', 'violet', 'amber', 'rose']
const languages: LanguagePreference[] = ['system', 'en', 'zh-CN']
const defaultPreferences: Preferences = {
  theme: 'system',
  accent: 'forest',
  language: 'system',
  automaticUpdates: true,
}

function readPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}') as Partial<Preferences>
    return {
      theme: themeModes.includes(stored.theme as ThemeMode) ? stored.theme as ThemeMode : defaultPreferences.theme,
      accent: accents.includes(stored.accent as Accent) ? stored.accent as Accent : defaultPreferences.accent,
      language: languages.includes(stored.language as LanguagePreference) ? stored.language as LanguagePreference : defaultPreferences.language,
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

function SkillInspector({
  skill,
  copy,
  language,
}: {
  skill: SkillRecord | undefined
  copy: Messages
  language: Language
}) {
  if (!skill) return <div className="empty-inspector">{copy.noSkillMatches}</div>
  return (
    <aside className="skill-inspector" aria-label={copy.selectedSkillDetails}>
      <div className="inspector-heading">
        <div className="skill-monogram" aria-hidden="true">{skill.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <p className="eyebrow">{copy.skillDetail}</p>
          <h2>{skill.name}</h2>
        </div>
      </div>
      <StatusChip health={skill.health} copy={copy} />
      <p className="inspector-description">{skill.description}</p>
      <dl className="fact-list">
        <div><dt>{copy.source}</dt><dd>{skill.source ?? copy.localOnly}</dd></div>
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
    </aside>
  )
}

function LedgerView({
  skills,
  selected,
  onSelect,
  snapshot,
  copy,
  language,
}: {
  skills: SkillRecord[]
  selected: SkillRecord | undefined
  onSelect: (id: string) => void
  snapshot: InventorySnapshot
  copy: Messages
  language: Language
}) {
  return (
    <div className="ledger-layout">
      <aside className="library-rail">
        <p className="eyebrow">{copy.library}</p>
        <h2>{copy.globalSkills}</h2>
        <nav aria-label={copy.inventoryGroups}>
          <button className="rail-item active"><Boxes size={16} />{copy.allSkills} <span>{snapshot.summary.total}</span></button>
          <button className="rail-item"><ShieldCheck size={16} />{copy.healthy} <span>{snapshot.summary.healthy}</span></button>
          <button className="rail-item"><AlertTriangle size={16} />{copy.needsReview} <span>{snapshot.summary.review + snapshot.summary.missing + snapshot.summary.broken}</span></button>
        </nav>
        <div className="rail-source">
          <span className="section-label">{copy.sourceOfTruth}</span>
          <code>{snapshot.canonicalRoot}</code>
        </div>
      </aside>
      <section className="skill-list" aria-label={copy.skillInventory}>
        <div className="panel-title">
          <div><p className="eyebrow">{copy.inventory}</p><h1>{skills.length} {copy.skills}</h1></div>
          <span className="quiet-copy">{copy.sortedByHealth}</span>
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
      <SkillInspector skill={selected} copy={copy} language={language} />
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
  const [working, setWorking] = useState(true)
  const [message, setMessage] = useState('')
  const [journalId, setJournalId] = useState<string | null>(null)

  const loadPreview = useCallback(async (replace: boolean) => {
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
      }))
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setWorking(false)
    }
  }, [copy.liveScanRequired, liveMode, skillId])

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
    'create-symlink': copy.createAgentLink,
    'repair-symlink': copy.repairBrokenLink,
    'replace-copy': copy.replaceIndependentCopy,
  } as const
  const changeCount = preview?.operations.length ?? 0
  const copyBlockers = preview?.blockers.filter((blocker) => blocker.code === 'copy-requires-confirmation').length ?? 0

  return (
    <div className="plan-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="plan-panel" role="dialog" aria-modal="true" aria-label={copy.reconciliationPlan} onMouseDown={(event) => event.stopPropagation()}>
        <div className="plan-title"><div><p className="eyebrow">{copy.hashBoundPreview} · {skillId}</p><h2>{copy.reconciliationPlan}</h2></div><button className="icon-button" onClick={onClose} aria-label={copy.closePreview}><X size={18} /></button></div>
        <div className="plan-scroll">
          <div className="plan-summary"><strong>{working && !preview ? '—' : changeCount}</strong><span>{preview?.status === 'blocked' ? `${preview.blockers.length} ${preview.blockers.length === 1 ? copy.blocker : copy.blockers} ${copy.blockersMustBeResolved}` : copy.verifiedChangesReady}</span></div>
          {preview?.operations.length ? (
            <ol className="plan-steps">
              {preview.operations.map((operation, index) => (
                <li key={operation.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{operationLabel[operation.kind]}</strong><p>{operation.skillId} · {operation.agentId}</p></div>
                </li>
              ))}
            </ol>
          ) : !working && <p className="plan-empty">{preview?.status === 'noop' ? copy.everythingMatches : copy.noSafeChanges}</p>}
          {preview?.blockers.length ? (
            <div className="plan-blockers">
              <span className="section-label">{copy.needsDecision}</span>
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
              <span><strong>{copy.replaceCopies}</strong><small>{copy.replaceCopiesDescription}</small></span>
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
  updatePhase,
  updateInfo,
  onPreference,
  onCheckUpdates,
  onOpenUpdates,
}: {
  preferences: Preferences
  copy: Messages
  appVersion: string
  updatePhase: UpdatePhase
  updateInfo: AppUpdateInfo | null
  onPreference: <Key extends keyof Preferences>(key: Key, value: Preferences[Key]) => void
  onCheckUpdates: () => void
  onOpenUpdates: () => void
}) {
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
          <div className="setting-row">
            <div><strong>{copy.accentColor}</strong><span>{copy.accentDescription}</span></div>
            <div className="accent-options" role="radiogroup" aria-label={copy.accentColor}>
              {accents.map((accent) => (
                <button
                  key={accent}
                  className={preferences.accent === accent ? 'selected' : ''}
                  role="radio"
                  aria-checked={preferences.accent === accent}
                  aria-label={accentLabels[accent]}
                  title={accentLabels[accent]}
                  onClick={() => onPreference('accent', accent)}
                >
                  <span className={`accent-swatch swatch-${accent}`} />
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Languages size={18} aria-hidden="true" />
            <div><h2>{copy.language}</h2><p>{copy.languageDescription}</p></div>
          </div>
          <label className="setting-row">
            <div><strong>{copy.appLanguage}</strong><span>{copy.languageDescription}</span></div>
            <select value={preferences.language} onChange={(event) => onPreference('language', event.target.value as LanguagePreference)}>
              <option value="system">{copy.followSystem}</option>
              <option value="en">{copy.english}</option>
              <option value="zh-CN">{copy.simplifiedChinese}</option>
            </select>
          </label>
          <div className="setting-row font-row">
            <div><strong>{copy.chineseFont}</strong><span>{copy.chineseFontDescription}</span></div>
            <span className="font-sample" lang="zh-CN">技能账本</span>
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
                {updatePhase === 'success' && updateInfo?.available && `${copy.updateAvailable}: ${updateInfo.latestVersion}`}
                {updatePhase === 'success' && updateInfo && !updateInfo.available && `${copy.upToDate} (${updateInfo.latestVersion})`}
              </span>
            </div>
            {updateInfo?.available && updatePhase === 'success' ? (
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
  const [planOpen, setPlanOpen] = useState(false)
  const [liveMode, setLiveMode] = useState(false)
  const [view, setView] = useState<View>('inventory')
  const [preferences, setPreferences] = useState(readPreferences)
  const [appVersion, setAppVersion] = useState('—')
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle')
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const automaticUpdateChecked = useRef(false)
  const language = resolveLanguage(preferences.language)
  const copy = messages[language]

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

  const checkUpdates = useCallback(async () => {
    if (!window.skillLedger) return
    setUpdatePhase('checking')
    try {
      const next = await window.skillLedger.checkForUpdates()
      setAppVersion(next.currentVersion)
      setUpdateInfo(next)
      setUpdatePhase('success')
    } catch {
      setUpdatePhase('error')
    }
  }, [])

  const setPreference = useCallback(<Key extends keyof Preferences>(key: Key, value: Preferences[Key]) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    void window.skillLedger?.getAppVersion().then(setAppVersion).catch(() => undefined)
  }, [])

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
    root.lang = language
    applyTheme()
    colorScheme.addEventListener('change', applyTheme)
    return () => colorScheme.removeEventListener('change', applyTheme)
  }, [language, preferences])

  useEffect(() => {
    if (!preferences.automaticUpdates || automaticUpdateChecked.current) return
    automaticUpdateChecked.current = true
    void checkUpdates()
  }, [checkUpdates, preferences.automaticUpdates])

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
    <div className={`app view-${view}`}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <div><strong>SkillLedger</strong><small>{copy.tagline}</small></div>
        </div>
        <nav className="primary-nav" aria-label={copy.primaryNavigation}>
          <button className={view === 'inventory' ? 'active' : ''} onClick={() => setView('inventory')}><Boxes size={16} />{copy.inventory}</button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings size={16} />{copy.settings}</button>
        </nav>
        {view === 'inventory' && (
          <div className="header-actions">
            <span className={`mode-badge ${liveMode ? 'live' : ''}`}>{liveMode ? copy.liveScan : copy.demoData}</span>
            <button className="secondary-button" onClick={() => setPlanOpen(true)}><SlidersHorizontal size={15} />{copy.previewPlan}</button>
            <button className="primary-button" onClick={() => void refresh()} disabled={!window.skillLedger || loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? copy.scanning : copy.scanNow}
            </button>
          </div>
        )}
      </header>

      {view === 'inventory' && (
        <div className="control-bar">
          <div className="control-context">
            <Boxes size={16} aria-hidden="true" />
            <span><strong>{copy.globalInventory}</strong><small>{copy.ledgerView}</small></span>
          </div>
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">{copy.searchSkills}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
            <kbd><Command size={11} />K</kbd>
          </label>
          <label className="health-filter">
            <span className="sr-only">{copy.filterByHealth}</span>
            <select value={health} onChange={(event) => setHealth(event.target.value as HealthFilter)}>
              <option value="all">{copy.allStates}</option>
              <option value="healthy">{copy.healthy}</option>
              <option value="review">{copy.review}</option>
              <option value="missing">{copy.missing}</option>
              <option value="broken">{copy.broken}</option>
            </select>
          </label>
        </div>
      )}

      <main>
        {view === 'inventory' ? (
          <LedgerView skills={skills} selected={selected} onSelect={setSelectedId} snapshot={snapshot} copy={copy} language={language} />
        ) : (
          <SettingsView
            preferences={preferences}
            copy={copy}
            appVersion={appVersion}
            updatePhase={updatePhase}
            updateInfo={updateInfo}
            onPreference={setPreference}
            onCheckUpdates={() => void checkUpdates()}
            onOpenUpdates={() => void window.skillLedger?.openUpdatesPage()}
          />
        )}
      </main>

      <footer className="app-footer">
        <span><span className="footer-dot" />{copy.scanned} {new Date(snapshot.scannedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}</span>
        <span>{snapshot.warnings.length ? `${snapshot.warnings.length} ${copy.scanWarnings}` : copy.readOnlyMode}</span>
      </footer>
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
