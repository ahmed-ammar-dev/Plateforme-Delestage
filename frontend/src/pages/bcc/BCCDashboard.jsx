import { useState, useEffect, useCallback } from 'react'

import { useAuthStore }     from '../../stores/authStore'
import { useBccOrderStore } from '../../stores/bccOrderStore'
import { useLiveStore }     from '../../stores/liveStore'
import { useBCCState }      from '../../hooks/useBCCState'
import api                  from '../../lib/api'

function Icon({ name, size = 18, className = '' }) {
    return <span className={`material-symbols-outlined ${className}`} style={{ fontSize: size }}>{name}</span>
}

// ── Feeder ref → DB id map (BCC 3) ───────────────────────────────────────────
// These ids come from the feeders table seeded at startup.
// Used to POST /api/v1/executions with the correct feeder_id.
const FEEDER_DB_ID = {
    F02: 1,  F07: 2,  F08: 3,  F11: 4,  F14: 5,
    F18: 6,  F09: 7,  F21: 8,  F28: 9,  F25: 10,
    F15: 11, F31: 12, F33: 13, F42: 14, F36: 15,
    F38: 16, F40: 17, F44: 18, F45: 19, F46: 20,
}

// ── Feeder data ───────────────────────────────────────────────────────────────
const POSTES = [
    {
        id: 'beja-centre', label: 'BÉJA CENTRE', sub: 'TR1 · 31,4 MW',
        feeders: [
            { ref:'F07', nom:'Z.I. Béja Nord',  mw:4.2, priority:'P3', status:'executing', elapsed:32, locked:false, daysSince:0   },
            { ref:'F08', nom:'Medjez Ville',     mw:6.5, priority:'P3', status:'selected',  elapsed:0,  locked:false, daysSince:12  },
            { ref:'F11', nom:'Testour Bourg',    mw:7.0, priority:'P3', status:'available', elapsed:0,  locked:false, daysSince:5   },
            { ref:'F02', nom:'Hôpital Béja',    mw:4.5, priority:'P0', status:'locked',    elapsed:0,  locked:true,  daysSince:null },
        ]
    },
    {
        id: 'beja-est', label: 'BÉJA EST', sub: 'TR2 · 28,6 MW',
        feeders: [
            { ref:'F18', nom:'Nefza Rural',      mw:2.6, priority:'P2', status:'overdue',   elapsed:52, locked:false, daysSince:0   },
            { ref:'F09', nom:'Faubourg Est',     mw:3.8, priority:'P4', status:'executing', elapsed:28, locked:false, daysSince:0   },
            { ref:'F21', nom:'Amdoun Rural',     mw:4.8, priority:'P4', status:'available', elapsed:0,  locked:false, daysSince:19  },
            { ref:'F28', nom:'Goubellat Sud',    mw:3.5, priority:'P5', status:'available', elapsed:0,  locked:false, daysSince:24  },
            { ref:'F14', nom:'SONEDE Béja',      mw:3.2, priority:'P0', status:'locked',    elapsed:0,  locked:true,  daysSince:null },
        ]
    },
    {
        id: 'jendouba-nord', label: 'JENDOUBA N.', sub: 'TR1 · 22,8 MW',
        feeders: [
            { ref:'F25', nom:'Bou Salem Ctr',    mw:5.5, priority:'P2', status:'executing', elapsed:15, locked:false, daysSince:5   },
            { ref:'F15', nom:'Téboursouk Agr',   mw:5.2, priority:'P4', status:'selected',  elapsed:0,  locked:false, daysSince:16  },
            { ref:'F31', nom:'Jendouba Ctr',     mw:4.1, priority:'P3', status:'available', elapsed:0,  locked:false, daysSince:8   },
            { ref:'F33', nom:'Oued Meliz',       mw:3.2, priority:'P5', status:'available', elapsed:0,  locked:false, daysSince:11  },
        ]
    },
    {
        id: 'jendouba-sud', label: 'JENDOUBA S.', sub: 'TR2 · 19,2 MW',
        feeders: [
            { ref:'F36', nom:'Ghardimaou Ville', mw:5.8, priority:'P3', status:'available', elapsed:0,  locked:false, daysSince:3   },
            { ref:'F38', nom:'Aïn Draham',       mw:4.4, priority:'P4', status:'available', elapsed:0,  locked:false, daysSince:21  },
            { ref:'F40', nom:'Fernana Rural',    mw:3.6, priority:'P5', status:'available', elapsed:0,  locked:false, daysSince:7   },
            { ref:'F42', nom:'Hôp. Jendouba',   mw:2.8, priority:'P0', status:'locked',    elapsed:0,  locked:true,  daysSince:null },
        ]
    },
    {
        id: 'tabarka', label: 'TABARKA', sub: 'TR1 · 14,6 MW',
        feeders: [
            { ref:'F44', nom:'Tabarka Ville',    mw:4.0, priority:'P3', status:'available', elapsed:0,  locked:false, daysSince:6   },
            { ref:'F45', nom:'Nefza Bourg',      mw:3.1, priority:'P4', status:'available', elapsed:0,  locked:false, daysSince:14  },
            { ref:'F46', nom:'Aïn Snoussi',      mw:2.8, priority:'P5', status:'available', elapsed:0,  locked:false, daysSince:18  },
        ]
    },
]

const TARGET_MW = 40.0   // fallback — overridden by consigne from CONSIGNES map
const TOLERANCE = 1.5
const MAX_MIN   = 45

// Per-BCC consignes — mirrors dashboard.py CONSIGNES dict
const CONSIGNES = {
    'BCC 1': 110.0, 'BCC 2': 90.0, 'BCC 3': 50.0, 'BCC 4': 50.0,
    'BCC 5': 50.0,  'BCC 6': 60.0, 'BCC 7': 40.0,
}

// ── Tile helpers ──────────────────────────────────────────────────────────────
function tileCls(f) {
    if (f.locked)                  return 'bg-error-container/15 border border-[#ffb4ab]/30 opacity-60 cursor-not-allowed'
    if (f.status === 'cooldown')   return 'bg-surface-container-lowest border border-tertiary/30 cursor-not-allowed'
    if (f.status === 'overdue')    return 'bg-error-container cursor-pointer animate-pulse hover:brightness-110'
    if (f.status === 'executing')  return 'bg-[#ffb95f]/20 border border-[#ffb95f] cursor-pointer hover:brightness-110'
    if (f.status === 'selected')   return 'bg-secondary-container cursor-pointer hover:bg-secondary-container/80'
    if (f.status === 'restored')   return 'bg-surface-container/40 border border-tertiary/20 opacity-60 cursor-default'
    return 'bg-surface-container-low border border-surface-container-high cursor-pointer hover:bg-surface-container-high'
}
function refCls(f) {
    if (f.locked)                  return 'text-error'
    if (f.status === 'cooldown')   return 'text-on-surface-variant'
    if (f.status === 'overdue')    return 'text-on-error-container'
    if (f.status === 'executing')  return 'text-tertiary'
    if (f.status === 'selected')   return 'text-on-secondary-container'
    return 'text-secondary'
}
function mwCls(f) {
    if (f.locked)                  return 'text-error'
    if (f.status === 'cooldown')   return 'text-on-surface-variant'
    if (f.status === 'overdue')    return 'text-on-error-container'
    if (f.status === 'executing')  return 'text-tertiary'
    if (f.status === 'selected')   return 'text-on-secondary-container'
    return 'text-on-surface'
}
function priorityCls(f) {
    if (f.locked || f.status === 'overdue') return 'bg-black/30 text-on-error-container/80'
    if (f.status === 'cooldown')            return 'bg-surface-container text-on-surface-variant'
    if (f.status === 'executing')           return 'bg-[#231200] text-tertiary'
    if (f.status === 'selected')            return 'bg-black/20 text-on-secondary-container/80'
    return 'bg-surface-container text-secondary'
}

// ── AI digest text generator (mock — replace with real AI when backend ready) ──
function generateAiDigest(slots, feeders)
{
    if (!slots || slots.length === 0) return { status: 'loading', text: 'Analyse en cours…' }

    const assignedSlots = slots.filter((s) => s.feeders && s.feeders.length > 0)
    const errorSlots    = slots.filter((s) => {
        const tot = (s.feeders ?? []).reduce((acc, r) => {
            const f = feeders.find((x) => x.ref === r)
            return acc + (f ? f.mw : 0)
        }, 0)
        return Math.abs(tot - s.mw_bcc) > 0.6
    })

    if (assignedSlots.length === 0)
        return { status: 'warn', text: 'Aucun créneau planifié. Utilisez "IA — Remplir tout" ou assignez les départs manuellement.' }

    if (errorSlots.length > 0)
        return {
            status: 'warn',
            text: `${errorSlots.length} créneau(x) hors tolérance (±0,6 MW). Vérifiez : ${errorSlots.slice(0,3).map((s) => s.time_slot).join(', ')}${errorSlots.length > 3 ? '…' : ''}.`
        }

    // Check for a feeder used 3+ consecutive slots
    const refCounts = {}
    slots.forEach((s) => (s.feeders ?? []).forEach((r) => { refCounts[r] = (refCounts[r] ?? 0) + 1 }))
    const overused = Object.entries(refCounts).filter(([, c]) => c >= 6).map(([r]) => r)
    if (overused.length > 0)
        return {
            status: 'warn',
            text: `Équité : ${overused.join(', ')} apparaît dans ${refCounts[overused[0]]} créneaux. Envisagez une rotation.`
        }

    const equity = feeders.filter((f) => !f.locked).length > 0
        ? Math.round(90 + Math.random() * 8)
        : 92

    return {
        status: 'ok',
        text: `Plan J+1 conforme — ${assignedSlots.length}/48 créneaux couverts, équité ${equity}/100, P0 sanctuarisés.`
    }
}

// ── AI feeder suggestion for one slot ────────────────────────────────────────
function aiSuggestSlot(targetMW, feeders)
{
    // Sort by: P0 excluded, then by days_since DESC (longest rest first), then priority
    const priorityOrder = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 }
    const candidates = feeders
        .filter((f) => !f.locked && f.priority !== 'P0')
        .sort((a, b) => {
            const dA = a.days_since ?? 0
            const dB = b.days_since ?? 0
            if (Math.abs(dA - dB) > 1) return dB - dA  // longest rest first
            return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
        })

    const selected = []
    let   sum      = 0
    for (const f of candidates) {
        if (sum >= targetMW - 0.6) break
        selected.push(f.ref)
        sum += f.mw
    }
    return selected
}

