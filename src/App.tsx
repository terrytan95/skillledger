import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Activity,
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileCheck2,
  GitBranch,
  HardDrive,
  Languages,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import type {
  ActivitySnapshot,
  AppUpdateStatus,
  InventorySnapshot,
  TeamStatus,
} from './types'
import { messages, type Language, type Messages } from './i18n'
import { demoSnapshot } from './demo'
import {
  InventoryHeaderActions,
  InventoryWorkspace,
  InventoryWorkspaceView,
  type InventoryWorkspaceHandle,
} from './InventoryWorkspace'
import {
  applyPreferences,
  automaticUpdateIntervalMs,
  defaultPreferences,
  persistPreferences,
  preferenceOptions,
  readPreferences,
  resolveLanguage,
  updatePreference,
  type Accent,
  type FontFamily,
  type LanguagePreference,
  type Preferences,
  type ThemeMode,
} from './preferences'
import appIcon from '../build/icon.svg'
import './App.css'

type View = 'inventory' | 'activity' | 'team' | 'settings'

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
  const [fontSizeDragging, setFontSizeDragging] = useState(false)
  const fontSizeInput = useRef<HTMLInputElement>(null)
  const fontSizes = preferenceOptions.fontSize
  const fontSizeProgress = (preferences.fontSize - fontSizes[0]) / (fontSizes.at(-1)! - fontSizes[0]) * 100
  const fontSizeThumbPosition = 5 + (preferences.fontSize - fontSizes[0]) * 10
  const themeLabels: Record<ThemeMode, string> = {
    system: copy.system,
    light: copy.light,
    dark: copy.dark,
  }
  const themeIcons = { system: Monitor, light: Sun, dark: Moon }
  const themeOptions = preferenceOptions.theme.map((value) => ({
    value,
    label: themeLabels[value],
    Icon: themeIcons[value],
  }))
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
  const languageLabels: Record<LanguagePreference, string> = {
    system: copy.followSystem,
    en: copy.english,
    'zh-CN': copy.simplifiedChinese,
  }
  const fontFamilyLabels: Record<FontFamily, string> = {
    system: copy.fontDefault,
    sans: copy.fontSans,
    serif: copy.fontSerif,
    mono: copy.fontMono,
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
                {preferenceOptions.accent.map((accent) => (
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
              {preferenceOptions.language.map((value) => (
                <option value={value} key={value}>{languageLabels[value]}</option>
              ))}
            </select>
          </label>
          <label className="setting-row">
            <div><strong>{copy.interfaceFont}</strong><span>{copy.interfaceFontDescription}</span></div>
            <select value={preferences.fontFamily} onChange={(event) => onPreference('fontFamily', event.target.value as FontFamily)}>
              {preferenceOptions.fontFamily.map((value) => (
                <option value={value} key={value}>{fontFamilyLabels[value]}</option>
              ))}
            </select>
          </label>
          <div className="font-size-row">
            <div className="font-size-row-heading">
              <div>
                <strong id="font-size-label">{copy.interfaceFontSize}</strong>
                <span id="font-size-description">{copy.fontSizeDragDescription}</span>
              </div>
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
                aria-valuetext={`${preferences.fontSize} ${copy.fontSizePixels}${preferences.fontSize === defaultPreferences.fontSize ? `, ${copy.fontDefault}` : ''}`}
                onChange={(event) => onPreference('fontSize', Number(event.target.value) as Preferences['fontSize'])}
                onPointerDown={() => setFontSizeDragging(true)}
                onPointerUp={() => setFontSizeDragging(false)}
                onPointerCancel={() => setFontSizeDragging(false)}
                onBlur={() => setFontSizeDragging(false)}
              />
              <div className="font-size-ticks" aria-hidden="true">
                {fontSizes.map((size) => (
                  <span
                    className={preferences.fontSize === size ? 'selected' : ''}
                    key={size}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      onPreference('fontSize', size)
                      fontSizeInput.current?.focus()
                    }}
                  >
                    {size}
                  </span>
                ))}
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
  const [view, setView] = useState<View>('inventory')
  const [preferences, setPreferences] = useState(readPreferences)
  const [appVersion, setAppVersion] = useState('—')
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const automaticUpdateChecked = useRef(false)
  const inventoryWorkspace = useRef<InventoryWorkspaceHandle>(null)
  const language = resolveLanguage(preferences.language)
  const copy = messages[language]

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

  const setPreference = useCallback(<Key extends keyof Preferences>(key: Key, value: Preferences[Key]) => {
    setPreferences((current) => updatePreference(current, key, value))
  }, [])

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
    const apply = () => applyPreferences(preferences, language, colorScheme.matches, root)

    persistPreferences(preferences)
    apply()
    colorScheme.addEventListener('change', apply)
    return () => colorScheme.removeEventListener('change', apply)
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
      setView('inventory')
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const showView = (next: View) => {
    inventoryWorkspace.current?.closeReader()
    setView(next)
  }

  return (
    <InventoryWorkspace
      ref={inventoryWorkspace}
      active={view === 'inventory'}
      snapshot={snapshot}
      onSnapshot={setSnapshot}
      copy={copy}
      language={language}
    >
      <div className={`app view-${view}`}>
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
          {view === 'inventory' && <InventoryHeaderActions />}
        </header>

        {view === 'inventory' ? (
          <InventoryWorkspaceView />
        ) : (
          <>
            {view !== 'settings' && (
              <div className="control-bar simple">
                <div className="control-context">
                  {view === 'activity' ? <Activity size={16} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />}
                  <span>
                    <strong>{view === 'activity' ? copy.recoveryHistory : copy.teamGovernance}</strong>
                    <small>{view === 'activity' ? copy.journalAndRetention : copy.policiesAndManifests}</small>
                  </span>
                </div>
              </div>
            )}
            <main>
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
          </>
        )}

        <footer className="app-footer">
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
        </footer>
      </div>
    </InventoryWorkspace>
  )
}
