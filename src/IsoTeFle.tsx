import { useEffect, useMemo, useState } from 'react'
import {
  addLocalDays, applyTendonAdjustment, createIsoActiveSession, createIsoSessionRecord, dateFromKey,
  canRescheduleIsoTemplate, getIsoProgramme, getIsoTemplate, getScheduleWindow, getTendonAdjustment, isRecoveryDay,
  isoProgrammes, isoTemplates, localDateKey, moveIsoExercise, setIsoExerciseStatus,
  updateIsoSet, type ActiveIsoSession, type IsoExerciseDefinition, type IsoLoggedSet, type IsoProgrammeId,
  type IsoRecoveryCheck, type IsoScheduleEntry, type IsoSessionRecord, type IsoTarget,
} from './isotefleData'
import type { AppData } from './workoutStorage'
import type { ActiveJinGuSession, JinGuSession } from './jinGuData'

type View = { kind: 'dashboard' } | { kind: 'programme'; id: IsoProgrammeId } | { kind: 'history' }
type Props = { data: AppData; onChange: (change: (current: AppData) => AppData) => Promise<boolean> }

export function IsoTeFlePage({ data, onChange }: Props) {
  const [view, setView] = useState<View>({ kind: 'dashboard' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tendonEntry, setTendonEntry] = useState<IsoScheduleEntry | null>(null)
  const [soreness, setSoreness] = useState<number | null>(null)
  const [discomfort, setDiscomfort] = useState<number | null>(null)
  const [recovery, setRecovery] = useState<IsoRecoveryCheck['recovery'] | ''>('')
  const [optionalDate, setOptionalDate] = useState('')
  const today = localDateKey()
  const schedule = useMemo(() => getScheduleWindow(today, data.isoTeFleSchedule ?? [], 14), [today, data.isoTeFleSchedule])
  const records = data.isoTeFleSessions ?? []
  const active = data.activeIsoTeFleSession ?? null

  async function save(change: (current: AppData) => AppData) {
    setError('')
    const ok = await onChange(change)
    if (!ok) setError('This IsoTeFle update could not be saved. Your current session remains on this device; please retry.')
    return ok
  }

  function scheduleUpdate(entry: IsoScheduleEntry) {
    return (current: AppData): AppData => {
      const items = current.isoTeFleSchedule ?? []
      const found = items.some((item) => item.id === entry.id)
      return { ...current, isoTeFleSchedule: found ? items.map((item) => item.id === entry.id ? entry : item) : [...items, entry] }
    }
  }

  function startEntry(entry: IsoScheduleEntry, check: IsoRecoveryCheck | null = null, adjusted = false) {
    if (active || busy) return
    const created = createIsoActiveSession(entry, Date.now(), check)
    const session = entry.programmeId === 'tendon' ? applyTendonAdjustment(created, adjusted) : created
    setBusy(true)
    void save((current) => {
      if (current.activeIsoTeFleSession || (current.isoTeFleSessions ?? []).some((item) => item.scheduleId === entry.id)) return current
      const latest = current.isoTeFleSchedule ?? []
      const saved = latest.find((item) => item.id === entry.id) ?? entry
      return {
        ...current,
        activeIsoTeFleSession: session,
        isoTeFleSchedule: latest.some((item) => item.id === entry.id)
          ? latest.map((item) => item.id === entry.id ? { ...saved, status: 'in-progress', updatedAt: Date.now() } : item)
          : [...latest, { ...entry, status: 'in-progress', updatedAt: Date.now() }],
      }
    }).finally(() => setBusy(false))
    setTendonEntry(null)
  }

  function markSkipped(entry: IsoScheduleEntry) {
    const skipped = { ...entry, status: 'skipped' as const, updatedAt: Date.now() }
    void save(scheduleUpdate(skipped))
    setTendonEntry(null)
  }

  function reschedule(entry: IsoScheduleEntry, newDate: string) {
    if (!newDate || newDate <= today) { setError('Choose a future date.'); return }
    if (!canRescheduleIsoTemplate(entry.templateId, newDate, schedule, entry.id)) { setError('Choose an available training day. Demanding sessions cannot be moved to recovery days or stacked on another demanding session.'); return }
    void save(scheduleUpdate({ ...entry, scheduledDate: newDate, status: 'rescheduled', updatedAt: Date.now() }))
  }

  function begin(entry: IsoScheduleEntry) {
    if (entry.status === 'completed' || entry.status === 'skipped' || active) return
    if (entry.programmeId === 'tendon') {
      setSoreness(null)
      setDiscomfort(null)
      setRecovery('')
      setTendonEntry(entry)
      return
    }
    startEntry(entry)
  }

  async function updateActive(change: (current: ActiveIsoSession) => ActiveIsoSession) {
    if (!active) return false
    return save((current) => current.activeIsoTeFleSession?.id === active.id
      ? { ...current, activeIsoTeFleSession: change(current.activeIsoTeFleSession) }
      : current)
  }

  function finishSession() {
    if (!active || busy) return
    if (!window.confirm('Save this IsoTeFle session? Recorded work will be kept. Incomplete movements will remain marked as skipped.')) return
    const remaining = active.exercises.filter((item) => !item.completed && !item.skipped)
    const completedSession = { ...active, exercises: active.exercises.map((item) => remaining.includes(item) ? { ...item, skipped: true } : item) }
    const record = createIsoSessionRecord(completedSession, Date.now())
    setBusy(true)
    void save((current) => {
      if (current.isoTeFleSessions?.some((item) => item.id === record.id)) return current
      if (current.activeIsoTeFleSession?.id !== record.id) return current
      const entries = current.isoTeFleSchedule ?? []
      return {
        ...current,
        activeIsoTeFleSession: null,
        isoTeFleSessions: [record, ...(current.isoTeFleSessions ?? [])],
        isoTeFleSchedule: entries.map((item) => item.id === record.scheduleId ? { ...item, status: 'completed', updatedAt: Date.now() } : item),
      }
    }).finally(() => setBusy(false))
    setView({ kind: 'history' })
  }

  function cancelActive() {
    if (!active || busy || !window.confirm('Pause and leave this session? Your progress will be saved so you can resume later.')) return
    void updateActive((current) => ({ ...current, paused: true, pausedAt: current.pausedAt ?? Date.now(), timerRemainingSeconds: current.timerDeadline ? Math.max(0, Math.ceil((current.timerDeadline - Date.now()) / 1000)) : current.timerRemainingSeconds, timerDeadline: null, restTimerRemainingSeconds: current.restTimerDeadline ? Math.max(0, Math.ceil((current.restTimerDeadline - Date.now()) / 1000)) : current.restTimerRemainingSeconds, restTimerDeadline: null }))
  }

  return (
    <section className="isotefle-page">
      <header className="isotefle-heading">
        <div><span className="eyebrow">CONTROL · CAPACITY · RANGE</span><h1>IsoTeFle</h1><p className="page-subtitle">Three complementary practices alongside your gym training. Sessions save independently from gym workouts.</p></div>
        <div className="isotefle-view-tabs" role="group" aria-label="IsoTeFle views">
          <button type="button" className={view.kind === 'dashboard' ? 'selected' : ''} onClick={() => setView({ kind: 'dashboard' })}>Today</button>
          {isoProgrammes.map((item) => <button key={item.id} type="button" className={view.kind === 'programme' && view.id === item.id ? 'selected' : ''} onClick={() => setView({ kind: 'programme', id: item.id })}>{item.name}</button>)}
          <button type="button" className={view.kind === 'history' ? 'selected' : ''} onClick={() => setView({ kind: 'history' })}>Progress & history</button>
        </div>
      </header>
      {error && <p className="isotefle-error" role="alert">{error}</p>}
      {active ? <SessionRunner session={active} records={records} onUpdate={updateActive} onFinish={finishSession} onPause={cancelActive} busy={busy} />
        : tendonEntry ? <TendonCheck entry={tendonEntry} previous={records.find((item) => item.programmeId==='tendon')} soreness={soreness} discomfort={discomfort} recovery={recovery} setSoreness={setSoreness} setDiscomfort={setDiscomfort} setRecovery={setRecovery} onStart={(check, adjusted) => startEntry(tendonEntry, check, adjusted)} onSkip={() => markSkipped(tendonEntry)} onReschedule={(date) => reschedule(tendonEntry, date)} onBack={() => setTendonEntry(null)} />
          : view.kind === 'programme' ? <ProgrammeView id={view.id} schedule={schedule} records={records} onStart={begin} />
            : view.kind === 'history' ? <HistoryView records={records} archived={data.jinGuSessions ?? []} archivedActive={data.activeJinGuSession ?? null} />
              : <Dashboard today={today} schedule={schedule} records={records} active={active} onOpen={(id) => setView({ kind: 'programme', id })} onStart={begin} onSkip={markSkipped} onReschedule={reschedule} onHistory={() => setView({ kind: 'history' })} onOptionalMobility={(date) => {
                const entry: IsoScheduleEntry = { id: `mobility-flow:${date}:optional`, templateId: 'mobility-flow', programmeId: 'mobility', originalDate: date, scheduledDate: date, status: 'scheduled', optional: true, updatedAt: Date.now() }
                if (date < today) { setError('Choose today or a future date.'); return }
                startEntry(entry)
              }} optionalDate={optionalDate || today} setOptionalDate={setOptionalDate} />}
      {error && <p className="isotefle-error" role="alert">{error}</p>}
    </section>
  )
}

let tickNow = Date.now()

function Dashboard({ today, schedule, records, active, onOpen, onStart, onSkip, onReschedule, onHistory, onOptionalMobility, optionalDate, setOptionalDate }: {
  today: string; schedule: IsoScheduleEntry[]; records: IsoSessionRecord[]; active: ActiveIsoSession | null
  onOpen: (id: IsoProgrammeId) => void; onStart: (entry: IsoScheduleEntry) => void; onSkip: (entry: IsoScheduleEntry) => void
  onReschedule: (entry: IsoScheduleEntry, date: string) => void; onHistory: () => void; onOptionalMobility: (date: string) => void
  optionalDate: string; setOptionalDate: (date: string) => void
}) {
  const todayEntries = schedule.filter((item) => item.scheduledDate === today && item.status !== 'skipped')
  const completedToday = records.find((item) => item.completedAt && item.scheduledDate === today && item.scheduleId === todayEntries[0]?.id)
  const scheduledToday = todayEntries[0]
  const todayTitle = active ? active.templateId : completedToday ? 'completed' : scheduledToday ? scheduledToday.templateId : isRecoveryDay(today) ? 'recovery' : 'none'
  const upcoming = schedule.filter((item) => item.scheduledDate >= today && item.status !== 'skipped' && item.status !== 'completed').slice(0, 8)
  return <>
    <section className="isotefle-today field-rotation-card current">
      <div className="isotefle-today-kicker"><span className="eyebrow">TODAY’S TRAINING · {new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(dateFromKey(today))}</span><span className="isotefle-today-state">{active ? 'IN PROGRESS' : completedToday ? 'COMPLETED' : scheduledToday ? scheduledToday.optional ? 'OPTIONAL' : scheduledToday.status.toUpperCase() : isRecoveryDay(today) ? 'RECOVERY DAY' : 'NO SCHEDULE'}</span></div>
      <h2>{todayTitle === 'recovery' ? 'Recovery day' : todayTitle === 'none' ? 'No scheduled session' : todayTitle === 'completed' ? 'Today’s session is complete' : getIsoTemplate(todayTitle)?.name ?? getIsoTemplate(active?.templateId ?? '')?.name ?? 'Session in progress'}</h2>
      <p>{active ? 'Your session is saved on this device. Resume where you left off.' : completedToday ? 'Review the recorded work in Progress & history.' : scheduledToday ? `${getIsoTemplate(scheduledToday.templateId)?.durationMinutes ?? '—'} min · ${getIsoTemplate(scheduledToday.templateId)?.exercises.length ?? 0} exercises.${scheduledToday.optional?' This session is optional.':''} The gym rotation remains independent.` : isRecoveryDay(today) ? 'Keep today recovery-oriented. Light mobility is optional; rest is always a valid choice.' : 'Your next IsoTeFle session stays on its fixed weekday; missed sessions do not roll forward.'}</p>
      {active ? <div className="isotefle-today-actions"><span>{active.exercises.filter((item)=>item.completed).length} / {active.exercises.length} movements complete</span></div> : completedToday ? <button className="button-primary" type="button" onClick={onHistory}>Review session <span aria-hidden="true">→</span></button> : scheduledToday ? <div className="isotefle-today-actions"><button className="button-primary" type="button" onClick={()=>onStart(scheduledToday)}>Start session <span aria-hidden="true">→</span></button><button type="button" className="button-text" onClick={()=>onSkip(scheduledToday)}>Skip this date</button><label className="isotefle-inline-date">Move to <input type="date" min={addLocalDays(today,1)} value={optionalDate} onChange={(event)=>setOptionalDate(event.currentTarget.value)} /><button type="button" className="button-text" onClick={()=>onReschedule(scheduledToday,optionalDate)}>Reschedule</button></label></div> : <button className="button-text" type="button" onClick={()=>onOptionalMobility(today)}>Optional light mobility today</button>}
    </section>
    <div className="isotefle-programme-grid">{isoProgrammes.map((programme)=>{
      const programmeSchedule=schedule.filter((item)=>item.programmeId===programme.id&&item.scheduledDate>=today&&item.status!=='skipped'&&item.status!=='completed')
      const latest=records.find((item)=>item.programmeId===programme.id)
      const progress=records.filter((item)=>item.programmeId===programme.id&&item.status==='completed').length
      const next=programmeSchedule[0]
      return <button type="button" className="isotefle-programme-row" key={programme.id} onClick={()=>onOpen(programme.id)}><span className="eyebrow">{programme.frequency}</span><strong>{programme.name}</strong><span>{programme.description}</span><small>NEXT · {next?`${formatShortDate(next.scheduledDate)} · ${getIsoTemplate(next.templateId)?.name}`:'No upcoming session'}{latest?`  /  LAST · ${formatShortDate(latest.scheduledDate)}`:'  /  NO HISTORY'}  /  {progress} complete</small></button>
    })}</div>
    <section className="isotefle-schedule"><div className="isotefle-section-title"><span className="eyebrow">FIXED WEEKLY PLAN</span><h2>Upcoming sessions</h2></div><p className="isotefle-schedule-note">The IsoTeFle schedule is fixed by weekday. Gym sessions remain on their separate rolling rotation; this view cannot predict when Core & Legs will occur.</p>
      <div className="isotefle-schedule-list">{upcoming.map((entry)=>{const template=getIsoTemplate(entry.templateId)!;const past=entry.scheduledDate<today;const status=entry.status==='scheduled'&&past?'MISSED':entry.optional&&entry.status==='scheduled'?'OPTIONAL':entry.status.toUpperCase();return <div key={entry.id} className="isotefle-schedule-row"><time dateTime={entry.scheduledDate}>{formatShortDate(entry.scheduledDate)}</time><div><strong>{template.name}</strong><span>{getIsoProgramme(entry.programmeId).name} · {template.durationMinutes} min</span></div><small>{status}</small>{entry.status==='scheduled'&&!past&&<div className="isotefle-schedule-actions"><button type="button" onClick={()=>onSkip(entry)}>Skip</button><input aria-label={`Reschedule ${template.name}`} type="date" min={addLocalDays(today,1)} onChange={(event)=>onReschedule(entry,event.currentTarget.value)} /></div>}</div>})}</div>
    </section>
    <div className="isotefle-recovery-note"><span className="eyebrow">RECOVERY DAYS</span><strong>Wednesday · Saturday · Sunday</strong><p>Keep these days recovery-oriented. Mobility can be light and optional; no demanding IsoTeFle session will be automatically moved here.</p><button type="button" className="button-text" onClick={()=>onOptionalMobility(today)}>Offer optional light mobility today</button></div>
  </>
}

function ProgrammeView({ id, schedule, records, onStart }: { id: IsoProgrammeId; schedule: IsoScheduleEntry[]; records: IsoSessionRecord[]; onStart: (entry: IsoScheduleEntry) => void }) {
  const programme=getIsoProgramme(id), templates=isoTemplates.filter((item)=>item.programmeId===id)
  const next=schedule.find((item)=>item.programmeId===id&&item.status!=='completed'&&item.status!=='skipped'&&item.scheduledDate>=localDateKey())
  const latest=records.find((item)=>item.programmeId===id)
  return <section className="isotefle-programme-page"><header><span className="eyebrow">{programme.frequency}</span><h2>{programme.name}</h2><p>{programme.description}</p></header>
    {templates.map((template)=><article className="isotefle-template" key={template.id}><div className="isotefle-template-heading"><div><span className="eyebrow">{formatShortDate(next?.scheduledDate ?? '')} · {template.durationMinutes} MIN</span><h3>{template.name}</h3><p>{template.description}</p></div>{next?.templateId===template.id&&<button className="button-primary" type="button" onClick={()=>onStart(next)}>Start session</button>}</div>
      <div className="isotefle-exercise-list">{template.exercises.map((definition,index)=><IsoExerciseDescription key={`${template.id}-${definition.id}-${index}`} definition={definition} index={index} />)}</div>
    </article>)}
    <ProgressSummary programmeId={id} records={records} />
    {latest&&<p className="isotefle-last-performance">LATEST · {formatShortDate(latest.scheduledDate)} · {formatDuration(latest.durationSeconds)} · {latest.status.toUpperCase()}{latest.recoveryCheck?` · soreness ${latest.recoveryCheck.soreness}/10 · discomfort ${latest.recoveryCheck.discomfort}/10`:''}</p>}
  </section>
}

function IsoExerciseDescription({definition,index}:{definition:IsoExerciseDefinition;index:number}) {
  return <details className="isotefle-exercise-description"><summary><span>{String(index+1).padStart(2,'0')}</span><div><small>{targetLabel(definition.target,definition.sets)}</small><strong>{definition.name}</strong></div><em>{definition.focus}</em></summary><div className="isotefle-instruction-grid"><p><b>SETUP</b>{definition.instructions.setup}</p><p><b>TECHNIQUE</b>{definition.instructions.technique}</p><p><b>WORKING AREA</b>{definition.instructions.area}</p><p><b>COMMON MISTAKES</b>{definition.instructions.mistakes}</p><p><b>EASIER</b>{definition.instructions.easier}</p><p><b>HARDER</b>{definition.instructions.harder}</p><p><b>STOP</b>{definition.instructions.stop}</p>{definition.instructions.breathing&&<p><b>BREATHING</b>{definition.instructions.breathing}</p>}</div></details>
}

function TendonCheck({entry,previous,soreness,discomfort,recovery,setSoreness,setDiscomfort,setRecovery,onStart,onSkip,onReschedule,onBack}:{entry:IsoScheduleEntry;previous?:IsoSessionRecord;soreness:number|null;discomfort:number|null;recovery:IsoRecoveryCheck['recovery']|'';setSoreness:(value:number|null)=>void;setDiscomfort:(value:number|null)=>void;setRecovery:(value:IsoRecoveryCheck['recovery']|'')=>void;onStart:(check:IsoRecoveryCheck,adjusted:boolean)=>void;onSkip:()=>void;onReschedule:(date:string)=>void;onBack:()=>void}) {
  const check:IsoRecoveryCheck|null=soreness===null||discomfort===null||recovery===''?null:{soreness,discomfort,recovery,adjusted:false},suggestion=check?getTendonAdjustment(check):null
  const [moveDate,setMoveDate]=useState('')
  return <section className="isotefle-tendon-check"><span className="eyebrow">{formatShortDate(entry.scheduledDate)} · LOAD CHECK</span><h2>How are your legs recovering?</h2><p>Session B includes calf holds and this session includes calf loading. Use your current soreness, discomfort and recovery to choose a comfortable amount. This is a training choice, not a diagnosis.</p>
    {previous?.recoveryCheck&&<p className="isotefle-soreness-history">LAST LOGGED · {formatShortDate(previous.scheduledDate)} · soreness {previous.recoveryCheck.soreness}/10 · discomfort {previous.recoveryCheck.discomfort}/10 · recovery {previous.recoveryCheck.recovery}</p>}
    <label>Soreness today <select value={soreness??''} onChange={(event)=>setSoreness(event.currentTarget.value===''?null:Number(event.currentTarget.value))}><option value="">Choose current level</option>{Array.from({length:11},(_,value)=><option value={value} key={value}>{value} / 10</option>)}</select></label>
    <label>Discomfort today <select value={discomfort??''} onChange={(event)=>setDiscomfort(event.currentTarget.value===''?null:Number(event.currentTarget.value))}><option value="">Choose current level</option>{Array.from({length:11},(_,value)=><option value={value} key={value}>{value} / 10</option>)}</select></label>
    <label>Overall recovery <select value={recovery} onChange={(event)=>setRecovery(event.currentTarget.value as IsoRecoveryCheck['recovery']|'')}><option value="">Choose recovery</option><option value="good">Good</option><option value="usual">Usual</option><option value="low">Low</option></select></label>
    <div className="isotefle-adjustment-advice"><b>{suggestion===null?'Record all three before selecting a plan':suggestion==='standard'?'Standard work may feel appropriate':suggestion==='reduce'?'A reduced session is suggested':'Skipping or rescheduling is suggested'}</b><span>Logged values are saved with the session. No weight is assumed. You can choose bodyweight resistance, reduce the set count and target, or record fewer reps.</span></div>
    <div className="isotefle-today-actions"><button className="button-primary" type="button" disabled={!check} onClick={()=>check&&onStart(check,suggestion!=='standard')}>{suggestion==='standard'?'Start session':suggestion==='reduce'?'Start reduced session':'Start with reduced sets'}</button>{suggestion==='reduce'&&<button type="button" disabled={!check} onClick={()=>check&&onStart(check,false)}>Use standard plan</button>}<button type="button" className="button-text" onClick={onSkip}>Skip this week</button><label className="isotefle-inline-date">Reschedule to <input type="date" min={addLocalDays(localDateKey(),1)} value={moveDate} onChange={(event)=>setMoveDate(event.currentTarget.value)} /><button type="button" className="button-text" onClick={()=>onReschedule(moveDate)}>Move session</button></label><button type="button" className="button-text" onClick={onBack}>Back</button></div>
  </section>
}

function SessionRunner({session,records,onUpdate,onFinish,onPause,busy}:{session:ActiveIsoSession;records:IsoSessionRecord[];onUpdate:(change:(current:ActiveIsoSession)=>ActiveIsoSession)=>Promise<boolean>;onFinish:()=>void;onPause:()=>void;busy:boolean}) {
  const template=getIsoTemplate(session.templateId)!,current=session.exercises[session.currentExerciseIndex]
  const definition=template.exercises.find((item)=>item.id===current.exerciseId)??template.exercises[0]
  const completed=session.exercises.filter((item)=>item.completed).length, percentage=Math.round(completed/session.exercises.length*100)
  const previous=records.find((item)=>item.templateId===session.templateId)
  const [,renderTick]=useState(0)
  const [entryError,setEntryError]=useState('')
  const now=()=>tickNow
  useEffect(()=>{const id=window.setInterval(()=>{tickNow=Date.now();renderTick((n)=>n+1)},250);return()=>window.clearInterval(id)},[])
  const holdRemaining=session.timerDeadline?Math.max(0,Math.ceil((session.timerDeadline-now())/1000)):session.timerRemainingSeconds
  const restRemaining=session.restTimerDeadline?Math.max(0,Math.ceil((session.restTimerDeadline-now())/1000)):session.restTimerRemainingSeconds
  const target=getDisplayedTarget(definition,session)
  const sideNames=target.sides
  const currentSet=current?.sets.find((set)=>!set.completed)
  const timerSet=currentSet
  const timerSideName=sideNames?.[Math.min(session.timerSide,sideNames.length-1)]
  function persist(change:(value:ActiveIsoSession)=>ActiveIsoSession){void onUpdate(change)}
  function startHold(){if(!timerSet||target.kind!=='hold'||session.paused)return;persist((value)=>({...value,timerRemainingSeconds:value.timerRemainingSeconds>0?value.timerRemainingSeconds:target.maxSeconds,timerDeadline:Date.now()+(value.timerRemainingSeconds>0?value.timerRemainingSeconds:target.maxSeconds)*1000}))}
  function pauseHold(){persist((value)=>({...value,timerRemainingSeconds:value.timerDeadline?Math.max(0,Math.ceil((value.timerDeadline-Date.now())/1000)):value.timerRemainingSeconds,timerDeadline:null}))}
  function logHoldTimer(){if(!timerSet||target.kind!=='hold')return;const elapsed=Math.max(1,target.maxSeconds-holdRemaining);persist((value)=>{const updated=updateIsoSet(value,current.exerciseId,timerSet.id,(item)=>{if(!sideNames)return {...item,durationSeconds:elapsed,completed:true};const key=session.timerSide===0?'leftValue':'rightValue';const next={...item,[key]:elapsed};return {...next,completed:next.leftValue!==null&&next.rightValue!==null}});return {...updated,timerDeadline:null,timerRemainingSeconds:0,timerSide:sideNames?1-session.timerSide:0}})}
  function pauseSession(){if(session.paused){const pausedFor=session.pausedAt?Date.now()-session.pausedAt:0;persist((value)=>({...value,paused:false,pausedAt:null,pausedDurationMs:value.pausedDurationMs+pausedFor,timerDeadline:value.timerRemainingSeconds?Date.now()+value.timerRemainingSeconds*1000:null,restTimerDeadline:value.restTimerRemainingSeconds?Date.now()+value.restTimerRemainingSeconds*1000:null}))}else{persist((value)=>({...value,paused:true,pausedAt:Date.now(),timerRemainingSeconds:value.timerDeadline?Math.max(0,Math.ceil((value.timerDeadline-Date.now())/1000)):value.timerRemainingSeconds,timerDeadline:null,restTimerRemainingSeconds:value.restTimerDeadline?Math.max(0,Math.ceil((value.restTimerDeadline-Date.now())/1000)):value.restTimerRemainingSeconds,restTimerDeadline:null}))}}
  function updateSet(setId:string,change:(item:IsoLoggedSet)=>IsoLoggedSet){persist((value)=>updateIsoSet(value,current.exerciseId,setId,change))}
  function inputNumber(event:React.ChangeEvent<HTMLInputElement>,field:'weightKg'|'reps'|'durationSeconds'|'leftValue'|'rightValue'){const raw=event.currentTarget.value;const parsed=raw===''?null:Number(raw);if(parsed!==null&&(!Number.isFinite(parsed)||parsed<0||parsed>1000))return;updateSet(event.currentTarget.dataset.setid??'',(item)=>({...item,[field]:parsed}))}
  function markSet(set:IsoLoggedSet){updateSet(set.id,(item)=>({...item,completed:!item.completed}))}
  function exerciseStatus(status:'completed'|'skipped'){if(status==='completed'&&!current.sets.some((set)=>set.completed)){setEntryError('Log at least one actual set before marking this movement complete. Or choose Skip movement.');return}setEntryError('');persist((value)=>setIsoExerciseStatus(value,current.exerciseId,status))}
  const selectedVariation=definition.variations.find((item)=>item.id===current.variationId)??definition.variations[0]
  const loadOptional=selectedVariation.resistance==='optional-dumbbell'
  const prevExercise=template.exercises[session.currentExerciseIndex-1],nextExercise=template.exercises[session.currentExerciseIndex+1]
  return <section className="isotefle-session field-workout panel">
    <header className="isotefle-session-header"><div><span className="eyebrow">{getIsoProgramme(session.programmeId).name.toUpperCase()} · {formatShortDate(session.scheduledDate)}</span><h2>{template.name}</h2><p>{session.paused?'Session paused. Your recorded work is saved.':'Session in progress · independent from gym rotation and XP.'}</p></div><div className="isotefle-session-header-actions"><button type="button" onClick={pauseSession}>{session.paused?'Resume':'Pause'}</button><button type="button" onClick={onPause}>Leave session</button></div></header>
    <div className="isotefle-session-progress"><div><span>{completed} / {template.exercises.length} movements complete</span><span>{percentage}%</span></div><div><i style={{width:`${percentage}%`}} /></div></div>
    <div className="isotefle-exercise-navigation">{session.exercises.map((item,index)=><button key={item.exerciseId} type="button" className={index===session.currentExerciseIndex?'current':item.completed?'done':''} aria-label={`Go to ${item.name}`} onClick={()=>persist((value)=>moveIsoExercise(value,index))}>{String(index+1).padStart(2,'0')}</button>)}</div>
    <article className="session-exercise exercise-current">
      <div className="session-exercise-heading"><span className="exercise-number">{String(session.currentExerciseIndex+1).padStart(2,'0')}</span><div className="session-exercise-title"><h3>{definition.name}</h3><span>{definition.focus}</span></div><span className={`exercise-state ${current.completed?'done':''}`}>{current.completed?'DONE':'IN PROGRESS'}</span></div>
      <p className="exercise-instructions">{definition.instructions.setup} {definition.instructions.technique}</p>
      <div className="exercise-target">Target · {targetLabel(target,session.recoveryCheck?.adjusted&&session.programmeId==='tendon'?Math.max(1,definition.sets-1):definition.sets)}</div>
      {previous&&<p className="isotefle-previous">PREVIOUS · {formatShortDate(previous.scheduledDate)} · {previous.exercises.find((item)=>item.exerciseId===definition.id)?.sets.filter((item)=>item.completed).map(formatSet).join(' · ')||'No completed sets recorded'}</p>}
      <details className="isotefle-runner-instructions"><summary>Technique, options & safety</summary><div><p><b>WORKING AREA</b> {definition.instructions.area}</p><p><b>COMMON MISTAKES</b> {definition.instructions.mistakes}</p><p><b>EASIER</b> {definition.instructions.easier}</p><p><b>HARDER</b> {definition.instructions.harder}</p><p><b>STOP</b> {definition.instructions.stop}</p>{definition.instructions.breathing&&<p><b>BREATHING</b> {definition.instructions.breathing}</p>}</div></details>
      {definition.variations.length>1&&<label className="isotefle-variation">Variation<select value={current.variationId} disabled={session.paused||current.sets.some((set)=>set.completed)} onChange={(event)=>{const variationId=event.currentTarget.value;persist((value)=>({...value,exercises:value.exercises.map((item)=>item.exerciseId===current.exerciseId?{...item,variationId,sets:item.sets.map((set)=>set.completed?set:{...set,weightKg:null})}:item)}))}}>{definition.variations.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{current.sets.some((set)=>set.completed)&&<small>Variation locked after the first completed set.</small>}</label>}
      {target.kind==='hold'&&<div className="isotefle-hold-timer"><div><span className="eyebrow">HOLD TIMER · {timerSideName?`${timerSideName.toUpperCase()} · `:''}TARGET {target.minSeconds}–{target.maxSeconds}s</span><strong>{formatClock(holdRemaining)}</strong></div>{sideNames&&<div className="isotefle-side-select" role="group" aria-label="Side to time">{sideNames.map((side,index)=><button key={side} type="button" className={session.timerSide===index?'selected':''} disabled={session.paused} onClick={()=>persist((value)=>({...value,timerSide:index,timerDeadline:null,timerRemainingSeconds:0}))}>{side}</button>)}</div>}<button type="button" disabled={session.paused||!currentSet} onClick={session.timerDeadline?pauseHold:startHold}>{session.timerDeadline?'Pause timer':'Start hold'}</button>{(session.timerDeadline!==null||session.timerRemainingSeconds>0)&&<button type="button" className="isotefle-log-timer" disabled={session.paused||!currentSet||holdRemaining>=target.maxSeconds} onClick={logHoldTimer}>Log {timerSideName?`${timerSideName} `:''}{Math.max(1,target.maxSeconds-holdRemaining)}s</button>}</div>}
      {entryError&&<p className="isotefle-error" role="alert">{entryError}</p>}
      <div className="set-table"><div className={`set-row set-labels field-set-row ${sideNames?'set-row-sides':''}`} aria-hidden="true"><span>SET</span><span>PREVIOUS</span>{loadOptional?<span>KG</span>:<span>LOAD</span>}{sideNames?<><span>{sideNames[0].toUpperCase()} {target.kind==='hold'?'SEC':'REPS'}</span><span>{sideNames[1].toUpperCase()} {target.kind==='hold'?'SEC':'REPS'}</span></>:<span>{target.kind==='hold'?'SEC':'REPS'}</span>}<span>DONE</span><span /></div>
        {current.sets.map((set,index)=><div key={set.id} className={`set-row field-set-row ${sideNames?'set-row-sides':''} ${set.completed?'field-set-completed':''} ${set===currentSet?'field-set-current':''}`}><span className="set-index">{String(index+1).padStart(2,'0')}</span><span className="field-previous-value">{previous?.exercises.find((item)=>item.exerciseId===definition.id)?.sets[index]?formatSet(previous.exercises.find((item)=>item.exerciseId===definition.id)!.sets[index]):'—'}</span><input aria-label={`${definition.name} set ${index+1} dumbbell load in kilograms`} data-setid={set.id} className="set-input" type="number" min="0" max="1000" step="0.5" inputMode="decimal" disabled={session.paused||!loadOptional} placeholder="—" value={loadOptional?set.weightKg??'':''} onChange={(event)=>inputNumber(event,'weightKg')} />{sideNames?<><input aria-label={`${definition.name} set ${index+1} ${sideNames[0]} ${target.kind==='hold'?'seconds':'reps'}`} data-setid={set.id} className="set-input" type="number" min="0" max="600" inputMode="numeric" disabled={session.paused} placeholder="—" value={set.leftValue??''} onChange={(event)=>inputNumber(event,'leftValue')} /><input aria-label={`${definition.name} set ${index+1} ${sideNames[1]} ${target.kind==='hold'?'seconds':'reps'}`} data-setid={set.id} className="set-input" type="number" min="0" max="600" inputMode="numeric" disabled={session.paused} placeholder="—" value={set.rightValue??''} onChange={(event)=>inputNumber(event,'rightValue')} /></>:<input aria-label={`${definition.name} set ${index+1} actual ${target.kind==='hold'?'duration seconds':'repetitions'}`} data-setid={set.id} className="set-input" type="number" min="0" max="600" inputMode="numeric" disabled={session.paused} placeholder="—" value={target.kind==='hold'?set.durationSeconds??'':set.reps??''} onChange={(event)=>inputNumber(event,target.kind==='hold'?'durationSeconds':'reps')} />}<button type="button" className={`set-complete-button ${set.completed?'selected':''}`} disabled={session.paused} aria-pressed={set.completed} aria-label={`${set.completed?'Unmark':'Mark'} set ${index+1} complete`} onClick={()=>{if(set.completed){markSet(set);return}const isSide=Boolean(sideNames);const logged=target.kind==='hold'?isSide?set.leftValue!==null&&set.rightValue!==null:set.durationSeconds!==null:isSide?set.leftValue!==null&&set.rightValue!==null:set.reps!==null;if(logged)markSet(set)}}>✓</button><button type="button" className="set-remove-button" disabled={session.paused||current.sets.length<=1} aria-label={`Remove set ${index+1}`} onClick={()=>persist((value)=>({...value,exercises:value.exercises.map((item)=>item.exerciseId===current.exerciseId?{...item,sets:item.sets.filter((entry)=>entry.id!==set.id)}:item)}))}>×</button>
        </div>)}
      </div>
      <div className="isotefle-set-actions"><button type="button" disabled={session.paused||current.sets.length>=20} onClick={()=>persist((value)=>({...value,exercises:value.exercises.map((item)=>item.exerciseId===current.exerciseId?{...item,sets:[...item.sets,{id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,weightKg:null,reps:null,durationSeconds:null,leftValue:null,rightValue:null,completed:false}]}:item)}))}>+ Add set</button><button type="button" disabled={session.paused} onClick={()=>exerciseStatus('completed')}>Mark movement complete</button><button type="button" disabled={session.paused} onClick={()=>exerciseStatus('skipped')}>Skip movement</button></div>
    </article>
    <section className="isotefle-rest"><div><span className="eyebrow">REST · {definition.restSeconds}s PRESCRIBED</span><strong>{formatClock(restRemaining)}</strong></div><button type="button" disabled={session.paused} onClick={session.restTimerDeadline?()=>persist((value)=>({...value,restTimerRemainingSeconds:Math.max(0,Math.ceil(((value.restTimerDeadline??0)-Date.now())/1000)),restTimerDeadline:null})):()=>persist((value)=>({...value,restTimerRemainingSeconds:value.restTimerRemainingSeconds||definition.restSeconds,restTimerDeadline:Date.now()+(value.restTimerRemainingSeconds||definition.restSeconds)*1000}))}>{session.restTimerDeadline?'Pause rest':'Start rest'}</button><button type="button" disabled={session.paused} onClick={()=>persist((value)=>({...value,restTimerRemainingSeconds:0,restTimerDeadline:null}))}>Skip rest</button></section>
    <div className="isotefle-next-exercise"><span className="eyebrow">{prevExercise?`PREVIOUS · ${prevExercise.name}`:'SESSION START'}</span><span>{nextExercise?`NEXT · ${nextExercise.name}`:'FINAL MOVEMENT'}</span><div><button type="button" disabled={session.currentExerciseIndex===0} onClick={()=>persist((value)=>moveIsoExercise(value,value.currentExerciseIndex-1))}>Previous</button><button type="button" disabled={session.currentExerciseIndex>=session.exercises.length-1} onClick={()=>persist((value)=>moveIsoExercise(value,value.currentExerciseIndex+1))}>Next</button></div></div>
    <div className="isotefle-in-session-check"><span>EFFORT & NOTES</span><label>RPE <input type="number" min="1" max="10" value={session.rpe??''} onChange={(event)=>{const value=event.currentTarget.value;if(value===''||Number(value)>=1&&Number(value)<=10)persist((currentSession)=>({...currentSession,rpe:value===''?null:Number(value)}))}} /></label>{session.programmeId==='tendon'&&<label>Discomfort note <input value={session.painNotes} maxLength={1000} onChange={(event)=>persist((value)=>({...value,painNotes:event.currentTarget.value}))} placeholder="Optional observations" /></label>}<label>Session note <textarea value={session.notes} maxLength={1000} onChange={(event)=>persist((value)=>({...value,notes:event.currentTarget.value}))} placeholder="Optional observations" /></label></div>
    <footer className="isotefle-session-footer"><p>Actual performance is saved. This session does not award gym XP or change Push → Pull → Core & Legs.</p><button className="button-primary" type="button" disabled={busy} onClick={onFinish}>Finish & save session</button></footer>
  </section>
}

function ProgressSummary({programmeId,records}:{programmeId:IsoProgrammeId;records:IsoSessionRecord[]}) {
  const rows=records.filter((item)=>item.programmeId===programmeId), completed=rows.filter((item)=>item.status==='completed')
  const holdRecords=rows.flatMap((item)=>item.exercises.flatMap((exercise)=>exercise.sets.filter((set)=>set.completed&&set.durationSeconds!==null).map((set)=>set.durationSeconds!)))
  const repRecords=rows.flatMap((item)=>item.exercises.flatMap((exercise)=>exercise.sets.filter((set)=>set.completed&&set.reps!==null).map((set)=>set.reps!)))
  return <section className="isotefle-progress-summary"><span className="eyebrow">RECORDED PROGRESS</span><div className="isotefle-progress-values"><div><strong>{rows.length}</strong><span>sessions recorded</span></div><div><strong>{completed.length}</strong><span>full sessions</span></div>{holdRecords.length>0&&<div><strong>{Math.max(...holdRecords)}s</strong><span>longest logged hold</span></div>}{repRecords.length>0&&<div><strong>{Math.max(...repRecords)}</strong><span>most reps in a set</span></div>}</div><p>Progress summaries use recorded performance only. These figures do not imply that a particular exercise caused a change.</p></section>
}

function HistoryView({records,archived,archivedActive}:{records:IsoSessionRecord[];archived:JinGuSession[];archivedActive:ActiveJinGuSession|null}) {
  return <section className="isotefle-history"><span className="eyebrow">TRAINING RECORD</span><h2>Progress & history</h2><ProgressSummary programmeId="isometric" records={records}/><ProgressSummary programmeId="tendon" records={records}/><ProgressSummary programmeId="mobility" records={records}/>
    {records.length===0?<p>No IsoTeFle sessions have been recorded yet.</p>:records.slice().sort((a,b)=>b.completedAt-a.completedAt).map((record)=><article key={record.id} className="isotefle-history-row"><div><span className="eyebrow">{getIsoProgramme(record.programmeId).name} · {formatShortDate(record.scheduledDate)}{record.originalScheduledDate!==record.scheduledDate?` · MOVED FROM ${formatShortDate(record.originalScheduledDate)}`:''}</span><h3>{getIsoTemplate(record.templateId)?.name}</h3><p>{record.status.toUpperCase()} · {formatDuration(record.durationSeconds)} · {record.exercises.filter((item)=>item.completed).length} movements · {record.exercises.reduce((sum,item)=>sum+item.sets.filter((set)=>set.completed).length,0)} sets{record.rpe?` · RPE ${record.rpe}/10`:''}</p>{record.recoveryCheck&&<p>Pre-session: soreness {record.recoveryCheck.soreness}/10 · discomfort {record.recoveryCheck.discomfort}/10 · recovery {record.recoveryCheck.recovery}{record.recoveryCheck.adjusted?' · reduced plan':''}</p>}{record.painNotes&&<p>Discomfort note: {record.painNotes}</p>}{record.notes&&<p>{record.notes}</p>}<details><summary>Recorded performance</summary>{record.exercises.map((exercise)=><p key={exercise.exerciseId}><b>{exercise.name} · {exercise.variationId}</b> — {exercise.sets.filter((set)=>set.completed).map(formatSet).join(' · ')||'No completed sets'}{exercise.skipped?' · skipped':''}</p>)}</details></div></article>)}
    <details className="isotefle-archived-history"><summary>Archived Jin Gu records · {archived.length+(archivedActive?1:0)}</summary>{archivedActive&&<article><b>Unfinished Jin Gu practice · archived</b><p>{formatShortDate(archivedActive.date)} · {archivedActive.completedExerciseIds.length} completed · {archivedActive.skippedExerciseIds.length} skipped</p><p>This unfinished practice is preserved as archived data and cannot be resumed in IsoTeFle.</p></article>}{archived.length===0&&!archivedActive?<p>No archived records are stored.</p>:archived.slice().sort((a,b)=>b.completedAt-a.completedAt).map((item)=><article key={item.id}><b>Jin Gu (archived) · {formatShortDate(item.date)}</b><p>{item.status} · {formatDuration(item.durationSeconds)} · {item.completedExerciseIds.length} completed · {item.skippedExerciseIds.length} skipped{item.discomfortReported?' · discomfort reported':''}</p>{item.notes&&<p>{item.notes}</p>}</article>)}</details>
  </section>
}

function getDisplayedTarget(definition:IsoExerciseDefinition,session:ActiveIsoSession):IsoTarget {
  const target=definition.target
  if(session.programmeId!=='tendon'||!session.recoveryCheck?.adjusted)return target
  return target.kind==='hold'?{...target,minSeconds:Math.max(10,Math.floor(target.minSeconds*.75)),maxSeconds:Math.max(15,Math.floor(target.maxSeconds*.75))}:{...target,minReps:Math.max(5,Math.floor(target.minReps*.75)),maxReps:Math.max(6,Math.floor(target.maxReps*.75))}
}
function targetLabel(target:IsoTarget,sets:number):string {const unit=target.kind==='hold'?'seconds':'reps',range=target.kind==='hold'?`${target.minSeconds}–${target.maxSeconds}`:`${target.minReps===target.maxReps?target.minReps:`${target.minReps}–${target.maxReps}`}`;return `${sets} sets · ${range} ${unit}${target.sides?` per ${target.sides[0].toLowerCase().includes('side')?'side':'leg'}`:''}`}
function formatShortDate(value:string):string {if(!value)return 'Not scheduled';return new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(dateFromKey(value))}
function formatDuration(seconds:number):string {const minutes=Math.floor(seconds/60);return minutes?`${minutes} min${seconds%60?` ${seconds%60}s`:''}`:`${seconds}s`}
function formatClock(seconds:number):string {return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`}
function formatSet(set:IsoLoggedSet):string {const load=set.weightKg===null?'':`${set.weightKg} kg · `,value=set.durationSeconds!==null?`${set.durationSeconds}s`:set.reps!==null?`${set.reps} reps`:set.leftValue!==null||set.rightValue!==null?`${set.leftValue??'—'}/${set.rightValue??'—'}`:'unlogged';return `${load}${value}`}