// ── Programme J+1 modal (full 3-tab version) ───────────────────────────────────
function ProgrammeJ1Modal({ isOpen, onClose, bccLabel, bccId, bccName, reloadKey = 0 })
{
    const [tab,         setTab]         = useState('slots')   // 'slots' | 'upload' | 'summary'
    const [slots,       setSlots]       = useState([])        // [{time_slot, mw_bcc, source}]
    const [feeders,     setFeeders]     = useState([])        // [{id,ref,nom,mw,priority,locked,days_since}]
    const [assignments, setAssignments] = useState({})        // { 'time_slot': ['F07','F08',...] }
    const [loadState,   setLoadState]   = useState('idle')
    const [progDate,    setProgDate]    = useState(null)
    const [progStatus,  setProgStatus]  = useState('no_programme')
    const [progId,      setProgId]      = useState(null)
    const [filterRange, setFilterRange] = useState('all')     // 'all'|'peak'|'night'|'errors'
    const [activeSlot,  setActiveSlot]  = useState(null)      // time_slot string
    const [sending,     setSending]     = useState(false)
    const [sent,        setSent]        = useState(false)
    const [confirmTxt,  setConfirmTxt]  = useState('')
    const [showAiChat,  setShowAiChat]  = useState(false)
    const [aiMessages,  setAiMessages]  = useState([])
    const [aiInput,     setAiInput]     = useState('')
    // CSV import state
    const [fileName,    setFileName]    = useState(null)
    const [fileError,   setFileError]   = useState(null)
    const [csvPreview,  setCsvPreview]  = useState(null)      // parsed rows before confirm
    const fileRef = useState(() => ({ current: null }))[0]

    // ── Load slots + feeders when modal opens ─────────────────────────────────
    useEffect(() => {
        if (!isOpen && reloadKey === 0) return
        if (!bccId) return
        setLoadState('loading')
        setSent(false)
        setConfirmTxt('')

        api.get(`/api/v1/programmes/bcc-slots?bcc_id=${bccId}`)
            .then(({ data }) => {
                setSlots(data.slots)
                setFeeders(data.feeders ?? [])
                setProgDate(data.programme_date)
                setProgStatus(data.status)
                setProgId(data.programme_id)
                // Pre-fill AI suggestions for all slots
                const a = {}
                data.slots.forEach((s) => {
                    a[s.time_slot] = aiSuggestSlot(s.mw_bcc, data.feeders ?? [])
                })
                setAssignments(a)
                setLoadState('ready')
            })
            .catch(() => {
                // Fallback mock
                const profile = [4,4,4,4,4,4,4,4,6,8,10,14,18,22,28,34,40,46,50,55,60,58,55,50,48,45,42,38,34,30,28,25,22,20,18,16,14,12,10,9,8,8,7,6,5,5,4,4]
                const fallbackSlots = profile.map((mw, i) => {
                    const h = Math.floor((i * 30) / 60), m = (i * 30) % 60
                    return { time_slot: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`, mw_bcc: mw, source: 'mock_profile' }
                })
                // Mock feeder list from POSTES constant
                const mockFeeders = POSTES.flatMap((p) => p.feeders.map((f) => ({
                    id: null, ref: f.ref, nom: f.nom, mw: f.mw,
                    priority: f.priority, locked: f.locked ?? false,
                    days_since: f.daysSince ?? null
                })))
                setSlots(fallbackSlots)
                setFeeders(mockFeeders)
                setProgDate(new Date(Date.now() + 86400000).toISOString().slice(0,10))
                setProgStatus('no_programme')
                const a = {}
                fallbackSlots.forEach((s) => { a[s.time_slot] = aiSuggestSlot(s.mw_bcc, mockFeeders) })
                setAssignments(a)
                setLoadState('ready')
            })
    }, [isOpen, bccId, reloadKey])

    // ── Derived ───────────────────────────────────────────────────────────────
    const slotMW = (timeSlot) => {
        const refs = assignments[timeSlot] ?? []
        return refs.reduce((sum, r) => {
            const f = feeders.find((x) => x.ref === r)
            return sum + (f ? f.mw : 0)
        }, 0)
    }

    const slotBalance = (s) => {
        const total = slotMW(s.time_slot)
        const gap   = Math.round((total - s.mw_bcc) * 10) / 10
        return { total, gap, ok: Math.abs(gap) < 0.6 }
    }

    const errorSlots   = slots.filter((s) => !slotBalance(s).ok)
    const assignedSlots = slots.filter((s) => (assignments[s.time_slot] ?? []).length > 0)
    const allOk        = errorSlots.length === 0 && slots.length > 0
    const canValidate  = allOk && confirmTxt.trim().toUpperCase() === 'CONFIRMER'

    const tomorrow = progDate
        ? new Date(progDate).toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
        : '—'

    const aiDigest = generateAiDigest(
        slots.map((s) => ({ ...s, feeders: assignments[s.time_slot] ?? [] })),
        feeders
    )

    // ── Visible slots with filter ─────────────────────────────────────────────
    const visibleSlots = (() => {
        if (filterRange === 'peak')   return slots.filter((s) => { const h = parseInt(s.time_slot); return h >= 8 && h < 20 })
        if (filterRange === 'night')  return slots.filter((s) => { const h = parseInt(s.time_slot); return h < 6 || h >= 22 })
        if (filterRange === 'errors') return slots.filter((s) => !slotBalance(s).ok)
        return slots
    })()

    // ── Handlers ──────────────────────────────────────────────────────────────
    const toggleFeeder = (timeSlot, ref) => {
        setAssignments((prev) => {
            const current = prev[timeSlot] ?? []
            const next    = current.includes(ref) ? current.filter((r) => r !== ref) : [...current, ref]
            return { ...prev, [timeSlot]: next }
        })
    }

    const applyAiAll = () => {
        const a = {}
        slots.forEach((s) => { a[s.time_slot] = aiSuggestSlot(s.mw_bcc, feeders) })
        setAssignments(a)
    }

    const applyAiSlot = (timeSlot, targetMW) => {
        const suggestion = aiSuggestSlot(targetMW, feeders)
        setAssignments((prev) => ({ ...prev, [timeSlot]: suggestion }))
    }

    // ── CSV import ────────────────────────────────────────────────────────────
    const handleFileChange = (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        setFileName(file.name)
        setFileError(null)
        setCsvPreview(null)

        const reader = new FileReader()
        reader.onload = (ev) => {
            const text = ev.target?.result ?? ''
            const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
            // Skip header row if present
            const dataLines = lines[0].toLowerCase().includes('time_slot') ? lines.slice(1) : lines

            const parsed = []
            const errors = []
            for (const line of dataLines) {
                const [ts, refsRaw] = line.split(',')
                if (!ts) continue
                const timeSlot = ts.trim()
                const refs     = (refsRaw ?? '').split('+').map((r) => r.trim()).filter(Boolean)
                // Validate feeder refs
                const invalid  = refs.filter((r) => r && !feeders.find((f) => f.ref === r))
                if (invalid.length > 0) errors.push(`${timeSlot}: départs inconnus ${invalid.join(',')}`)
                // Validate P0
                const p0refs   = refs.filter((r) => feeders.find((f) => f.ref === r && f.locked))
                if (p0refs.length > 0) errors.push(`${timeSlot}: départs P0 interdits ${p0refs.join(',')}`)
                parsed.push({ timeSlot, refs: refs.filter((r) => !feeders.find((f) => f.ref === r && f.locked)) })
            }

            if (errors.length > 0) {
                setFileError(errors.slice(0, 5).join(' · '))
                setCsvPreview(parsed)
            } else {
                setCsvPreview(parsed)
            }
        }
        reader.readAsText(file)
    }

    const confirmCsvImport = () => {
        if (!csvPreview) return
        const a = { ...assignments }
        csvPreview.forEach(({ timeSlot, refs }) => { a[timeSlot] = refs })
        setAssignments(a)
        setCsvPreview(null)
        setFileName(null)
        setFileError(null)
        setTab('slots')
    }

    // ── Submit ────────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!canValidate || sending) return
        setSending(true)
        const payload = {
            bcc_id:         bccId,
            programme_date: progDate,
            slots: slots.map((s) => ({
                time_slot:   s.time_slot,
                feeder_refs: assignments[s.time_slot] ?? [],
                mw_planned:  Math.round(slotMW(s.time_slot) * 10) / 10,
            })),
        }
        try {
            await api.post('/api/v1/programmes/bcc-validate', payload)
            setSent(true)
            setTimeout(() => { setSent(false); onClose() }, 2000)
        } catch (err) {
            console.error('[BCC] bcc-validate failed:', err?.response?.data ?? err.message)
        } finally {
            setSending(false)
        }
    }

    // ── AI chat send ──────────────────────────────────────────────────────────
    const sendAiMsg = () => {
        if (!aiInput.trim()) return
        const userMsg = aiInput.trim()
        setAiInput('')
        setAiMessages((m) => [...m, { role: 'user', text: userMsg }])
        // Mock response
        setTimeout(() => {
            setAiMessages((m) => [...m, {
                role: 'system',
                text: 'Analyse en cours sur le réseau Béja/Jendouba…\n\nRecommandation : prioriser F21 (19j sans coupure) et F28 (24j) pour les créneaux de pointe. Éviter F18 sur 3 créneaux consécutifs — rotation requise.'
            }])
        }, 600)
    }

    if (!isOpen) return null

    // ── Status badge for source ───────────────────────────────────────────────
    const sourceLabel = {
        programme:  { text: 'CRC validé',   cls: 'bg-[#4ade80]/10 text-[#4ade80] border-[#4ade80]/30' },
        estimated:  { text: 'Estimé',        cls: 'bg-tertiary/10 text-tertiary border-tertiary/30' },
        mock_profile:{ text: 'Profil type', cls: 'bg-surface-container text-on-surface-variant border-surface-container-high' },
        crc_pending:{ text: 'CRC en cours', cls: 'bg-tertiary/10 text-tertiary border-tertiary/30' },
        no_programme:{ text: 'Pas de prog.', cls: 'bg-surface-container text-on-surface-variant border-surface-container-high' },
    }[progStatus] ?? { text: progStatus, cls: 'bg-surface-container text-on-surface-variant border-surface-container-high' }

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-space-md" onClick={onClose}>
            <div
                className="bg-surface-container-low w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-surface-container-high"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Header ── */}
                <div className="px-space-lg py-space-md bg-surface-container-lowest border-b border-surface-container-high flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-space-md">
                        <Icon name="event_available" size={20} className="text-secondary" />
                        <div>
                            <h3 className="font-sans font-bold text-sm text-on-surface uppercase tracking-wide">
                                Programme J+1 — {bccLabel}
                            </h3>
                            <div className="flex items-center gap-space-sm mt-0.5">
                                <span className="font-mono text-[10px] text-on-surface-variant">{tomorrow}</span>
                                <span className={`font-mono text-[9px] px-space-xs py-0.5 border ${sourceLabel.cls}`}>{sourceLabel.text}</span>
                                {loadState === 'ready' && (
                                    <span className="font-mono text-[9px] text-on-surface-variant">
                                        {assignedSlots.length}/{slots.length} créneaux · {errorSlots.length} erreurs
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-space-sm">
                        <button
                            onClick={() => setShowAiChat((v) => !v)}
                            className={`flex items-center gap-space-xs px-space-md py-space-xs font-mono text-xs border transition-colors ${showAiChat ? 'bg-secondary-container/30 border-secondary text-secondary' : 'bg-surface-container hover:bg-surface-container-high border-surface-container-high text-on-surface-variant'}`}
                            type="button"
                        >
                            <Icon name="smart_toy" size={13} /><span>Assistant IA</span>
                        </button>
                        <button onClick={onClose} className="p-space-xs hover:bg-surface-container text-on-surface-variant transition-colors" type="button">
                            <Icon name="close" size={18} />
                        </button>
                    </div>
                </div>

                {/* ── Tab bar ── */}
                <div className="flex items-center gap-0 bg-surface-container-lowest border-b border-surface-container-high shrink-0">
                    {[
                        { key: 'slots',   icon: 'view_list',      label: 'Créneaux' },
                        { key: 'upload',  icon: 'upload_file',    label: 'Import CSV' },
                        { key: 'summary', icon: 'summarize',      label: 'Résumé' },
                    ].map(({ key, icon, label }) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`flex items-center gap-space-xs px-space-lg py-space-sm font-mono text-[10px] font-bold uppercase tracking-wide border-b-2 transition-colors ${tab === key ? 'border-secondary text-secondary bg-secondary-container/10' : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container'}`}
                            type="button"
                        >
                            <Icon name={icon} size={13} />
                            <span>{label}</span>
                            {key === 'slots' && errorSlots.length > 0 && (
                                <span className="ml-space-xs px-space-xs py-0 bg-error text-background font-mono text-[9px] font-bold">{errorSlots.length}</span>
                            )}
                        </button>
                    ))}
                </div>

                {/* ── Body ── */}
                <div className="flex flex-1 overflow-hidden">

                    {/* Main content */}
                    <div className="flex-1 overflow-y-auto">

                        {/* Loading */}
                        {loadState !== 'ready' && (
                            <div className="flex flex-col items-center justify-center h-48 gap-space-md text-on-surface-variant font-mono text-xs">
                                <Icon name="hourglass_top" size={28} className="text-secondary animate-spin" />
                                <span>Chargement des créneaux CRC…</span>
                            </div>
                        )}

                        {/* ── TAB: SLOTS ── */}
                        {loadState === 'ready' && tab === 'slots' && (
                            <div className="flex flex-col">
                                {/* Filters + bulk AI */}
                                <div className="flex items-center justify-between px-space-lg py-space-sm bg-surface-container-lowest border-b border-surface-container-high shrink-0 gap-space-md flex-wrap">
                                    <div className="flex items-center gap-space-xs">
                                        {[
                                            { key: 'all',    label: `Tous (${slots.length})` },
                                            { key: 'peak',   label: 'Pointe (08h–20h)' },
                                            { key: 'night',  label: 'Nuit' },
                                            { key: 'errors', label: `Erreurs (${errorSlots.length})` },
                                        ].map(({ key, label }) => (
                                            <button
                                                key={key}
                                                onClick={() => setFilterRange(key)}
                                                className={`px-space-sm py-space-xs font-mono text-[10px] border transition-colors ${filterRange === key ? 'bg-secondary-container/20 border-secondary text-secondary' : 'bg-surface-container border-surface-container-high text-on-surface-variant hover:bg-surface-container-high'}`}
                                                type="button"
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={applyAiAll}
                                        className="flex items-center gap-space-xs px-space-md py-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container font-mono text-[10px] font-bold transition-colors"
                                        type="button"
                                    >
                                        <Icon name="auto_fix_high" size={13} />
                                        <span>IA — Remplir tout ({slots.length} créneaux)</span>
                                    </button>
                                </div>

                                {/* Slot rows */}
                                <div className="divide-y divide-surface-container-high">
                                    {visibleSlots.map((s) => {
                                        const bal      = slotBalance(s)
                                        const refs     = assignments[s.time_slot] ?? []
                                        const expanded = activeSlot === s.time_slot
                                        const h        = parseInt(s.time_slot)
                                        const isPeak   = h >= 8 && h < 20

                                        return (
                                            <div key={s.time_slot} className={`${bal.ok && refs.length > 0 ? '' : refs.length === 0 ? 'bg-surface-container-lowest' : 'bg-error-container/5'}`}>
                                                {/* Slot header row */}
                                                <div
                                                    className="flex items-center gap-space-md px-space-lg py-space-sm cursor-pointer hover:bg-surface-container-high transition-colors"
                                                    onClick={() => setActiveSlot(expanded ? null : s.time_slot)}
                                                >
                                                    {/* Time + peak badge */}
                                                    <div className="w-20 shrink-0">
                                                        <span className="font-mono text-xs font-bold text-on-surface">{s.time_slot}</span>
                                                        {isPeak && <span className="ml-space-xs font-mono text-[9px] px-0.5 bg-tertiary/20 text-tertiary">POINTE</span>}
                                                    </div>

                                                    {/* Target MW */}
                                                    <span className="font-mono text-xs text-on-surface-variant w-20 shrink-0 text-right">
                                                        {s.mw_bcc.toFixed(1)} MW
                                                    </span>

                                                    {/* Feeder pills */}
                                                    <div className="flex-1 flex flex-wrap gap-space-xs min-w-0">
                                                        {refs.length === 0
                                                            ? <span className="font-mono text-[10px] text-on-surface-variant italic">Non planifié</span>
                                                            : refs.map((r) => {
                                                                const f = feeders.find((x) => x.ref === r)
                                                                return (
                                                                    <span key={r} className="font-mono text-[9px] px-space-xs py-0 bg-secondary-container/30 text-secondary border border-secondary/20">
                                                                        {r} {f ? `${f.mw}MW` : ''}
                                                                    </span>
                                                                )
                                                              })
                                                        }
                                                    </div>

                                                    {/* Balance badge */}
                                                    <div className="shrink-0 flex items-center gap-space-sm">
                                                        {refs.length > 0 && (
                                                            <span className={`font-mono text-[10px] font-bold px-space-xs py-0.5 ${bal.ok ? 'bg-[#4ade80]/10 text-[#4ade80] border border-[#4ade80]/20' : 'bg-error-container/30 text-error border border-error/30'}`}>
                                                                {bal.ok ? `${bal.total.toFixed(1)} MW ✓` : `${bal.total.toFixed(1)}/${s.mw_bcc} ÉCART ${bal.gap > 0 ? '+' : ''}${bal.gap}`}
                                                            </span>
                                                        )}
                                                        <Icon name={expanded ? 'expand_less' : 'expand_more'} size={16} className="text-on-surface-variant" />
                                                    </div>
                                                </div>

                                                {/* Expanded feeder picker */}
                                                {expanded && (
                                                    <div className="px-space-lg pb-space-md bg-surface-container-lowest border-t border-surface-container-high">
                                                        <div className="flex items-center justify-between py-space-sm">
                                                            <span className="font-mono text-[10px] text-on-surface-variant uppercase">
                                                                Cible : {s.mw_bcc.toFixed(1)} MW — Sélectionné : {bal.total.toFixed(1)} MW
                                                            </span>
                                                            <button
                                                                onClick={() => applyAiSlot(s.time_slot, s.mw_bcc)}
                                                                className="flex items-center gap-space-xs px-space-sm py-space-xs bg-secondary-container/30 hover:bg-secondary-container text-secondary font-mono text-[9px] font-bold border border-secondary/30 transition-colors"
                                                                type="button"
                                                            >
                                                                <Icon name="auto_fix_high" size={11} /><span>IA ce créneau</span>
                                                            </button>
                                                        </div>
                                                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-space-xs">
                                                            {feeders.map((f) => {
                                                                const sel     = refs.includes(f.ref)
                                                                const locked  = f.locked
                                                                return (
                                                                    <div
                                                                        key={f.ref}
                                                                        onClick={() => !locked && toggleFeeder(s.time_slot, f.ref)}
                                                                        className={`flex flex-col gap-0.5 p-space-xs border font-mono text-[9px] transition-all select-none
                                                                            ${locked ? 'opacity-40 cursor-not-allowed bg-error-container/10 border-error/20'
                                                                              : sel   ? 'bg-secondary-container/30 border-secondary cursor-pointer hover:bg-secondary-container/50'
                                                                              : 'bg-surface-container border-surface-container-high cursor-pointer hover:bg-surface-container-high'}`}
                                                                    >
                                                                        <div className="flex items-center justify-between">
                                                                            <span className={`font-bold text-[10px] ${locked ? 'text-error' : sel ? 'text-secondary' : 'text-on-surface'}`}>{f.ref}</span>
                                                                            {locked ? <Icon name="lock" size={9} className="text-error" />
                                                                              : <span className={`text-[8px] px-0.5 ${sel ? 'bg-black/20 text-on-secondary-container' : 'bg-surface-container text-secondary'}`}>{f.priority}</span>
                                                                            }
                                                                        </div>
                                                                        <span className="text-on-surface-variant truncate leading-tight">{f.nom}</span>
                                                                        <span className={`font-bold ${sel ? 'text-secondary' : 'text-on-surface'}`}>{f.mw} MW</span>
                                                                        {f.days_since !== null && (
                                                                            <span className={`text-[8px] ${f.days_since > 14 ? 'text-[#4ade80]' : f.days_since < 1 ? 'text-error' : 'text-on-surface-variant'}`}>
                                                                                {f.days_since < 1 ? 'Auj.' : `${f.days_since}j`}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                        {/* Mini balance bar */}
                                                        <div className="mt-space-sm">
                                                            <div className="w-full h-1.5 bg-surface-container-lowest overflow-hidden">
                                                                <div
                                                                    className={`h-full transition-all ${bal.ok ? 'bg-[#4ade80]' : bal.total > s.mw_bcc ? 'bg-error' : 'bg-secondary-container'}`}
                                                                    style={{ width: `${Math.min(100, s.mw_bcc > 0 ? (bal.total / s.mw_bcc) * 100 : 0)}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── TAB: IMPORT CSV ── */}
                        {loadState === 'ready' && tab === 'upload' && (
                            <div className="p-space-lg flex flex-col gap-space-lg">
                                {/* Format guide */}
                                <div className="bg-surface-container border border-surface-container-high p-space-md flex flex-col gap-space-sm">
                                    <p className="font-mono text-[10px] text-secondary font-bold uppercase">Format CSV attendu</p>
                                    <pre className="font-mono text-[10px] text-on-surface-variant leading-relaxed bg-surface-container-lowest p-space-sm border border-surface-container-high overflow-x-auto">{`time_slot,feeders
00:00,F07+F11
00:30,F07+F11
...
14:00,F08+F15+F21+F11+F25+F09
14:30,F07+F28+F31+F09
...`}</pre>
                                    <p className="font-mono text-[10px] text-on-surface-variant">
                                        Une ligne par créneau de 30 min (00:00 → 23:30). Séparateur départs : <code className="text-secondary">+</code>.
                                        Les départs P0 sont automatiquement exclus. Les départs inconnus sont signalés.
                                    </p>
                                </div>

                                {/* Drop zone */}
                                <div
                                    className="border-2 border-dashed border-surface-container-highest hover:border-secondary transition-colors p-space-xl flex flex-col items-center justify-center gap-space-md cursor-pointer"
                                    onClick={() => fileRef.current?.click()}
                                    onDragOver={(e) => { e.preventDefault() }}
                                    onDrop={(e) => {
                                        e.preventDefault()
                                        const f = e.dataTransfer.files?.[0]
                                        if (f) { const fake = { target: { files: [f] } }; handleFileChange(fake) }
                                    }}
                                >
                                    <Icon name="upload_file" size={36} className="text-on-surface-variant/40" />
                                    <div className="text-center">
                                        <p className="font-mono text-sm text-on-surface-variant">
                                            {fileName ? <span className="text-secondary font-bold">{fileName}</span> : 'Glissez votre fichier CSV ici'}
                                        </p>
                                        <p className="font-mono text-[10px] text-on-surface-variant mt-space-xs">ou cliquez pour parcourir</p>
                                    </div>
                                    <input ref={(el) => { fileRef.current = el }} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
                                </div>

                                {/* Error banner */}
                                {fileError && (
                                    <div className="flex items-start gap-space-sm bg-error-container/20 border border-error/40 px-space-md py-space-sm font-mono text-[10px] text-error">
                                        <Icon name="warning" size={14} className="shrink-0 mt-0.5" />
                                        <span className="leading-relaxed">{fileError}</span>
                                    </div>
                                )}

                                {/* Preview table */}
                                {csvPreview && (
                                    <div className="flex flex-col gap-space-sm">
                                        <div className="flex items-center justify-between">
                                            <p className="font-mono text-[10px] text-secondary font-bold uppercase">
                                                Aperçu — {csvPreview.length} créneaux
                                            </p>
                                            <button
                                                onClick={confirmCsvImport}
                                                className="flex items-center gap-space-xs px-space-md py-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container font-mono text-[10px] font-bold uppercase transition-colors"
                                                type="button"
                                            >
                                                <Icon name="check" size={13} /><span>Appliquer ({csvPreview.length} créneaux)</span>
                                            </button>
                                        </div>
                                        <div className="max-h-64 overflow-y-auto border border-surface-container-high">
                                            <table className="w-full font-mono text-[10px]">
                                                <thead className="bg-surface-container sticky top-0">
                                                    <tr>
                                                        <th className="px-space-sm py-space-xs text-left text-on-surface-variant">Créneau</th>
                                                        <th className="px-space-sm py-space-xs text-left text-on-surface-variant">Départs</th>
                                                        <th className="px-space-sm py-space-xs text-right text-on-surface-variant">MW</th>
                                                        <th className="px-space-sm py-space-xs text-center text-on-surface-variant">Statut</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-surface-container-high">
                                                    {csvPreview.map(({ timeSlot, refs }) => {
                                                        const mw  = refs.reduce((s, r) => s + (feeders.find((f) => f.ref === r)?.mw ?? 0), 0)
                                                        const tgt = slots.find((sl) => sl.time_slot === timeSlot)?.mw_bcc ?? 0
                                                        const ok  = tgt > 0 ? Math.abs(mw - tgt) < 0.6 : refs.length === 0
                                                        return (
                                                            <tr key={timeSlot} className="bg-surface-container-low hover:bg-surface-container">
                                                                <td className="px-space-sm py-space-xs font-bold text-on-surface">{timeSlot}</td>
                                                                <td className="px-space-sm py-space-xs text-secondary">{refs.join(' + ') || '—'}</td>
                                                                <td className="px-space-sm py-space-xs text-right text-on-surface">{mw.toFixed(1)}</td>
                                                                <td className="px-space-sm py-space-xs text-center">
                                                                    {ok
                                                                        ? <span className="text-[#4ade80]">✓</span>
                                                                        : <span className="text-error font-bold">!</span>
                                                                    }
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── TAB: RÉSUMÉ ── */}
                        {loadState === 'ready' && tab === 'summary' && (
                            <div className="p-space-lg flex flex-col gap-space-lg">
                                {/* KPI strip */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm font-mono text-xs">
                                    {[
                                        { label: 'Créneaux planifiés', value: `${assignedSlots.length}/${slots.length}`, cls: assignedSlots.length === slots.length ? 'text-[#4ade80]' : 'text-tertiary' },
                                        { label: 'Erreurs de bilan',   value: errorSlots.length, cls: errorSlots.length === 0 ? 'text-[#4ade80]' : 'text-error' },
                                        { label: 'ENS estimé',         value: `${slots.reduce((sum, s) => sum + s.mw_bcc * 0.5, 0).toFixed(0)} MWh`, cls: 'text-secondary' },
                                        { label: 'Départs uniques',    value: new Set(Object.values(assignments).flat()).size, cls: 'text-secondary' },
                                    ].map(({ label, value, cls }) => (
                                        <div key={label} className="bg-surface-container border border-surface-container-high p-space-sm">
                                            <p className="text-[9px] text-on-surface-variant uppercase mb-space-xs">{label}</p>
                                            <p className={`text-xl font-bold font-mono ${cls}`}>{value}</p>
                                        </div>
                                    ))}
                                </div>

                                {/* Feeder equity table */}
                                <div>
                                    <p className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider mb-space-sm font-bold">Tableau d'équité départs</p>
                                    <div className="border border-surface-container-high overflow-hidden max-h-64 overflow-y-auto">
                                        <table className="w-full font-mono text-[10px]">
                                            <thead className="bg-surface-container sticky top-0">
                                                <tr>
                                                    <th className="px-space-sm py-space-xs text-left text-on-surface-variant">Réf.</th>
                                                    <th className="px-space-sm py-space-xs text-left text-on-surface-variant">Nom</th>
                                                    <th className="px-space-sm py-space-xs text-center text-on-surface-variant">Prio.</th>
                                                    <th className="px-space-sm py-space-xs text-center text-on-surface-variant">Créneaux</th>
                                                    <th className="px-space-sm py-space-xs text-right text-on-surface-variant">Repos (j)</th>
                                                    <th className="px-space-sm py-space-xs text-center text-on-surface-variant">Équité</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-surface-container-high">
                                                {feeders.filter((f) => !f.locked).map((f) => {
                                                    const count    = Object.values(assignments).flat().filter((r) => r === f.ref).length
                                                    const maxCount = Math.max(...feeders.filter((x) => !x.locked).map((x) => Object.values(assignments).flat().filter((r) => r === x.ref).length), 1)
                                                    const equityPct = maxCount > 0 ? Math.round((1 - count / (maxCount * 1.2)) * 100) : 100
                                                    const equityCls = equityPct >= 80 ? 'text-[#4ade80]' : equityPct >= 60 ? 'text-tertiary' : 'text-error'
                                                    return (
                                                        <tr key={f.ref} className="bg-surface-container-low hover:bg-surface-container">
                                                            <td className="px-space-sm py-space-xs font-bold text-secondary">{f.ref}</td>
                                                            <td className="px-space-sm py-space-xs text-on-surface truncate max-w-[120px]">{f.nom}</td>
                                                            <td className="px-space-sm py-space-xs text-center text-on-surface-variant">{f.priority}</td>
                                                            <td className="px-space-sm py-space-xs text-center font-bold text-on-surface">{count}</td>
                                                            <td className="px-space-sm py-space-xs text-right text-on-surface-variant">{f.days_since ?? '—'}</td>
                                                            <td className={`px-space-sm py-space-xs text-center font-bold ${equityCls}`}>
                                                                {equityPct}%
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Error slots list */}
                                {errorSlots.length > 0 && (
                                    <div className="bg-error-container/10 border border-error/30 p-space-md flex flex-col gap-space-sm">
                                        <p className="font-mono text-[10px] text-error font-bold uppercase">
                                            {errorSlots.length} créneau(x) hors tolérance
                                        </p>
                                        <div className="flex flex-wrap gap-space-xs">
                                            {errorSlots.map((s) => (
                                                <button
                                                    key={s.time_slot}
                                                    onClick={() => { setTab('slots'); setActiveSlot(s.time_slot) }}
                                                    className="px-space-sm py-space-xs font-mono text-[10px] bg-error-container/30 hover:bg-error-container/50 text-error border border-error/30 transition-colors"
                                                    type="button"
                                                >
                                                    {s.time_slot}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="font-mono text-[10px] text-on-surface-variant">Cliquez sur un créneau pour l'éditer.</p>
                                    </div>
                                )}

                                {/* Confirmation input */}
                                <div className="border-t border-surface-container-high pt-space-md flex flex-col gap-space-sm">
                                    <p className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider font-bold">Confirmation de validation</p>
                                    <p className="font-sans text-xs text-on-surface-variant">
                                        Tapez <strong className="text-secondary font-mono">CONFIRMER</strong> pour autoriser la transmission.
                                        Le programme sera exécuté automatiquement à chaque créneau le {tomorrow}.
                                    </p>
                                    <input
                                        type="text"
                                        placeholder="Tapez CONFIRMER"
                                        value={confirmTxt}
                                        onChange={(e) => setConfirmTxt(e.target.value)}
                                        className="w-full bg-surface-container-lowest border border-secondary/30 focus:border-secondary text-on-surface font-mono text-sm px-space-md py-space-sm focus:outline-none transition-all tracking-widest max-w-xs"
                                    />
                                    {!allOk && (
                                        <p className="font-mono text-[10px] text-error">
                                            Corrigez les {errorSlots.length} erreur(s) avant de valider.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── AI chat side panel ── */}
                    {showAiChat && (
                        <div className="w-72 border-l border-surface-container-high flex flex-col bg-surface-container-lowest shrink-0">
                            <div className="px-space-md py-space-sm bg-surface-container border-b border-surface-container-high flex items-center gap-space-sm shrink-0">
                                <Icon name="smart_toy" size={14} className="text-secondary" />
                                <span className="font-mono text-[10px] font-bold text-secondary uppercase">Assistant IA</span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-space-sm flex flex-col gap-space-xs">
                                {aiMessages.length === 0 && (
                                    <div className="font-mono text-[10px] text-on-surface-variant p-space-sm bg-surface-container border border-surface-container-high leading-relaxed">
                                        <span className="text-secondary font-bold block mb-space-xs">Suggestion IA</span>
                                        Demandez : "Génère un plan pour demain", "Quels départs éviter ce soir ?", "Analyse l'équité de mon plan actuel"…
                                    </div>
                                )}
                                {aiMessages.map((m, i) => (
                                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[90%] p-space-xs font-mono text-[10px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-secondary-container/20 border border-secondary/30 text-on-surface' : 'bg-surface-container border border-surface-container-high text-on-surface-variant'}`}>
                                            {m.role === 'system' && <span className="text-secondary font-bold text-[9px] block mb-0.5 uppercase">IA</span>}
                                            {m.text}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="p-space-sm border-t border-surface-container-high flex items-center gap-space-xs shrink-0">
                                <input
                                    value={aiInput}
                                    onChange={(e) => setAiInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') sendAiMsg() }}
                                    placeholder="Question opérationnelle…"
                                    className="flex-1 bg-surface-container-lowest border border-surface-container-high px-space-sm py-space-xs font-mono text-[10px] text-on-surface focus:border-secondary focus:outline-none"
                                />
                                <button onClick={sendAiMsg} className="p-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container border border-secondary transition-colors" type="button">
                                    <Icon name="send" size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="px-space-lg py-space-md bg-surface-container border-t border-surface-container-high flex items-center justify-between shrink-0">
                    <div className="font-mono text-[10px] text-on-surface-variant flex items-center gap-space-xs">
                        <Icon name="schedule" size={13} className="text-secondary" />
                        <span>Validation obligatoire avant 17h00 UTC+1 · Exécution automatique le {tomorrow}</span>
                    </div>
                    <div className="flex items-center gap-space-sm">
                        <button onClick={onClose} className="px-space-md py-space-xs bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs border border-surface-container-high transition-colors" type="button">
                            Annuler
                        </button>
                        <button
                            onClick={tab !== 'summary' ? () => setTab('summary') : handleSubmit}
                            disabled={tab === 'summary' && (!canValidate || sending)}
                            className="flex items-center gap-space-xs px-space-md py-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container font-mono text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            type="button"
                        >
                            {sent
                                ? <><Icon name="check_circle" size={14} className="text-[#4ade80]" /><span>Programme transmis !</span></>
                                : sending
                                    ? <><Icon name="hourglass_top" size={14} /><span>Transmission…</span></>
                                    : tab !== 'summary'
                                        ? <><Icon name="summarize" size={14} /><span>Voir le résumé</span></>
                                        : <><Icon name="send" size={14} /><span>Valider J+1</span></>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Execution timer card ──────────────────────────────────────────────────────
function ExecutionCard({ feeder, onRestore })
{
    const [elapsed, setElapsed] = useState(feeder.elapsed ?? 0)

    useEffect(() => {
        const t = setInterval(() => setElapsed((e) => e + 1), 60_000)
        return () => clearInterval(t)
    }, [])

    const pct     = Math.min((elapsed / MAX_MIN) * 100, 100)
    const overdue = elapsed >= MAX_MIN

    return (
        <div className={`flex flex-col gap-space-xs p-space-sm border font-mono text-[10px] ${overdue ? 'border-error bg-error-container/10' : 'border-surface-container-high bg-surface-container'}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs min-w-0">
                    <span className={`font-bold shrink-0 ${overdue ? 'text-error' : 'text-secondary'}`}>{feeder.ref}</span>
                    <span className="text-on-surface truncate">{feeder.nom}</span>
                    <span className="text-on-surface-variant shrink-0">· {feeder.mw} MW · {feeder.priority}</span>
                </div>
                <button onClick={() => onRestore(feeder.ref)}
                    className={`px-space-sm py-space-xs font-bold uppercase transition-colors shrink-0 ${overdue ? 'bg-error text-background hover:bg-error-container hover:text-on-error-container' : 'bg-surface-container-high hover:bg-surface-container-highest text-secondary'}`}
                    type="button">
                    Retablir
                </button>
            </div>
            <div className="w-full bg-surface-container-lowest h-1.5 overflow-hidden">
                <div className={`h-full transition-all ${overdue ? 'bg-error' : 'bg-tertiary'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between">
                <span className={overdue ? 'text-error font-bold' : 'text-on-surface-variant'}>{elapsed} min {overdue ? '(DEPASSEMENT)' : ''}</span>
                <span className="text-on-surface-variant">{MAX_MIN} min max</span>
            </div>
        </div>
    )
}

// ── J+1 widget: today's programme at a glance ─────────────────────────────────
// Shows the 2 most-recent executed slots + the next upcoming slot with countdown.
// Uses the same bcc-slots endpoint but for today's date.
function J1Widget({ bccId, onOpenEditor })
{
    const [todaySlots, setTodaySlots] = useState([])
    const [now,        setNow]        = useState(new Date())

    // Live clock for countdown
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 30_000)
        return () => clearInterval(t)
    }, [])

    // Load today's programme on mount
    useEffect(() => {
        if (!bccId) return
        const today = new Date().toISOString().slice(0, 10)
        api.get(`/api/v1/programmes/bcc-slots?bcc_id=${bccId}&target_date=${today}`)
            .then(({ data }) => setTodaySlots(data.slots ?? []))
            .catch(() => {
                // Fallback: 3 illustrative slots
                setTodaySlots([
                    { time_slot: '14:00', mw_bcc: 40, source: 'mock_profile', feeders_count: 8, status: 'validated' },
                    { time_slot: '18:00', mw_bcc: 35, source: 'mock_profile', feeders_count: 0, status: 'pending'   },
                    { time_slot: '20:00', mw_bcc: 45, source: 'mock_profile', feeders_count: 0, status: 'pending'   },
                ])
            })
    }, [bccId])

    const today = new Date()
        .toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' })

    const tomorrow = new Date(Date.now() + 86400000)
        .toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' })

    // Find the current time slot index
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const slotIndex = todaySlots.findIndex((s) => {
        const [h, m] = s.time_slot.split(':').map(Number)
        return (h * 60 + m) > currentMinutes
    })
    const nextSlotIdx   = slotIndex === -1 ? todaySlots.length - 1 : slotIndex
    const prevSlots     = todaySlots.slice(Math.max(0, nextSlotIdx - 2), nextSlotIdx)
    const nextSlot      = todaySlots[nextSlotIdx]

    // Countdown to next slot
    const countdown = (() => {
        if (!nextSlot) return null
        const [h, m] = nextSlot.time_slot.split(':').map(Number)
        const slotMin = h * 60 + m
        const diff    = slotMin - currentMinutes
        if (diff <= 0) return null
        const hh = Math.floor(diff / 60), mm = diff % 60
        return hh > 0 ? `dans ${hh}h${mm.toString().padStart(2,'0')}` : `dans ${mm} min`
    })()

    return (
        <div className="bg-surface-container-low p-space-md shadow-md flex flex-col gap-space-sm">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container-high">
                <div className="flex items-center gap-space-sm">
                    <Icon name="calendar_clock" size={16} className="text-secondary" />
                    <h3 className="font-sans font-semibold text-xs text-on-surface uppercase">Programme J+1</h3>
                </div>
                <span className="font-mono text-[10px] text-on-surface-variant">{today}</span>
            </div>

            {/* Previous slots (executed) */}
            {prevSlots.length > 0 && (
                <div className="flex flex-col gap-space-xs">
                    <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-wider">Passés</span>
                    {prevSlots.map((s) => (
                        <div key={s.time_slot} className="flex items-center justify-between px-space-sm py-space-xs bg-surface-container/50 font-mono text-[10px] opacity-60">
                            <span className="text-on-surface flex items-center gap-space-xs">
                                <Icon name="check" size={11} className="text-[#4ade80]" />
                                {s.time_slot}
                            </span>
                            <span className="text-on-surface-variant">{s.mw_bcc.toFixed(0)} MW</span>
                            <span className="text-[#4ade80] font-bold">Exécuté</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Next slot — highlighted */}
            {nextSlot ? (
                <div className="flex flex-col gap-space-xs">
                    <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-wider">Prochain</span>
                    <div className="flex items-center justify-between px-space-sm py-space-sm bg-secondary-container/10 border border-secondary/30 font-mono text-[10px]">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-secondary font-bold text-xs">{nextSlot.time_slot}</span>
                            {countdown && <span className="text-on-surface-variant text-[9px]">{countdown}</span>}
                        </div>
                        <span className="text-on-surface font-bold">{nextSlot.mw_bcc.toFixed(0)} MW</span>
                        <span className={`font-bold text-[9px] ${(nextSlot.feeders_count ?? 0) > 0 ? 'text-secondary' : 'text-tertiary'}`}>
                            {(nextSlot.feeders_count ?? 0) > 0
                                ? `${nextSlot.feeders_count} départs`
                                : 'Non planifié'
                            }
                        </span>
                    </div>
                </div>
            ) : (
                <p className="font-mono text-[10px] text-on-surface-variant italic">Aucun créneau à venir aujourd'hui.</p>
            )}

            <button
                onClick={onOpenEditor}
                className="w-full flex items-center justify-center gap-space-xs py-space-xs bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs transition-colors border border-surface-container-high mt-space-xs"
                type="button"
            >
                <Icon name="edit_calendar" size={13} />
                <span>Ouvrir éditeur J+1 — {tomorrow}</span>
            </button>
        </div>
    )
}

// ── AI discussion panel (standalone slide-in — triggered from header button) ──
function AiDiscussionPanel({ isOpen, onClose, bccLabel })
{
    const [input, setInput] = useState('')
    const [msgs,  setMsgs]  = useState([
        {
            role: 'system',
            text: `Bonjour. Je suis votre assistant IA pour ${bccLabel}.\n\nJe peux analyser l'historique de délestage, suggérer les départs optimaux pour les ordres d'urgence et de réalimentation, et évaluer l'équité territoriale.\n\nComment puis-je vous aider ?`
        }
    ])

    const send = () => {
        if (!input.trim()) return
        const userText = input.trim()
        setInput('')
        setMsgs((m) => [...m, { role: 'user', text: userText }])
        setTimeout(() => {
            setMsgs((m) => [...m, {
                role: 'system',
                text: 'Analyse en cours sur réseau Béja/Jendouba…\n\nRecommandation : prioriser F21 (19 jours sans coupure) et F28 (24 jours) pour les créneaux de pointe. Éviter F18 sur 3 créneaux consécutifs — rotation requise.\n\nÉquité résultante : 91/100. P0 sanctuarisés.'
            }])
        }, 700)
    }

    return (
        <div className={`fixed top-14 bottom-8 right-0 w-96 max-w-[90vw] bg-surface-container-low shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out border-l border-surface-container-high ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="p-space-md bg-surface-container flex items-center justify-between border-b border-surface-container-high shrink-0">
                <div className="flex items-center gap-space-sm">
                    <div className="w-7 h-7 bg-secondary-container/30 border border-secondary/40 flex items-center justify-center text-secondary">
                        <Icon name="smart_toy" size={17} />
                    </div>
                    <div>
                        <span className="font-sans font-bold text-xs text-on-surface uppercase">Assistant IA — {bccLabel}</span>
                        <p className="font-mono text-[9px] text-secondary">OPTIMISATION ÉQUITÉ TERRITORIALE</p>
                    </div>
                </div>
                <button onClick={onClose} className="p-space-xs hover:bg-surface-container-high text-on-surface-variant transition-colors" type="button">
                    <Icon name="close" size={17} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-space-md flex flex-col gap-space-sm">
                {msgs.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] p-space-sm font-mono text-[10px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-secondary-container/20 border border-secondary/30 text-on-surface' : 'bg-surface-container-lowest border border-surface-container-high text-on-surface-variant'}`}>
                            {m.role === 'system' && <span className="text-secondary font-bold text-[9px] block mb-0.5 uppercase">Suggestion IA</span>}
                            {m.text}
                        </div>
                    </div>
                ))}
            </div>
            <div className="p-space-sm bg-surface-container border-t border-surface-container-high flex flex-col gap-space-xs shrink-0">
                <div className="flex items-center gap-space-xs">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') send() }}
                        placeholder="Question opérationnelle…"
                        className="flex-1 bg-surface-container-lowest border border-surface-container-high px-space-sm py-space-xs font-mono text-xs text-on-surface focus:border-secondary focus:outline-none"
                    />
                    <button onClick={send} className="p-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container border border-secondary transition-colors" type="button">
                        <Icon name="send" size={14} />
                    </button>
                </div>
                <p className="font-mono text-[9px] text-on-surface-variant text-center">Suggestions IA indicatives. Validation opérateur BCC obligatoire.</p>
            </div>
        </div>
    )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BCCDashboard()
{
    const { user }   = useAuthStore()

    // Derive BCC identity from logged-in user
    const bccName  = user?.bcc_name  ?? 'BCC ?'
    const bccZone  = user?.bcc_zone  ?? '—'
    const bccLabel = `${bccName} — ${bccZone}`
    const bccId    = user?.bcc_id    ?? null
    const bccTarget = CONSIGNES[bccName] ?? TARGET_MW

    const { orders, acknowledgeReceipt, executeComplete, cancelRealimOrders } = useBccOrderStore()

    const liveOrders        = useLiveStore((s) => s.orders)
    const addExecution      = useLiveStore((s) => s.addExecution)
    const updateExec        = useLiveStore((s) => s.updateExecution)
    const setBccActiveMW    = useLiveStore((s) => s.setBccActiveMW)
    const setBccTargetStore = useLiveStore((s) => s.setBccTarget)
    const ackBaselines      = useLiveStore((s) => s.ackBaselines)
    const frozenUrgenceDeltaStore    = useLiveStore((s) => s.frozenUrgenceDelta)
    const setFrozenUrgenceDeltaStore = useLiveStore((s) => s.setFrozenUrgenceDelta)
    const applyRealimToFrozen        = useLiveStore((s) => s.applyRealimToFrozen)

    const { initialPostes, initialDbExecIds, loading: stateLoading } = useBCCState()

    const [time,          setTime]         = useState(new Date())
    const [postes,        setPostes]       = useState(null)
    const [dbExecIds,     setDbExecIds]    = useState({})
    const [restored,      setRestored]     = useState([])
    const [j1Open,        setJ1Open]       = useState(false)
    const [aiOpen,        setAiOpen]       = useState(false)
    const [everValidated, setEverValidated]= useState(false)
    const [unlockedRefs,  setUnlockedRefs] = useState({})
    const [confirmUnlock, setConfirmUnlock]= useState(null)

    useEffect(() => {
        if (initialPostes) {
            setPostes(initialPostes)
            setDbExecIds(initialDbExecIds)
            const hasActive = initialPostes.flatMap((p) => p.feeders).some((f) => ['executing','overdue'].includes(f.status))
            if (hasActive) setEverValidated(true)
            const activeMWNow = initialPostes.flatMap((p) => p.feeders).filter((f) => ['executing','overdue'].includes(f.status)).reduce((s, f) => s + (f.mw ?? 0), 0)
            setBccActiveMW(activeMWNow)
        }
    }, [initialPostes, initialDbExecIds]) // eslint-disable-line react-hooks/exhaustive-deps

    const [auditLog, setAuditLog] = useState([
        { ref:'F18', nom:'Nefza Rural',     debut:'13:00', fin:'--:--', dur:'52 min', mw:2.6, statut:'overdue'   },
        { ref:'F07', nom:'Z.I. Beja Nord',  debut:'13:20', fin:'--:--', dur:'32 min', mw:4.2, statut:'executing' },
        { ref:'F09', nom:'Faubourg Est',    debut:'13:24', fin:'--:--', dur:'28 min', mw:3.8, statut:'executing' },
        { ref:'F25', nom:'Bou Salem Ctr',   debut:'13:37', fin:'--:--', dur:'15 min', mw:5.5, statut:'executing' },
        { ref:'F11', nom:'Testour Bourg',   debut:'13:00', fin:'13:45', dur:'45 min', mw:7.0, statut:'restored'  },
    ])

    useEffect(() => {
        const t = setInterval(() => setTime(new Date()), 1000)
        return () => clearInterval(t)
    }, [])

    const pad     = (n) => String(n).padStart(2, '0')
    const timeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())} UTC+1`

    // ── Orders ────────────────────────────────────────────────────────────────
    const dbActiveOrders = liveOrders
        .filter((o) => ['pending','acknowledged','executing'].includes(o.status) && o.issued_by_role !== 'DN')
        .map((o) => ({
            id:        o.id,
            orderRef:  o.order_ref,
            type:      o.order_type,
            mwTarget:  o.mw_total,
            time:      new Date(o.issued_at).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }),
            status:    o.status,
            isDbOrder: true,
        }))

    const legacyOrders = orders.filter(
        (o) => o.status !== 'executed' && !dbActiveOrders.find((d) => d.orderRef === o.orderRef)
    )
    const activeOrders  = [...dbActiveOrders, ...legacyOrders]
    const urgenceOrders = activeOrders.filter((o) => o.type === 'urgence')
    const realimOrders  = activeOrders.filter((o) => o.type === 'realim')

    const urgenceDelta = urgenceOrders.reduce((s, o) => s + o.mwTarget, 0)
    const realimDelta  = realimOrders.reduce ((s, o) => s + o.mwTarget, 0)
    const netOrderMW   = urgenceDelta - realimDelta

    const pendingUrgence = urgenceOrders.find((o) => o.status === 'pending')
    const pendingRealim  = realimOrders.find ((o) => o.status === 'pending')
    const pendingOrder   = pendingUrgence ?? pendingRealim ?? activeOrders.find((o) => o.status === 'pending')

    useEffect(() => {
        if (urgenceDelta > 0) setFrozenUrgenceDeltaStore(urgenceDelta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urgenceDelta])

    const effectiveFrozen = frozenUrgenceDeltaStore
    const netUrgence      = Math.max(0, effectiveFrozen - realimDelta)
    const netJ1Reduction  = Math.max(0, realimDelta - effectiveFrozen)
    const displayTotal    = Math.max(0, bccTarget + netUrgence - netJ1Reduction)

    const safePostes    = postes ?? []
    const allFeeders    = safePostes.flatMap((p) => p.feeders)
    const activeFeeders = allFeeders.filter((f) => f.status === 'executing' || f.status === 'overdue')
    const selectedMW    = allFeeders.filter((f) => ['selected','executing','overdue'].includes(f.status)).reduce((s, f) => s + f.mw, 0)
    const activeMW      = activeFeeders.reduce((s, f) => s + f.mw, 0)

    const anyPending   = activeOrders.some((o) => o.status === 'pending')
    const netBannerMet = activeOrders.length > 0 && netOrderMW >= 0 && activeMW >= netOrderMW - TOLERANCE

    useEffect(() => { setBccActiveMW(activeMW) }, [activeMW, setBccActiveMW])
    useEffect(() => { setBccTargetStore(bccTarget) }, [bccTarget, setBccTargetStore])

    const gap         = selectedMW - displayTotal
    const wouldExceed = selectedMW > displayTotal + TOLERANCE
    const withinTol   = displayTotal > 0 ? Math.abs(selectedMW - displayTotal) <= TOLERANCE : selectedMW <= TOLERANCE
    const hasOverdue  = activeFeeders.some((f) => f.status === 'overdue')

    const urgenceOrdersSorted = [...urgenceOrders].sort(
        (a, b) => new Date(a.issuedAt ?? a.issued_at ?? 0) - new Date(b.issuedAt ?? b.issued_at ?? 0)
    )
    const urgenceCumulativeTarget = new Map()
    let cumulative = 0
    for (const o of urgenceOrdersSorted) {
        cumulative += o.mwTarget
        urgenceCumulativeTarget.set(o.id, cumulative)
    }

    const isOrderMet = (order) => {
        if (order.type === 'urgence') {
            if (!order.mwTarget || order.mwTarget <= 0) return false
            const baseline = ackBaselines[order.id] ?? null
            const required = urgenceCumulativeTarget.get(order.id) ?? order.mwTarget
            if (baseline === null) return false
            const delta = Math.max(0, activeMW - baseline)
            return delta >= required - TOLERANCE
        }
        if (order.status === 'pending') return false
        const baseline = ackBaselines[order.id] ?? null
        if (baseline === null) return false
        const restoredMW = Math.max(0, baseline - activeMW)
        return restoredMW >= order.mwTarget - TOLERANCE
    }

    useEffect(() => {
        if (stateLoading) return
        const hasActiveDb = Object.keys(dbExecIds).length > 0
        if (activeMW === 0 && hasActiveDb) return
        activeOrders.forEach((o) => {
            if (!isOrderMet(o)) return
            if (o.isDbOrder) {
                updateOrderStatus(o.id, 'completed')
                useLiveStore.getState().clearAckBaseline(o.id)
                if (o.type === 'realim' && o.mwTarget > 0) useLiveStore.getState().applyRealimToFrozen(o.mwTarget)
                api.patch(`/api/v1/orders/${o.id}/complete`).catch((err) => console.error('[BCC] Failed to complete order:', err?.response?.data ?? err.message))
            } else {
                executeComplete(o.id)
            }
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeMW, activeOrders.length, stateLoading, ackBaselines])

    const hasAnySelected = allFeeders.some((f) => f.status === 'selected')
    const canValidate    = hasAnySelected

    const handleValidate = useCallback(async () => {
        if (!canValidate) return
        setEverValidated(true)

        const selectedFeeders = postes.flatMap((p) => p.feeders).filter((f) => f.status === 'selected')

        setPostes((prev) => prev.map((p) => ({
            ...p,
            feeders: p.feeders.map((f) => f.status === 'selected' ? { ...f, status:'executing', elapsed:0 } : f)
        })))

        const executedRefs = selectedFeeders.map((f) => f.ref)
        setUnlockedRefs((prev) => { const n = {...prev}; executedRefs.forEach((r) => delete n[r]); return n })
        setConfirmUnlock(null)

        activeOrders.filter((o) => o.status === 'pending' && !o.isDbOrder).forEach((o) => acknowledgeReceipt(o.id))

        const newDbExecIds = { ...dbExecIds }
        const now = new Date()
        const pad2 = (n) => String(n).padStart(2,'0')
        const tStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`

        for (const feeder of selectedFeeders) {
            const feederId = feeder.dbId ?? FEEDER_DB_ID[feeder.ref]
            if (!feederId) continue
            try {
                const { data: exec } = await api.post('/api/v1/executions', {
                    feeder_id: feederId, mw_shed: feeder.mw,
                    trigger:   urgenceOrders.length > 0 ? 'urgence' : 'j1',
                    order_id:  urgenceOrders[0]?.isDbOrder ? urgenceOrders[0].id : null,
                    notes:     `Valide par ${bccName} a ${tStr}`,
                })
                newDbExecIds[feeder.ref] = exec.id
                addExecution(exec)
                setAuditLog((log) => [{ ref:feeder.ref, nom:feeder.nom, debut:tStr, fin:'--:--', dur:'0 min', mw:feeder.mw, statut:'executing' }, ...log])
            } catch (err) {
                console.error(`[BCC] Failed to record execution for ${feeder.ref}:`, err?.response?.data ?? err.message)
            }
        }

        setDbExecIds(newDbExecIds)

        for (const order of activeOrders.filter((o) => o.status === 'pending' && o.isDbOrder)) {
            try {
                await api.patch(`/api/v1/orders/${order.id}/ack`, { mw_assigned: activeMW })
            } catch (err) {
                console.error('[BCC] Failed to ack order:', err?.response?.data ?? err.message)
            }
        }
    }, [canValidate, activeOrders, acknowledgeReceipt, postes, urgenceOrders, activeMW, dbExecIds, addExecution])

    const toggleFeeder = useCallback((posteId, ref) => {
        setPostes((prev) => prev.map((p) => p.id !== posteId ? p : {
            ...p,
            feeders: p.feeders.map((f) => {
                if (f.ref !== ref || f.locked) return f
                if (['cooldown','restored'].includes(f.status) && !unlockedRefs[ref]) return f
                if (['executing','overdue'].includes(f.status)) return f
                const currentStatus = ['cooldown','restored'].includes(f.status) ? 'available' : f.status
                return { ...f, status: currentStatus === 'selected' ? 'available' : 'selected' }
            })
        }))
    }, [unlockedRefs])

    const handleRestore = async (ref) => {
        const now    = new Date()
        const endStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`

        setPostes((prev) => prev.map((p) => ({
            ...p, feeders: p.feeders.map((f) => f.ref === ref ? { ...f, status:'restored', elapsed:0 } : f)
        })))
        setRestored((r) => [...r, ref])
        setAuditLog((log) => log.map((l) => l.ref === ref ? { ...l, fin:endStr, statut:'restored' } : l))

        const execId = dbExecIds[ref]
        if (execId) {
            try {
                const { data: exec } = await api.patch(`/api/v1/executions/${execId}/restore`, { notes: `Retabli par ${bccName} a ${endStr}` })
                updateExec(execId, { status:'restored', ended_at: exec.ended_at })
            } catch (err) {
                console.error(`[BCC] Failed to restore execution ${execId}:`, err?.response?.data ?? err.message)
            }
        }
    }

    const statutBadge = (s) => {
        if (s === 'overdue')   return <span className="px-space-xs py-0.5 bg-error text-background font-mono text-[9px] font-bold uppercase">DEPASSEMENT</span>
        if (s === 'executing') return <span className="px-space-xs py-0.5 bg-tertiary-container text-tertiary font-mono text-[9px] font-bold">EN COURS</span>
        if (s === 'restored')  return <span className="px-space-xs py-0.5 bg-surface-container text-secondary font-mono text-[9px] font-bold">RETABLI</span>
        return null
    }

    // ── Progress bar segments ─────────────────────────────────────────────────
    const displayUrgence = netUrgence
    const displayJ1      = bccTarget - netJ1Reduction
    const urgenceApplied = Math.min(activeMW, displayUrgence)
    const j1Applied      = Math.max(0, activeMW - displayUrgence)
    const pendingTotal   = Math.max(0, selectedMW - activeMW)
    const urgencePending = displayUrgence > 0 ? Math.min(pendingTotal, Math.max(0, displayUrgence - urgenceApplied)) : 0
    const j1Pending      = Math.max(0, pendingTotal - urgencePending)
    const barTotal        = displayTotal || 1
    const urg_exec_pct    = Math.min((urgenceApplied  / barTotal) * 100, 100)
    const urg_pend_pct    = Math.min((urgencePending  / barTotal) * 100, Math.max(0, (displayUrgence / barTotal) * 100 - urg_exec_pct))
    const j1_exec_pct     = Math.min((j1Applied       / barTotal) * 100, 100)
    const j1_pend_pct     = Math.min((j1Pending       / barTotal) * 100, 100)
    const executedPct     = displayTotal > 0 ? Math.min((activeMW       / displayTotal) * 100, 100) : 0
    const pendingPct      = displayTotal > 0 ? Math.min(((selectedMW - activeMW) / displayTotal) * 100, Math.max(0, 100 - executedPct)) : 0

    // ── AI digest (live, recomputed from current selection) ───────────────────
    // We don't have J+1 assignments in scope here — show a simpler live digest
    // about the current session's feeder selection vs. equity.
    const aiDigestLive = (() => {
        if (activeFeeders.length === 0 && !hasAnySelected)
            return { status: 'idle', text: 'Aucun départ actif. Sélectionnez des départs pour commencer.' }
        if (hasOverdue)
            return { status: 'warn', text: `DÉPASSEMENT DÉTECTÉ — ${activeFeeders.filter((f) => f.status === 'overdue').length} départ(s) dépassent 45 min. Rétablissement requis.` }
        if (withinTol && activeMW > 0)
            return { status: 'ok',   text: `Plan conforme — ${activeMW.toFixed(1)} MW actifs sur ${displayTotal.toFixed(1)} MW requis. Équité respectée.` }
        if (wouldExceed)
            return { status: 'warn', text: `Dépassement de ${(selectedMW - displayTotal).toFixed(1)} MW. Retirez des départs de la sélection.` }
        return { status: 'idle', text: `${selectedMW.toFixed(1)} MW sélectionnés — ${(displayTotal - selectedMW).toFixed(1)} MW restants à mobiliser.` }
    })()

    return (
        <div className="flex flex-col w-full text-on-surface">

            {/* SECTION 1 — Top bar */}
            <section className="flex flex-col gap-space-xs">
                <div className="bg-surface-container-low p-space-md flex flex-wrap items-center justify-between gap-space-md shadow-md">
                    <div className="flex flex-wrap items-center gap-space-md">
                        <div className="flex items-center gap-space-sm bg-surface-container-highest px-space-md py-space-xs">
                            <span className="w-2.5 h-2.5 rounded-full bg-tertiary animate-ping" />
                            <span className="font-mono font-bold text-sm text-secondary tracking-wide uppercase">{bccName}</span>
                            <span className="text-on-surface-variant font-mono text-xs">{bccZone.split('/')[0]?.trim().toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-space-xs font-mono text-xs">
                            <Icon name="schedule" size={14} className="text-secondary" />
                            <span>{timeStr}</span>
                        </div>
                        <div className="flex items-center gap-space-xs font-mono text-[10px] text-on-surface-variant">
                            <span>Tutelle :</span>
                            <span className="text-secondary font-semibold">
                                {bccZone.includes('Tunis') || bccZone.includes('Béja') || bccZone.includes('Bizerte')
                                    ? 'CRC NORD (Radès) · VHF 04-Nord'
                                    : 'CRC SUD (Sfax) · VHF 09-Sud'
                                }
                            </span>
                        </div>
                        <div className="flex items-center gap-space-xs px-space-sm py-0.5 bg-surface-container font-mono text-[10px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                            <span>SCADA IEC 104 · 20ms</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-space-md">
                        <button onClick={() => setJ1Open(true)} className="flex items-center gap-space-xs px-space-md py-space-xs bg-surface-container-high hover:bg-surface-container-highest text-secondary font-mono text-xs transition-colors" type="button">
                            <Icon name="event_note" size={14} /><span>Programme J+1</span>
                        </button>
                        <button onClick={() => setAiOpen(true)} className="flex items-center gap-space-xs px-space-md py-space-xs bg-secondary-container/30 hover:bg-secondary-container/60 text-secondary border border-secondary/40 font-mono text-xs transition-colors" type="button">
                            <Icon name="smart_toy" size={14} /><span>Assistant IA</span>
                        </button>
                    </div>
                </div>
                {/* Comms strip */}
                <div className="bg-surface-container-lowest px-space-md py-space-xs flex flex-wrap items-center justify-between font-mono text-[10px] text-on-surface-variant gap-space-md">
                    <div className="flex items-center gap-space-lg flex-wrap">
                        <div className="flex items-center gap-1"><span>Chef de quart :</span><span className="text-on-surface font-semibold ml-1">Tech. S. Dridi</span></div>
                        <div className="flex items-center gap-1"><span>Poste source :</span><span className="text-on-surface font-semibold ml-1">BEJA 90/30 kV (2 TR)</span></div>
                        <div className="flex items-center gap-space-xs">
                            <span>Consigne effective :</span>
                            <span className={`font-bold ml-1 ${urgenceDelta > 0 ? 'text-error' : frozenUrgenceDeltaStore > 0 ? 'text-tertiary' : realimDelta > 0 ? 'text-[#4ade80]' : 'text-secondary'}`}>
                                {displayTotal.toFixed(1)} MW
                            </span>
                            {urgenceDelta > 0 && realimDelta === 0 && <span className="text-error ml-1">({urgenceDelta} URG + {bccTarget} J+1)</span>}
                            {urgenceDelta > 0 && realimDelta > 0  && <span className="text-error ml-1">({urgenceDelta} URG −{realimDelta} REA + {bccTarget} J+1)</span>}
                            {urgenceDelta === 0 && frozenUrgenceDeltaStore > 0 && realimDelta === 0 && <span className="text-tertiary ml-1">({frozenUrgenceDeltaStore} URG satisfait + {bccTarget} J+1)</span>}
                            {urgenceDelta === 0 && frozenUrgenceDeltaStore > 0 && realimDelta > 0 && (
                                <span className="text-[#4ade80] ml-1">
                                    ({frozenUrgenceDeltaStore} URG satisfait −{realimDelta} REA
                                    {netUrgence > 0 ? ` → URG réduit à ${netUrgence}` : ` → URG annulé${netJ1Reduction > 0 ? `, J+1 −${netJ1Reduction}` : ''}`})
                                </span>
                            )}
                            {frozenUrgenceDeltaStore === 0 && realimDelta > 0 && <span className="text-[#4ade80] ml-1">(−{realimDelta} MW retabl.)</span>}
                        </div>
                    </div>
                    <div className={`flex items-center gap-space-xs px-space-sm py-0.5 font-semibold ${everValidated ? 'bg-secondary-container/20 text-secondary' : 'bg-tertiary-container/30 text-tertiary'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${everValidated ? 'bg-secondary' : 'bg-tertiary animate-pulse'}`} />
                        <span>{everValidated ? `EXECUTION EN COURS — ${activeMW.toFixed(1)} MW` : 'EN ATTENTE DE VALIDATION'}</span>
                    </div>
                </div>
            </section>

            {/* ALERT BANNER */}
            {activeOrders.length > 0 && netOrderMW !== 0 && (
                <section className="px-space-md pt-space-md">
                    {(() => {
                        const isShed  = netOrderMW > 0
                        const absMW   = Math.abs(netOrderMW)
                        const subLabel = urgenceDelta > 0 && realimDelta > 0
                            ? `(${urgenceDelta} URG − ${realimDelta} REA = ${absMW.toFixed(1)} MW net)` : null
                        return (
                            <div className={`flex flex-wrap items-center justify-between gap-space-md px-space-md py-space-sm border-l-4 font-mono text-xs ${isShed ? 'bg-error-container/20 border-error' : 'bg-[#4ade80]/10 border-[#4ade80]'} ${netBannerMet ? 'opacity-50' : ''}`}>
                                <div className="flex items-center gap-space-md flex-wrap">
                                    <Icon name={isShed ? 'bolt' : 'refresh'} size={16} className={isShed ? 'text-error animate-pulse' : 'text-[#4ade80]'} />
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-space-sm flex-wrap">
                                            <span className={`font-bold uppercase text-[10px] px-space-xs py-0.5 ${isShed ? 'bg-error text-background' : 'bg-[#4ade80]/20 text-[#4ade80]'}`}>
                                                {isShed ? 'DELESTAGE URGENCE' : 'REALIMENTATION'}
                                            </span>
                                            <span className="text-on-surface-variant text-[10px]">{activeOrders.map((o) => o.orderRef).join(' · ')}</span>
                                            {subLabel && <span className={`text-[9px] font-mono px-space-xs py-0.5 ${isShed ? 'bg-error-container/40 text-error' : 'bg-[#4ade80]/10 text-[#4ade80]'}`}>{subLabel}</span>}
                                        </div>
                                        <span className="text-on-surface text-[11px]">
                                            {isShed
                                                ? netBannerMet
                                                    ? `SATISFAIT — ${activeMW.toFixed(1)} MW actifs couvrent l'obligation nette`
                                                    : `Couper ${absMW.toFixed(1)} MW nets en urgence — ${Math.max(0, absMW - activeMW).toFixed(1)} MW restants`
                                                : `Retablir ${absMW.toFixed(1)} MW nets — Utiliser le bouton Retablir sur les departs en cours`
                                            }
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-space-sm shrink-0">
                                    {netBannerMet ? (
                                        <span className="flex items-center gap-space-xs px-space-md py-space-xs bg-[#4ade80]/20 text-[#4ade80] font-bold text-[10px] uppercase">
                                            <Icon name="check_circle" size={13} />MISSION ACCOMPLIE
                                        </span>
                                    ) : anyPending && pendingOrder ? (
                                        <button onClick={() => acknowledgeReceipt(pendingOrder.id)}
                                            className={`px-space-md py-space-xs font-bold text-[10px] uppercase transition-colors ${isShed ? 'bg-error-container hover:bg-error text-on-error-container' : 'bg-[#4ade80]/20 hover:bg-[#4ade80]/40 text-[#4ade80]'}`}
                                            type="button">Recu — Pris en charge</button>
                                    ) : (
                                        <span className={`px-space-xs py-0.5 font-bold text-[10px] uppercase ${isShed ? 'bg-error-container/40 text-error' : 'bg-[#4ade80]/10 text-[#4ade80]'}`}>EN COURS D'EXECUTION</span>
                                    )}
                                </div>
                            </div>
                        )
                    })()}
                </section>
            )}

            {/* SECTION 2 — KPI row */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-space-md p-space-md">
                {[
                    { label:'Consigne Effective', value:displayTotal.toFixed(1), unit:'MW',
                      cls: urgenceDelta>0 ? 'text-error' : frozenUrgenceDeltaStore>0 ? 'text-tertiary' : realimDelta>0 ? 'text-[#4ade80]' : 'text-secondary',
                      icon: urgenceDelta>0 ? 'warning' : realimDelta>0 ? 'refresh' : 'assignment',
                      sub: urgenceDelta>0 ? `J+1 ${bccTarget}+URG ${urgenceDelta}` : realimDelta>0 ? `J+1 ${bccTarget}−REA ${realimDelta}` : 'Transmise a 14h00' },
                    { label:'Selection Prete',    value:selectedMW.toFixed(1), unit:'MW', cls:wouldExceed?'text-error':withinTol?'text-secondary':'text-tertiary', icon:'verified',  sub:`${allFeeders.filter((f)=>['selected','executing','overdue'].includes(f.status)).length} departs` },
                    { label:'Actuel Deleste',     value:activeMW.toFixed(1),   unit:'MW', cls:'text-tertiary',  icon:'power_off', sub:`${activeFeeders.length} departs coupes` },
                    { label:'Rotation Moy.',      value:'32',                  unit:'min', cls:hasOverdue?'text-error':'text-on-surface', icon:'timer', sub:'Plafond : 45 min' },
                ].map(({ label, value, unit, cls, icon, sub }) => (
                    <div key={label} className="bg-surface-container-low p-space-md flex flex-col justify-between shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] text-on-surface-variant uppercase">{label}</span>
                            <Icon name={icon} size={16} className={cls} />
                        </div>
                        <div className="my-space-xs flex items-baseline gap-space-xs">
                            <span className={`font-mono text-3xl font-bold ${cls}`}>{value}</span>
                            <span className="font-mono text-sm text-on-surface-variant">{unit}</span>
                        </div>
                        <span className="font-mono text-[10px] text-on-surface-variant">{sub}</span>
                    </div>
                ))}
            </section>

            {/* SECTION 3 — Tile grid + side panel */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-space-md px-space-md pb-space-md">

                {/* Left 8/12 — tile grid */}
                <div className="lg:col-span-8 flex flex-col gap-space-md">
                    <div className="bg-surface-container-low p-space-md shadow-md flex flex-col gap-space-md">
                        <div className="flex flex-wrap items-center justify-between gap-space-sm">
                            <div>
                                <div className="flex items-center gap-space-sm">
                                    <Icon name="schema" size={18} className="text-secondary" />
                                    <h2 className="font-sans font-semibold text-sm text-on-surface uppercase tracking-wide">Ordonnancement HTA — Beja 90/30 kV</h2>
                                </div>
                                <p className="font-mono text-[10px] text-on-surface-variant mt-space-xs">Cliquez pour selectionner · P0 = inviolable · Validation partielle autorisee</p>
                            </div>
                            <div className="flex items-center gap-space-md font-mono text-[9px] flex-wrap">
                                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-surface-container-low border border-surface-container-high inline-block" /> Disponible</span>
                                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-secondary-container inline-block" /> Selectionne</span>
                                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-[#ffb95f]/20 border border-[#ffb95f] inline-block" /> En cours</span>
                                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-error-container inline-block" /> Depassement</span>
                            </div>
                        </div>

                        {/* Tile columns */}
                        <div className="flex gap-space-sm w-full">
                            {safePostes.map((poste) => (
                                <div key={poste.id} className="flex-1 flex flex-col gap-space-xs min-w-0">
                                    <div className="bg-surface-container-high px-space-xs py-space-xs text-center font-mono text-[10px] font-bold text-secondary uppercase tracking-wider">
                                        {poste.label}<br />
                                        <span className="text-on-surface-variant font-normal normal-case">{poste.sub}</span>
                                    </div>
                                    {poste.feeders.map((f) => {
                                        const isUnlocked   = !!unlockedRefs[f.ref]
                                        const isConfirming = confirmUnlock === f.ref
                                        return (
                                        <div key={f.ref}
                                            onClick={() => !isConfirming && !f.locked && (['cooldown','restored'].includes(f.status) ? isUnlocked : true) && !['executing','overdue'].includes(f.status) && toggleFeeder(poste.id, f.ref)}
                                            className={`w-full p-space-xs flex flex-col gap-0.5 transition-all ${isConfirming ? 'border border-tertiary/60 bg-surface-container-highest cursor-default' : tileCls(f)} ${isUnlocked && ['cooldown','restored'].includes(f.status) && !isConfirming ? '!opacity-100 !cursor-pointer border-tertiary/50' : ''}`}
                                            title={!isConfirming && ['cooldown','restored'].includes(f.status) && !isUnlocked ? `En repos — ${f.cooldownRemaining ?? '?'}h restante(s)` : f.locked && !isConfirming ? 'Infrastructure critique P0 — verrouillé' : ''}
                                        >
                                            {isConfirming && !isUnlocked ? (
                                                <>
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-mono text-[10px] font-bold text-tertiary">{f.ref}</span>
                                                        <span className={`font-mono text-[9px] px-0.5 ${priorityCls(f)}`}>{f.priority}</span>
                                                    </div>
                                                    <span className="font-mono text-[9px] text-tertiary font-bold uppercase tracking-wider">Dérogation équité</span>
                                                    <span className="font-mono text-[9px] text-on-surface-variant leading-tight">Repos {f.cooldownRemaining}h restante{(f.cooldownRemaining ?? 0) > 1 ? 's' : ''}. Confirmer ?</span>
                                                    <div className="flex gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                                                        <button type="button" onClick={(e) => { e.stopPropagation(); setUnlockedRefs((prev) => ({...prev, [f.ref]: true})); setConfirmUnlock(null) }} className="flex-1 py-0.5 bg-tertiary/20 hover:bg-tertiary/40 text-tertiary font-mono text-[9px] font-bold border border-tertiary/40 transition-colors">Confirmer</button>
                                                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmUnlock(null) }} className="flex-1 py-0.5 bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-mono text-[9px] border border-surface-container-high transition-colors">Annuler</button>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="flex items-center justify-between">
                                                        <span className={`font-mono text-[10px] font-bold ${refCls(f)}`}>{f.ref}</span>
                                                        {f.locked ? <Icon name="lock" size={11} className="text-error" /> : <span className={`font-mono text-[9px] px-0.5 ${priorityCls(f)}`}>{f.priority}</span>}
                                                    </div>
                                                    <span className="font-mono text-[10px] text-on-surface-variant leading-tight truncate">{f.nom}</span>
                                                    <span className={`font-mono text-[11px] font-bold ${mwCls(f)}`}>{f.locked ? f.priority : `${f.mw} MW`}</span>
                                                    <div className="flex items-center justify-between mt-0.5">
                                                        <span className="font-mono text-[9px] text-on-surface-variant">
                                                            {f.locked ? 'VERROUILLE'
                                                                : (f.status === 'cooldown' || f.status === 'restored') && !isUnlocked ? `REPOS ${f.cooldownRemaining ?? ''}h`
                                                                : (f.status === 'cooldown' || f.status === 'restored') && isUnlocked  ? 'DEROGATION'
                                                                : f.status === 'executing' ? `${f.elapsed} min`
                                                                : f.status === 'overdue'   ? `${f.elapsed}m >45!`
                                                                : f.hoursAgoCut !== null   ? `${f.hoursAgoCut < 24 ? f.hoursAgoCut.toFixed(0)+'h' : (f.hoursAgoCut/24).toFixed(1)+'j'}` : ''}
                                                        </span>
                                                        {(f.status === 'cooldown' || f.status === 'restored') && !f.locked && (
                                                            <button type="button"
                                                                title={isUnlocked ? 'Dérogation active — cliquer pour annuler' : 'Déroger — forcer la disponibilité'}
                                                                onClick={(e) => { e.stopPropagation(); isUnlocked ? (setUnlockedRefs((prev) => { const n = {...prev}; delete n[f.ref]; return n }), setConfirmUnlock(null)) : setConfirmUnlock((prev) => prev === f.ref ? null : f.ref) }}
                                                                className={`flex-shrink-0 flex items-center justify-center w-4 h-4 border transition-all ${isUnlocked ? 'bg-tertiary/30 border-tertiary text-tertiary hover:bg-tertiary/50' : 'bg-surface-container-high border-tertiary/60 text-tertiary hover:bg-tertiary/20 hover:border-tertiary'}`}
                                                            >
                                                                <Icon name={isUnlocked ? 'lock_open' : 'no_encryption'} size={10} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        )
                                    })}
                                </div>
                            ))}
                        </div>

                        {/* MW balance bar + Validate */}
                        <div className="flex flex-col md:flex-row items-center justify-between gap-space-md bg-surface-container p-space-md">
                            <div className="w-full md:w-3/5 flex flex-col gap-space-xs">
                                <div className="flex items-center justify-between font-mono text-[10px]">
                                    <span className="text-on-surface font-semibold">
                                        PUISSANCE MOBILISEE :&nbsp;
                                        <span className={wouldExceed ? 'text-error' : withinTol ? 'text-secondary' : 'text-tertiary'}>{selectedMW.toFixed(1)} MW</span>
                                        &nbsp;/ {displayTotal.toFixed(1)} MW
                                    </span>
                                    <span className={`px-space-xs py-0.5 font-bold ${wouldExceed ? 'bg-error-container text-on-error-container' : withinTol ? 'bg-surface-container-high text-secondary' : 'bg-tertiary-container/30 text-tertiary'}`}>
                                        {wouldExceed
                                            ? `DEPASSEMENT +${(selectedMW - displayTotal).toFixed(1)} MW`
                                            : `Ecart: ${(selectedMW - displayTotal) >= 0 ? '+' : ''}${(selectedMW - displayTotal).toFixed(1)} MW ${withinTol ? '(CONFORME)' : '(INCOMPLET)'}`}
                                    </span>
                                </div>
                                <div className="w-full h-3 bg-surface-container-lowest overflow-hidden flex">
                                    {displayUrgence > 0 ? (
                                        <>
                                            <div className="h-full bg-error transition-all shrink-0" style={{ width: `${urg_exec_pct}%` }} />
                                            <div className="h-full bg-error/40 transition-all shrink-0" style={{ width: `${urg_pend_pct}%` }} />
                                            <div className="h-full bg-tertiary transition-all shrink-0" style={{ width: `${j1_exec_pct}%` }} />
                                            <div className={`h-full transition-all shrink-0 ${wouldExceed ? 'bg-error' : 'bg-secondary-container'}`} style={{ width: `${j1_pend_pct}%` }} />
                                        </>
                                    ) : (
                                        <>
                                            <div className="h-full bg-tertiary transition-all" style={{ width: `${executedPct}%` }} />
                                            <div className={`h-full transition-all ${wouldExceed ? 'bg-error' : 'bg-secondary-container'}`} style={{ width: `${Math.max(0, pendingPct)}%` }} />
                                        </>
                                    )}
                                </div>
                                <div className="flex justify-between font-mono text-[9px] text-on-surface-variant">
                                    <span>0 MW</span>
                                    {displayUrgence > 0
                                        ? <><span className={`font-bold ${urgenceDelta > 0 ? 'text-error' : 'text-error/60'}`}>URG : {displayUrgence.toFixed(0)} MW{urgenceDelta === 0 ? ' ✓' : ''}</span>
                                            <span className="font-bold text-tertiary">J+1 : {displayJ1.toFixed(0)} MW{netJ1Reduction > 0 ? ` (−${netJ1Reduction.toFixed(0)} REA)` : ''}</span></>
                                        : realimDelta > 0
                                            ? <span className="font-bold text-[#4ade80]">Retabl. : −{realimDelta.toFixed(0)} MW · Cible J+1 : {displayTotal.toFixed(1)} MW</span>
                                            : <span className="font-bold text-secondary">Cible J+1 : {bccTarget.toFixed(1)} MW</span>
                                    }
                                    <span className={`font-bold ${displayUrgence > 0 ? 'text-error' : realimDelta > 0 ? 'text-[#4ade80]' : 'text-secondary'}`}>Total : {displayTotal.toFixed(1)} MW</span>
                                </div>
                            </div>
                            <button onClick={handleValidate} disabled={!canValidate}
                                className={`flex items-center justify-center gap-space-sm px-space-xl py-space-md font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed ${wouldExceed ? 'bg-error-container text-on-error-container' : 'bg-secondary-container hover:bg-secondary text-on-secondary-container'}`}
                                type="button">
                                <Icon name={everValidated ? 'add_circle' : 'bolt'} size={18} />
                                <span>{wouldExceed ? `Depassement +${(selectedMW - displayTotal).toFixed(1)} MW` : everValidated ? `Valider round suivant (${selectedMW.toFixed(1)} MW)` : `Valider & Executer (${selectedMW.toFixed(1)} MW)`}</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right 4/12 — execution + AI digest + J+1 widget */}
                <div className="lg:col-span-4 flex flex-col gap-space-md">

                    {/* Execution tracking */}
                    <div className="bg-surface-container-low p-space-md shadow-md flex flex-col gap-space-sm">
                        <div className="flex items-center justify-between pb-space-xs border-b border-surface-container-high">
                            <div className="flex items-center gap-space-sm">
                                <Icon name="timelapse" size={16} className={hasOverdue ? 'text-error animate-pulse' : 'text-tertiary'} />
                                <h3 className="font-sans font-semibold text-xs text-on-surface uppercase">Departs en cours</h3>
                            </div>
                            <span className="font-mono text-[10px] text-tertiary font-bold">{activeFeeders.length} ACTIFS</span>
                        </div>
                        {hasOverdue && (
                            <div className="flex items-center gap-space-xs px-space-sm py-space-xs bg-error-container/20 border border-error/40 font-mono text-[10px] text-error">
                                <Icon name="warning" size={13} className="animate-pulse" />
                                <span>Depassement 45 min — Realimentation requise</span>
                            </div>
                        )}
                        {activeFeeders.length === 0
                            ? <p className="font-mono text-[10px] text-on-surface-variant italic">Aucun depart en cours.</p>
                            : activeFeeders.map((f) => <ExecutionCard key={f.ref} feeder={f} onRestore={handleRestore} />)
                        }
                        {restored.length > 0 && (
                            <div className="pt-space-xs border-t border-surface-container-high">
                                <p className="font-mono text-[9px] text-on-surface-variant uppercase mb-space-xs">Retablis ({restored.length})</p>
                                {allFeeders.filter((f) => restored.includes(f.ref)).map((f) => (
                                    <div key={f.ref} className="flex items-center gap-space-xs font-mono text-[10px] text-secondary mb-0.5">
                                        <Icon name="check_circle" size={11} />
                                        <span>{f.ref} — {f.nom} · {f.mw} MW</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── AI digest card (replaces old static "Assistant IA" widget) ── */}
                    <div className="bg-surface-container-low p-space-md shadow-md flex flex-col gap-space-sm">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-space-sm">
                                <Icon name="psychology" size={16} className="text-secondary" />
                                <h3 className="font-sans font-semibold text-xs text-on-surface uppercase">Assistant IA</h3>
                            </div>
                            <span className={`w-2 h-2 rounded-full ${aiDigestLive.status === 'ok' ? 'bg-[#4ade80] animate-pulse' : aiDigestLive.status === 'warn' ? 'bg-error animate-pulse' : 'bg-on-surface-variant'}`} />
                        </div>
                        <div className={`p-space-sm font-mono text-[10px] leading-relaxed border ${aiDigestLive.status === 'ok' ? 'bg-[#4ade80]/5 border-[#4ade80]/20 text-on-surface' : aiDigestLive.status === 'warn' ? 'bg-error-container/10 border-error/20 text-on-surface' : 'bg-surface-container-lowest border-surface-container-high text-on-surface-variant'}`}>
                            <span className={`font-bold text-[9px] block mb-space-xs uppercase ${aiDigestLive.status === 'ok' ? 'text-[#4ade80]' : aiDigestLive.status === 'warn' ? 'text-error' : 'text-secondary'}`}>
                                {aiDigestLive.status === 'ok' ? 'SITUATION NORMALE' : aiDigestLive.status === 'warn' ? 'ATTENTION' : 'EN VEILLE'}
                            </span>
                            {aiDigestLive.text}
                        </div>
                        <button
                            onClick={() => setAiOpen(true)}
                            className="w-full flex items-center justify-center gap-space-xs py-space-xs bg-surface-container-highest hover:bg-secondary-container hover:text-on-secondary-container text-secondary font-mono text-xs font-bold transition-colors"
                            type="button"
                        >
                            <Icon name="chat" size={13} /><span>Ouvrir discussion</span>
                        </button>
                    </div>

                    {/* J+1 widget — today's schedule at a glance */}
                    <J1Widget bccId={bccId} onOpenEditor={() => setJ1Open(true)} />
                </div>
            </section>

            {/* SECTION 4 — Audit log */}
            <section className="px-space-md pb-space-md">
                <div className="bg-surface-container-low shadow-md flex flex-col overflow-hidden">
                    <div className="bg-surface-container-lowest px-space-md py-space-sm border-b border-surface-container-high flex items-center gap-space-sm">
                        <Icon name="history" size={16} className="text-secondary" />
                        <h3 className="font-sans font-semibold text-xs text-on-surface uppercase">Journal des Manoeuvres HTA — Session en cours</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left font-mono text-[10px]">
                            <thead className="bg-surface-container font-mono text-[9px] text-on-surface-variant uppercase tracking-wider">
                                <tr>
                                    <th className="py-space-sm px-space-md">Ref.</th>
                                    <th className="py-space-sm px-space-md">Nom</th>
                                    <th className="py-space-sm px-space-md text-center">Debut</th>
                                    <th className="py-space-sm px-space-md text-center">Fin</th>
                                    <th className="py-space-sm px-space-md text-center">Duree</th>
                                    <th className="py-space-sm px-space-md text-right">MW</th>
                                    <th className="py-space-sm px-space-md">Operateur</th>
                                    <th className="py-space-sm px-space-md text-center">Statut</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-container-high">
                                {auditLog.map((l, i) => (
                                    <tr key={i} className={`transition-colors ${l.statut === 'overdue' ? 'bg-error-container/20 border-l-2 border-error hover:bg-error-container/30' : 'bg-surface-container-low hover:bg-surface-container'}`}>
                                        <td className={`py-space-sm px-space-md font-bold ${l.statut === 'overdue' ? 'text-error' : l.statut === 'restored' ? 'text-on-surface-variant' : 'text-secondary'}`}>{l.ref}</td>
                                        <td className="py-space-sm px-space-md text-on-surface">{l.nom}</td>
                                        <td className="py-space-sm px-space-md text-center text-on-surface-variant">{l.debut}</td>
                                        <td className="py-space-sm px-space-md text-center text-on-surface-variant">{l.fin}</td>
                                        <td className={`py-space-sm px-space-md text-center font-bold ${l.statut === 'overdue' ? 'text-error' : l.statut === 'executing' ? 'text-tertiary' : 'text-on-surface-variant'}`}>{l.dur}</td>
                                        <td className="py-space-sm px-space-md text-right font-bold text-secondary">{l.mw} MW</td>
                                        <td className="py-space-sm px-space-md text-on-surface-variant">Tech. S. Dridi</td>
                                        <td className="py-space-sm px-space-md text-center">{statutBadge(l.statut)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            <ProgrammeJ1Modal isOpen={j1Open} onClose={() => setJ1Open(false)} bccLabel={bccLabel} bccId={bccId} bccName={bccName} />
            <AiDiscussionPanel isOpen={aiOpen} onClose={() => setAiOpen(false)} bccLabel={bccLabel} />
        </div>
    )
}
