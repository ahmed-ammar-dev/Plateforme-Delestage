import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAuthStore }       from '../../stores/authStore'
import { useUrgenceStore }    from '../../stores/urgenceStore'
import { useCRCDashboard }    from '../../hooks/useCRCDashboard'
import { useLiveStore }       from '../../stores/liveStore'
import { useTimeseries }      from '../../hooks/useTimeseries'
import { useProgrammesStore } from '../../stores/programmesStore'
import { useAlertStore }      from '../../stores/alertStore'
import api                    from '../../lib/api'

// ── Icon helper ───────────────────────────────────────────────────────────────
function Icon({ name, size = 18, className = '' })
{
    return (
        <span
            className={`material-symbols-outlined ${className}`}
            style={{ fontSize: size }}
        >
            {name}
        </span>
    )
}

// ── Static data ───────────────────────────────────────────────────────────────
const BCC_STATUS =
[
    {
        id:       1
        ,label:   'BCC 1 — Tunis N.'
        ,full:    'BCC 1 — Tunis Ville & Nord'
        ,sub:     'Postes 90kV: El Menzah, Charguia'
        ,consigne: 110
        ,realise:  110
        ,pct:      100
        ,dot:      'bg-[#4ade80]'
        ,dotAnim:  ''
        ,barCls:   'bg-secondary'
        ,note:     '8 postes 90kV'
        ,noteCls:  'text-[#4ade80]'
    }
    ,{
        id:       2
        ,label:   'BCC 2 — Tunis S.'
        ,full:    'BCC 2 — Tunis Sud & Ben Arous'
        ,sub:     'Postes 90kV: Naassen, Mghira'
        ,consigne: 90
        ,realise:  90
        ,pct:      100
        ,dot:      'bg-[#4ade80]'
        ,dotAnim:  ''
        ,barCls:   'bg-secondary'
        ,note:     '6 postes 90kV'
        ,noteCls:  'text-[#4ade80]'
    }
    ,{
        id:       3
        ,label:   'BCC 3 — Béja'
        ,full:    'BCC 3 — Nord-Ouest (Béja / Jendouba)'
        ,sub:     'Postes 90kV: Béja, Jendouba'
        ,consigne: 58
        ,realise:  40
        ,pct:      68.9
        ,dot:      'bg-error'
        ,dotAnim:  'animate-ping'
        ,barCls:   'bg-error'
        ,note:     'D22 HS Béja'
        ,noteCls:  'text-error font-bold'
    }
    ,{
        id:       4
        ,label:   'BCC 4 — Bizerte'
        ,full:    'BCC 4 — Bizerte / Mateur'
        ,sub:     'Postes 90kV: Bizerte, Mateur'
        ,consigne: 42
        ,realise:  42
        ,pct:      100
        ,dot:      'bg-[#4ade80]'
        ,dotAnim:  ''
        ,barCls:   'bg-secondary'
        ,note:     '5 postes 90kV'
        ,noteCls:  'text-[#4ade80]'
    }
]

// Accordion tree data — live shedding per BCC
const LIVE_TREE =
[
    {
        id:       'bcc1'
        ,label:   'BCC 1 — Grand Tunis Nord'
        ,count:   14
        ,mw:      '110,0 MW'
        ,hasAlert: false
        ,departs:
        [
            { ref: 'D30-F03', nom: 'Charguia Tertiaire',      mw: '8,4 MW',  dur: 28, statut: 'ok'      }
            ,{ ref: 'D30-F12', nom: 'Ariana Riadh',           mw: '6,2 MW',  dur: 19, statut: 'ok'      }
            ,{ ref: 'D30-F17', nom: 'El Menzah Résidentiel',  mw: '5,8 MW',  dur: 22, statut: 'ok'      }
        ]
    }
    ,{
        id:       'bcc2'
        ,label:   'BCC 2 — Tunis Sud & Ben Arous'
        ,count:   12
        ,mw:      '90,0 MW'
        ,hasAlert: false
        ,departs:
        [
            { ref: 'D30-F08', nom: 'Ben Arous Industriel',    mw: '9,1 MW',  dur: 34, statut: 'ok'      }
            ,{ ref: 'D30-F15', nom: 'Mégrine Sud',            mw: '5,5 MW',  dur: 22, statut: 'ok'      }
        ]
    }
    ,{
        id:       'bcc3'
        ,label:   'BCC 3 — Nord-Ouest (Béja)'
        ,count:   8
        ,mw:      '40,0 / 58 MW'
        ,hasAlert: true
        ,alertLabel: '1 OVERDUE'
        ,departs:
        [
            { ref: 'D30-F18', nom: 'Nefza Rural (Béja 90kV)', mw: '4,8 MW',  dur: 52, statut: 'overdue' }
            ,{ ref: 'D30-F04', nom: 'Medjez El Bab Centre',   mw: '7,2 MW',  dur: 31, statut: 'ok'      }
            ,{ ref: 'D30-F09', nom: 'Tabarka Urbain',         mw: '6,0 MW',  dur: 18, statut: 'ok'      }
        ]
    }
    ,{
        id:       'bcc4'
        ,label:   'BCC 4 — Bizerte / Mateur'
        ,count:   8
        ,mw:      '42,0 MW'
        ,hasAlert: false
        ,departs:
        [
            { ref: 'D30-F02', nom: 'Menzel Bourguiba Z.I.',   mw: '11,0 MW', dur: 39, statut: 'ok'      }
            ,{ ref: 'D30-F07', nom: 'Ras Jebel Nord',         mw: '5,2 MW',  dur: 14, statut: 'ok'      }
        ]
    }
]

// Full cuts table data
const CUTS_DATA =
[
    { id:1, bcc:'BCC 3', bccShort:'BCC 3 (Nord-Ouest)', ref:'D30-F18', poste:'BÉJA 90kV / Nefza Rural',              debut:'13:55:10', dur:52, mw:4.8,  statut:'overdue'  }
    ,{ id:2, bcc:'BCC 4', bccShort:'BCC 4 (Bizerte)',    ref:'D30-F02', poste:'MATEUR 90kV / Menzel Bourguiba Z.I.',  debut:'14:08:44', dur:39, mw:11.0, statut:'ok'       }
    ,{ id:3, bcc:'BCC 2', bccShort:'BCC 2 (Tunis Sud)',  ref:'D30-F08', poste:'NAASSEN 90kV / Ben Arous Industriel',  debut:'14:13:20', dur:34, mw:9.1,  statut:'ok'       }
    ,{ id:4, bcc:'BCC 3', bccShort:'BCC 3 (Nord-Ouest)', ref:'D30-F04', poste:'BÉJA 90kV / Medjez El Bab Centre',    debut:'14:16:02', dur:31, mw:7.2,  statut:'ok'       }
    ,{ id:5, bcc:'BCC 1', bccShort:'BCC 1 (Tunis Nord)', ref:'D30-F03', poste:'EL MENZAH 90kV / Charguia Tertiaire', debut:'14:19:15', dur:28, mw:8.4,  statut:'ok'       }
    ,{ id:6, bcc:'BCC 2', bccShort:'BCC 2 (Tunis Sud)',  ref:'D30-F15', poste:'MGHIRA 90kV / Mégrine Sud F2',        debut:'14:25:00', dur:22, mw:5.5,  statut:'ok'       }
    ,{ id:7, bcc:'BCC 1', bccShort:'BCC 1 (Tunis Nord)', ref:'D30-F12', poste:'CHARGUIA 90kV / Ariana Riadh',        debut:'14:28:41', dur:19, mw:6.2,  statut:'ok'       }
    ,{ id:8, bcc:'BCC 4', bccShort:'BCC 4 (Bizerte)',    ref:'D30-F07', poste:'BIZERTE 90kV / Ras Jebel Nord',       debut:'14:33:10', dur:14, mw:5.2,  statut:'ok'       }
]

// ── CRC chart helpers ─────────────────────────────────────────────────────────
// SVG space: viewBox 720×240, x 40–680 (640 units), y 30–200 (170 units = 400 MW)
const CRC_SVG_X_START = 40
const CRC_SVG_X_RANGE = 640    // 40→680
const CRC_MW_MAX      = 400

function crcMwToY(mw)  { return 200 - (Math.min(mw, CRC_MW_MAX) / CRC_MW_MAX) * 170 }
function crcYToMW(y)   { return Math.round((200 - y) / 170 * CRC_MW_MAX) }

function slotsToChartPtsCRC(slots) {
    if (!slots || slots.length === 0) return []
    const total = slots.length
    return slots.map((s, idx) => {
        const x = Math.round(CRC_SVG_X_START + (idx / (total - 1)) * CRC_SVG_X_RANGE)
        return {
            time:   s.slot,
            x,
            yPlan:  Math.round(crcMwToY(s.mw_plan ?? 0)),
            yReal:  s.mw_real != null ? Math.round(crcMwToY(s.mw_real)) : null,
            isNow:  s.is_now ?? false,
            mwPlan: s.mw_plan ?? 0,
            mwReal: s.mw_real ?? null,
        }
    })
}

// Static fallback shown while API loads
const CRC_CHART_FALLBACK = [
    { time:'00:00', x:40,  yPlan:185, yReal:185, mwPlan:35,  mwReal:35  },
    { time:'08:00', x:268, yPlan:138, yReal:138, mwPlan:130, mwReal:130 },
    { time:'14:00', x:453, yPlan:82,  yReal:100, mwPlan:282, mwReal:240, isNow:true },
    { time:'20:00', x:610, yPlan:140, yReal:null, mwPlan:130, mwReal:null },
    { time:'23:59', x:680, yPlan:168, yReal:null, mwPlan:72,  mwReal:null },
]

// ── Regional SVG chart ────────────────────────────────────────────────────────
function RegionalChart({ chartPts = CRC_CHART_FALLBACK })
{
    const [tooltip, setTooltip] = useState(null)
    const svgRef                = useRef(null)

    const nowPoint = chartPts.find((p) => p.isNow) ?? null
    const nowX     = nowPoint?.x ?? 453
    const nowLabel = nowPoint ? nowPoint.time : '14:30'

    const handleMouseMove = useCallback(
        (e) => {
            const svg = svgRef.current
            if (!svg) return
            const rect   = svg.getBoundingClientRect()
            const scaleX = 720 / rect.width
            const mouseX = (e.clientX - rect.left) * scaleX
            let closest = null, minDist = Infinity
            chartPts.forEach((pt) => {
                const dist = Math.abs(pt.x - mouseX)
                if (dist < minDist) { minDist = dist; closest = pt }
            })
            if (closest && minDist < 25) setTooltip(closest)
            else setTooltip(null)
        },
        [chartPts]
    )

    const planPath = chartPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.yPlan}`).join(' ')
    const realPts  = chartPts.filter((p) => p.yReal !== null)
    const realPath = realPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.yReal}`).join(' ')

    const ttX = tooltip ? (tooltip.x > 500 ? tooltip.x - 195 : tooltip.x + 12) : 0
    const ttY = tooltip ? Math.min(tooltip.yPlan, tooltip.yReal ?? tooltip.yPlan) - 8 : 0

    return (
        <div
            className="w-full bg-surface-container-lowest relative select-none"
            style={{ height: '220px' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
        >
            <svg ref={svgRef} className="w-full h-full cursor-crosshair" preserveAspectRatio="none" viewBox="0 0 720 240">
                <defs>
                    <linearGradient id="defCRCGrad" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%"   stopColor="#93000a" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#93000a" stopOpacity="0.05" />
                    </linearGradient>
                    <pattern id="hatchCRC" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse" width="10">
                        <line stroke="#ffb4ab" strokeOpacity="0.4" strokeWidth="1" x1="0" x2="0" y1="0" y2="10" />
                    </pattern>
                </defs>

                {/* Grid */}
                <line stroke="#1b2b3f" strokeWidth="1"                      x1="35" x2="685" y1="200" y2="200" />
                <line stroke="#1b2b3f" strokeDasharray="2,2" strokeWidth="1" x1="35" x2="685" y1="157" y2="157" />
                <line stroke="#1b2b3f" strokeDasharray="2,2" strokeWidth="1" x1="35" x2="685" y1="115" y2="115" />
                <line stroke="#1b2b3f" strokeDasharray="2,2" strokeWidth="1" x1="35" x2="685" y1="72"  y2="72"  />
                <line stroke="#1b2b3f" strokeDasharray="2,2" strokeWidth="1" x1="35" x2="685" y1="30"  y2="30"  />

                {/* Y labels */}
                <text fill="#8f9097" fontSize="9" textAnchor="end" x="30" y="203">0</text>
                <text fill="#8f9097" fontSize="9" textAnchor="end" x="30" y="160">100</text>
                <text fill="#8f9097" fontSize="9" textAnchor="end" x="30" y="118">200</text>
                <text fill="#8f9097" fontSize="9" textAnchor="end" x="30" y="75">300</text>
                <text fill="#8f9097" fontSize="9" textAnchor="end" x="30" y="33">400</text>
                <text fill="#8f9097" fontSize="8" textAnchor="start" x="5" y="30">MW</text>

                {/* X grid lines */}
                <line stroke="#1b2b3f" strokeWidth="1"                        x1="40"   x2="40"   y1="28" y2="200" />
                <line stroke="#1b2b3f" strokeDasharray="2,2" strokeWidth="1"  x1="268"  x2="268"  y1="28" y2="200" />
                <line stroke="#1b2b3f" strokeDasharray="2,2" strokeWidth="1"  x1="382"  x2="382"  y1="28" y2="200" />
                <line stroke="#ffb95f" strokeDasharray="3,3" strokeWidth="1.5" x1={nowX} x2={nowX} y1="28" y2="200" />
                <line stroke="#1b2b3f" strokeDasharray="2,2" strokeWidth="1"  x1="553"  x2="553"  y1="28" y2="200" />
                <line stroke="#1b2b3f" strokeWidth="1"                        x1="680"  x2="680"  y1="28" y2="200" />

                {/* X labels */}
                <text fill="#8f9097" fontSize="9" textAnchor="middle" x="40"   y="215">00:00</text>
                <text fill="#8f9097" fontSize="9" textAnchor="middle" x="268"  y="215">08:00</text>
                <text fill="#8f9097" fontSize="9" textAnchor="middle" x="382"  y="215">12:00</text>
                <text fill="#ffb95f" fontSize="9" fontWeight="bold" textAnchor="middle" x={nowX} y="215">{nowLabel}</text>
                <text fill="#8f9097" fontSize="9" textAnchor="middle" x="553"  y="215">18:00</text>
                <text fill="#8f9097" fontSize="9" textAnchor="middle" x="680"  y="215">23:59</text>

                {/* Plan line */}
                <path d={planPath} fill="none" stroke="#acc7ff" strokeDasharray="4,4" strokeWidth="1.5" />
                {/* Actual line */}
                <path d={realPath} fill="none" stroke="#d3e4fe" strokeWidth="2" />

                {/* Deficit fill + hatch — between plan and real wherever réalisé < consigne */}
                {(() =>
                {
                    const realPts  = chartPts.filter((p) => p.yReal !== null)
                    const segments = []
                    let current    = null

                    realPts.forEach((pt) =>
                    {
                        // yReal > yPlan means MW_real < MW_plan (y-axis is inverted)
                        const isDeficit = pt.yReal > pt.yPlan + 1
                        if (isDeficit)
                        {
                            if (!current) current = []
                            current.push(pt)
                        }
                        else
                        {
                            if (current && current.length > 0) { segments.push(current); current = null }
                        }
                    })
                    if (current && current.length > 0) segments.push(current)

                    return segments.map((seg, idx) =>
                    {
                        const topEdge    = seg.map((p) => `${p.x},${p.yPlan}`).join(' ')
                        const bottomEdge = [...seg].reverse().map((p) => `${p.x},${p.yReal}`).join(' ')
                        const points     = `${topEdge} ${bottomEdge}`
                        return (
                            <g key={idx}>
                                <polygon fill="url(#defCRCGrad)" points={points} />
                                <polygon fill="url(#hatchCRC)"   points={points} />
                            </g>
                        )
                    })
                })()}

                {/* NOW dot */}
                {nowPoint && <circle cx={nowX} cy={nowPoint.yPlan} fill="#acc7ff" r="3" />}
                {nowPoint?.yReal != null && <circle cx={nowX} cy={nowPoint.yReal} fill="#ffb95f" r="4" />}

                {/* Hover */}
                {tooltip && <line stroke="#acc7ff" strokeDasharray="3,3" strokeOpacity="0.5" strokeWidth="1" x1={tooltip.x} x2={tooltip.x} y1="28" y2="200" />}
                {tooltip && <circle cx={tooltip.x} cy={tooltip.yPlan} fill="#acc7ff" r="3.5" stroke="#031427" strokeWidth="1" />}
                {tooltip && tooltip.yReal != null && <circle cx={tooltip.x} cy={tooltip.yReal} fill="#d3e4fe" r="3.5" stroke="#031427" strokeWidth="1" />}

                {/* Tooltip box */}
                {tooltip && (
                    <g transform={`translate(${ttX},${Math.max(32, ttY)})`}>
                        <rect fill="#0b1c30" height="58" rx="2" stroke="#acc7ff" strokeOpacity="0.4" strokeWidth="0.8" width="185" />
                        <text fill="#8f9097" fontSize="9" x="8" y="14">{tooltip.time} TU+1</text>
                        <text fill="#acc7ff" fontSize="10" fontWeight="600" x="8" y="28">
                            Consigne : {(tooltip.mwPlan ?? crcYToMW(tooltip.yPlan)).toFixed(0)} MW
                        </text>
                        {tooltip.yReal != null && (
                            <>
                                <text fill="#d3e4fe" fontSize="10" fontWeight="600" x="8" y="42">
                                    Réalisé  : {(tooltip.mwReal ?? crcYToMW(tooltip.yReal)).toFixed(0)} MW
                                </text>
                                <text
                                    fill={(tooltip.mwReal ?? crcYToMW(tooltip.yReal)) < (tooltip.mwPlan ?? crcYToMW(tooltip.yPlan)) ? '#ffb4ab' : '#4ade80'}
                                    fontSize="10" fontWeight="700" x="8" y="54"
                                >
                                    Écart : {((tooltip.mwReal ?? crcYToMW(tooltip.yReal)) - (tooltip.mwPlan ?? crcYToMW(tooltip.yPlan)) >= 0 ? '+' : '')}{((tooltip.mwReal ?? crcYToMW(tooltip.yReal)) - (tooltip.mwPlan ?? crcYToMW(tooltip.yPlan))).toFixed(0)} MW
                                </text>
                            </>
                        )}
                        {tooltip.yReal == null && (
                            <text fill="#8f9097" fontSize="9" fontStyle="italic" x="8" y="42">Données futures — plan J-1</text>
                        )}
                    </g>
                )}
            </svg>
        </div>
    )
}

// ── CRC Réalimentation modal ──────────────────────────────────────────────────
// Triggered by the CRC operator manually (radio order from DN, or CRC-initiated)
// Distributes a restore MW order down to the 4 BCCs
// BCC configs per CRC — used by CRCRealimModal
const REALIM_BCC_CONFIG = {
    'CRC Nord': [
        { id: 1, label: 'BCC 1 — Tunis Ville & Nord',    ratio: 0.37 }
        ,{ id: 2, label: 'BCC 2 — Tunis Sud & Ben Arous', ratio: 0.30 }
        ,{ id: 3, label: 'BCC 3 — Béja / Nord-Ouest',     ratio: 0.19 }
        ,{ id: 4, label: 'BCC 4 — Bizerte / Mateur',      ratio: 0.14 }
    ]
    ,'CRC Sud': [
        { id: 5, label: 'BCC 5 — Centre (Kairouan / S. Bouzid)', ratio: 0.40 }
        ,{ id: 6, label: 'BCC 6 — Sahel (Sousse / Monastir)',     ratio: 0.38 }
        ,{ id: 7, label: 'BCC 7 — Sud (Sfax / Gabès / Médenine)', ratio: 0.22 }
    ]
}

function emptyRealimDist(bccList)
{
    return Object.fromEntries(bccList.map((b) => [b.id, 0]))
}

function CRCRealimModal({ isOpen, onClose, onEmit, crcName = 'CRC Nord' })
{
    const bccList = REALIM_BCC_CONFIG[crcName] ?? REALIM_BCC_CONFIG['CRC Nord']

    const [type,       setType]       = useState('partielle')   // 'partielle' | 'totale'
    const [mwTotal,    setMwTotal]    = useState('')
    const [bccMW,      setBccMW]      = useState(() => emptyRealimDist(bccList))
    const [confirmTxt, setConfirmTxt] = useState('')
    const [emitted,    setEmitted]    = useState(false)

    // Reset state when CRC changes (modal reopened for a different CRC)
    useEffect(() =>
    {
        setBccMW(emptyRealimDist(bccList))
        setMwTotal('')
        setType('partielle')
        setConfirmTxt('')
        setEmitted(false)
    }, [crcName])   // eslint-disable-line react-hooks/exhaustive-deps

    const CURRENT_SHEDDING = crcName === 'CRC Sud' ? 130 : 282

    const effectiveMW = type === 'totale' ? CURRENT_SHEDDING : (Number(mwTotal) || 0)

    const autoDistribute = (mw) =>
    {
        if (!mw || mw <= 0) { setBccMW(emptyRealimDist(bccList)); return }
        const result = {}
        let remaining = mw
        bccList.forEach((b, i) =>
        {
            if (i === bccList.length - 1)
            {
                result[b.id] = Math.max(0, Math.round(remaining * 2) / 2)
            }
            else
            {
                const val = Math.round(mw * b.ratio * 2) / 2
                result[b.id] = val
                remaining -= val
            }
        })
        setBccMW(result)
    }

    const manualTotal = Object.values(bccMW).reduce((s, v) => s + Number(v), 0)
    const gap         = manualTotal - effectiveMW
    const balanced    = effectiveMW > 0 && Math.abs(gap) < 0.5
    const canEmit     = balanced && confirmTxt.toUpperCase() === 'CONFIRMER'

    const handleTypeChange = (t) =>
    {
        setType(t)
        setConfirmTxt('')
        setEmitted(false)
        if (t === 'totale') autoDistribute(CURRENT_SHEDDING)
        else { setMwTotal(''); setBccMW(emptyRealimDist(bccList)) }
    }

    const handleEmit = () =>
    {
        if (!canEmit) return
        setEmitted(true)
        if (onEmit) onEmit({ type, mwTotal: effectiveMW, bccMW })
        setTimeout(() => { onClose(); setEmitted(false); setConfirmTxt(''); setMwTotal(''); setType('partielle'); setBccMW(emptyRealimDist(bccList)) }, 1800)
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-space-md"
            onClick={onClose}
        >
            <div
                className="bg-surface-container-low border border-secondary/30 w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-space-lg py-space-md bg-secondary-container/30 border-b border-secondary/30 shrink-0">
                    <div className="flex items-center gap-space-md">
                        <div className="w-8 h-8 bg-secondary-container flex items-center justify-center shrink-0">
                            <Icon name="refresh" size={20} className="text-on-secondary-container" />
                        </div>
                        <div>
                            <h2 className="font-sans font-bold text-sm text-on-surface uppercase tracking-wider">
                                Ordre de Réalimentation — {crcName}
                            </h2>
                            <p className="font-mono text-[10px] text-on-surface-variant mt-0.5">
                                Distribution directe aux {bccList.length} BCCs — Rétablissement réseau
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-space-xs bg-secondary-container/40 hover:bg-secondary-container text-on-surface-variant transition-colors"
                        type="button"
                    >
                        <Icon name="close" size={17} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto flex flex-col gap-0">

                    {/* Section 1 — Situation réseau */}
                    <div className="px-space-lg py-space-md bg-surface-container-lowest border-b border-surface-container-high">
                        <p className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider mb-space-sm font-semibold">
                            Situation réseau actuelle — {crcName}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm font-mono text-xs">
                            {[
                                { label: 'Cible DN',           value: crcName === 'CRC Sud' ? '150,0 MW' : '300,0 MW',   cls: 'text-secondary'           }
                                ,{ label: 'En délestage',      value: `${CURRENT_SHEDDING},0 MW`,                        cls: 'text-tertiary font-bold'  }
                                ,{ label: 'BCCs en coupure',   value: crcName === 'CRC Sud' ? '21 feeders' : '42 feeders', cls: 'text-error'              }
                                ,{ label: 'Tendance réseau',   value: '↑ Stabilisé',                                     cls: 'text-[#4ade80] font-bold' }
                            ].map(({ label, value, cls }) => (
                                <div key={label} className="bg-surface-container border border-surface-container-high p-space-sm">
                                    <p className="text-[9px] text-on-surface-variant uppercase mb-0.5">{label}</p>
                                    <p className={`text-sm font-bold ${cls}`}>{value}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Section 2 — Type + MW */}
                    <div className="px-space-lg py-space-md border-b border-surface-container-high">
                        <p className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider mb-space-md font-semibold">
                            Type de réalimentation
                        </p>
                        <div className="grid grid-cols-2 gap-space-sm mb-space-md">
                            {[
                                { key: 'partielle', icon: 'trending_down', title: 'Partielle',           desc: 'Restaurer une partie du réseau, maintenir un délestage résiduel' }
                                ,{ key: 'totale',   icon: 'power',         title: 'Totale — Fin délest.', desc: `Rétablir l'intégralité des ${CURRENT_SHEDDING} MW délestés`       }
                            ].map(({ key, icon, title, desc }) => (
                                <button
                                    key={key}
                                    onClick={() => handleTypeChange(key)}
                                    className={`flex flex-col gap-space-xs p-space-md text-left border transition-all ${type === key ? 'bg-secondary-container/20 border-secondary text-on-surface' : 'bg-surface-container border-surface-container-high text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}`}
                                    type="button"
                                >
                                    <div className="flex items-center gap-space-sm">
                                        <Icon name={icon} size={15} className={type === key ? 'text-secondary' : 'text-on-surface-variant'} />
                                        <span className="font-mono text-xs font-bold uppercase">{title}</span>
                                    </div>
                                    <span className="font-mono text-[10px]">{desc}</span>
                                </button>
                            ))}
                        </div>

                        {/* MW input — partielle only */}
                        {type === 'partielle' && (
                            <div className="flex items-center gap-space-md">
                                <div className="relative flex-1">
                                    <input
                                        type="number"
                                        min={1}
                                        max={CURRENT_SHEDDING}
                                        step={1}
                                        placeholder="Ex: 50"
                                        value={mwTotal}
                                        onChange={(e) =>
                                        {
                                            setMwTotal(e.target.value)
                                            autoDistribute(Number(e.target.value))
                                            setConfirmTxt('')
                                            setEmitted(false)
                                        }}
                                        className="w-full bg-surface-container-lowest border-2 border-secondary/40 focus:border-secondary text-on-surface font-mono text-2xl font-bold px-space-md py-space-md focus:outline-none transition-all text-center"
                                    />
                                    <span className="absolute right-space-md top-1/2 -translate-y-1/2 font-mono text-sm text-on-surface-variant font-semibold">
                                        MW
                                    </span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    {[20, 40, 60, 80].map((v) => (
                                        <button
                                            key={v}
                                            onClick={() => { setMwTotal(v); autoDistribute(v); setConfirmTxt(''); setEmitted(false) }}
                                            className="px-space-md py-space-xs bg-surface-container hover:bg-secondary-container/20 border border-surface-container-high hover:border-secondary/40 text-on-surface-variant hover:text-secondary font-mono text-xs transition-all"
                                            type="button"
                                        >
                                            -{v} MW
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Totale summary */}
                        {type === 'totale' && (
                            <div className="p-space-md bg-[#4ade80]/10 border border-[#4ade80]/30 font-mono text-sm text-[#4ade80] font-bold flex items-center gap-space-md">
                                <Icon name="power" size={20} />
                                <span>FIN DE DÉLESTAGE — Rétablir {CURRENT_SHEDDING} MW sur l'ensemble de {crcName}</span>
                            </div>
                        )}

                        {/* BCC distribution */}
                        {effectiveMW > 0 && (
                            <div className="mt-space-md flex flex-col gap-space-sm">
                                <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant uppercase tracking-wider">
                                    <span>Ventilation par BCC</span>
                                    <button
                                        onClick={() => autoDistribute(effectiveMW)}
                                        className="flex items-center gap-space-xs px-space-sm py-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container font-mono text-[10px] font-bold transition-all"
                                        type="button"
                                    >
                                        <Icon name="auto_fix_high" size={12} />
                                        <span>Suggestion IA (équité)</span>
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-space-sm">
                                    {bccList.map((b) =>
                                    {
                                        const val = bccMW[b.id] ?? 0
                                        const pct = effectiveMW > 0 ? Math.min(100, (val / effectiveMW) * 100) : 0
                                        return (
                                            <div key={b.id} className="bg-surface-container border border-surface-container-high p-space-sm flex flex-col gap-space-xs">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-sans font-bold text-xs text-on-surface">{b.label}</span>
                                                    <span className="font-mono text-[10px] text-secondary">{val} MW</span>
                                                </div>
                                                <div className="flex items-center gap-space-sm">
                                                    <span className="font-mono text-xs text-on-surface-variant">-</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={effectiveMW}
                                                        step={0.5}
                                                        value={val}
                                                        onChange={(e) =>
                                                        {
                                                            setBccMW((prev) => ({ ...prev, [b.id]: Number(e.target.value) }))
                                                            setConfirmTxt('')
                                                            setEmitted(false)
                                                        }}
                                                        className="w-full bg-surface-container-lowest border border-secondary/40 focus:border-secondary text-secondary font-mono text-sm font-bold px-space-sm py-space-xs focus:outline-none"
                                                    />
                                                    <span className="font-mono text-xs text-on-surface-variant">MW</span>
                                                </div>
                                                <div className="w-full bg-surface-container-lowest h-1 overflow-hidden">
                                                    <div className="bg-secondary h-full transition-all" style={{ width: `${pct}%` }} />
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                {/* Balance */}
                                <div className={`p-space-sm flex items-center justify-between font-mono text-xs border ${balanced ? 'bg-[#4ade80]/10 border-[#4ade80]/30 text-[#4ade80]' : 'bg-error-container/20 border-error/40 text-error'}`}>
                                    <div className="flex items-center gap-space-md">
                                        <span className="text-on-surface-variant">Total :</span>
                                        <strong className={`text-sm ${balanced ? 'text-[#4ade80]' : 'text-error'}`}>{manualTotal.toFixed(1)} MW</strong>
                                        <span className="text-on-surface-variant">/ -{effectiveMW} MW requis</span>
                                    </div>
                                    <span className="font-bold text-[10px] uppercase px-space-sm py-0.5">
                                        {balanced ? 'CONFORME' : `ÉCART ${gap > 0 ? '+' : ''}${gap.toFixed(1)} MW`}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Section 3 — Confirmation */}
                    <div className="px-space-lg py-space-md">
                        <p className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider mb-space-sm font-semibold">
                            Confirmation de l'ordre
                        </p>
                        <p className="font-sans text-xs text-on-surface-variant mb-space-md">
                            Tapez <strong className="text-secondary font-mono">CONFIRMER</strong> pour autoriser l'émission.
                            Action horodatée dans l'audit CRC.
                        </p>
                        <input
                            type="text"
                            placeholder="Tapez CONFIRMER"
                            value={confirmTxt}
                            onChange={(e) => setConfirmTxt(e.target.value)}
                            className="w-full bg-surface-container-lowest border border-secondary/30 focus:border-secondary text-on-surface font-mono text-sm px-space-md py-space-sm focus:outline-none transition-all tracking-widest"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-space-lg py-space-md bg-surface-container border-t border-surface-container-high flex items-center justify-between shrink-0">
                    <div className="font-mono text-[10px] text-on-surface-variant flex items-center gap-space-xs">
                        <Icon name="schedule" size={13} className="text-secondary" />
                        <span>Ordre horodaté et enregistré dans l'audit CRC à l'émission</span>
                    </div>
                    <div className="flex items-center gap-space-sm">
                        <button
                            onClick={onClose}
                            className="px-space-md py-space-xs bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs border border-surface-container-high transition-colors"
                            type="button"
                        >
                            Annuler
                        </button>
                        <button
                            onClick={handleEmit}
                            disabled={!canEmit || emitted}
                            className="px-space-md py-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container font-mono text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-space-xs shadow-sm"
                            type="button"
                        >
                            {emitted
                                ? <><Icon name="check_circle" size={14} className="text-[#4ade80]" /><span>Ordre émis !</span></>
                                : <><Icon name="refresh" size={14} /><span>Émettre l'ordre de réalimentation</span></>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
const AI_J1_SUGGESTION = `Analyse historique BCCs CRC Nord (30 derniers jours) :

BCC 1 (Grand Tunis Nord) — Indice équité : 88/100
  → Quote-part proposée : 37% de la consigne DN par créneau
  → Motif : Faible sollicitation récente, capacité disponible.

BCC 2 (Tunis Sud) — Indice équité : 91/100
  → Quote-part proposée : 30%
  → Motif : Charge bien distribuée, aucun départ sur-sollicité.

BCC 3 (Nord-Ouest) — Indice équité : 68/100
  → Quote-part proposée : 19%
  → Attention : BCC 3 sur-sollicité sur 30j. Réduire si possible.

BCC 4 (Bizerte) — Indice équité : 94/100
  → Quote-part proposée : 14%
  → Motif : Très peu sollicité, marge disponible.`

// ── Default per-CRC BCC ratios ────────────────────────────────────────────────
// Used when the DB hasn't provided consigne data yet (fallback proportional split).
// Keys are BCC IDs, values are fractions (must sum to ~1.0 per CRC).
const DEFAULT_BCC_RATIOS = {
    1: 0.367,   // CRC Nord
    2: 0.300,
    3: 0.193,
    4: 0.140,
    5: 0.350,   // CRC Sud
    6: 0.400,
    7: 0.250,
}

// ── Helper: build an empty distribution keyed by BCC id ──────────────────────
function emptyDistribution(bccList)
{
    return Object.fromEntries(bccList.map((b) => [b.id, 0]))
}

// ── AI suggestion for one slot, using dynamic BCC list ───────────────────────
function applyAiToSlot(mwCrc, bccList)
{
    const total = bccList.reduce((s, b) => s + (DEFAULT_BCC_RATIOS[b.id] ?? (1 / bccList.length)), 0)
    const result = {}
    let remaining = mwCrc
    bccList.forEach((b, i) =>
    {
        const ratio = (DEFAULT_BCC_RATIOS[b.id] ?? (1 / bccList.length)) / total
        if (i === bccList.length - 1)
        {
            result[b.id] = Math.max(0, Math.round(remaining * 2) / 2)
        }
        else
        {
            const val = Math.round(mwCrc * ratio * 2) / 2
            result[b.id] = val
            remaining -= val
        }
    })
    return result
}

// ── ProgrammeJ1Modal ──────────────────────────────────────────────────────────
function ProgrammeJ1Modal({ isOpen, onClose, crcName = 'CRC Nord', bccList = [], reloadKey = 0, targetDate = null })
{
    const [tab,          setTab]          = useState('slots')
    const [slots,        setSlots]        = useState([])
    const [dist,         setDist]         = useState({})
    const [loadState,    setLoadState]    = useState('idle')
    const [programmeId,  setProgrammeId]  = useState(null)
    const [progDate,     setProgDate]     = useState(null)
    const [progStatus,   setProgStatus]   = useState('no_programme')
    const [showAI,       setShowAI]       = useState(false)
    const [filterRange,  setFilterRange]  = useState('all')
    const [activeSlot,   setActiveSlot]   = useState(null)
    const [sending,      setSending]      = useState(false)
    const [sent,         setSent]         = useState(false)
    const [fileRef]                       = useState(() => ({ current: null }))
    const [fileName,     setFileName]     = useState(null)
    const [fileError,    setFileError]    = useState(null)

    // Derive a stable BCC config from the prop (label, color)
    const bccConfig = bccList.map((b, i) => ({
        id:    b.id,
        label: b.name ?? `BCC ${b.id}`,
        full:  `${b.name ?? `BCC ${b.id}`} — ${b.zone ?? ''}`,
        color: i === 2 && bccList.length > 3 ? 'text-tertiary' : 'text-secondary',
    }))

    // ── Load slots on open OR when DN publishes a new programme (reloadKey bumps) ──
    useEffect(
        () =>
        {
            if (!isOpen && reloadKey === 0) return
            setLoadState('loading')
            setSent(false)
            const dateParam = targetDate ? `&target_date=${targetDate}` : ''
            api.get(`/api/v1/programmes/crc-slots?crc_name=${encodeURIComponent(crcName)}${dateParam}`)
                .then(({ data }) =>
                {
                    setSlots(data.slots)
                    setProgrammeId(data.programme_id)
                    setProgDate(data.programme_date)
                    setProgStatus(data.status)
                    const d = {}
                    data.slots.forEach((s) => { d[s.time_slot] = applyAiToSlot(s.mw_crc, bccConfig) })
                    setDist(d)
                    setLoadState('ready')
                })
                .catch(() =>
                {
                    const profile = [40,38,36,35,34,33,35,38,42,48,55,65,75,85,95,105,120,140,160,180,200,215,230,240,255,270,285,295,300,295,285,270,258,245,230,215,200,185,175,165,158,145,130,115,100,88,75,62]
                    const fallbackSlots = profile.map((mw, i) =>
                    {
                        const h = Math.floor((i * 30) / 60), m = (i * 30) % 60
                        return { time_slot: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`, mw_crc: mw, source: 'mock_profile' }
                    })
                    setSlots(fallbackSlots)
                    setProgDate(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
                    setProgStatus('no_programme')
                    const d = {}
                    fallbackSlots.forEach((s) => { d[s.time_slot] = applyAiToSlot(s.mw_crc, bccConfig) })
                    setDist(d)
                    setLoadState('ready')
                })
        }
        ,[isOpen, crcName, reloadKey, targetDate]   // eslint-disable-line react-hooks/exhaustive-deps
    )

    // ── Derived state ─────────────────────────────────────────────────────────
    const totalSlots = slots.length

    const balances = useMemo(
        () =>
        {
            const map = {}
            slots.forEach((s) =>
            {
                const d = dist[s.time_slot] ?? emptyDistribution(bccConfig)
                const total = Object.values(d).reduce((sum, v) => sum + Number(v), 0)
                const gap   = Math.round((total - s.mw_crc) * 10) / 10
                map[s.time_slot] = { total, gap, ok: Math.abs(gap) < 0.6 }
            })
            return map
        }
        ,[slots, dist, bccConfig]
    )

    const errorSlots   = slots.filter((s) => !balances[s.time_slot]?.ok)
    const conformeSlots = slots.filter((s) => balances[s.time_slot]?.ok)
    const allOk        = errorSlots.length === 0 && totalSlots > 0
    const totalDnMW    = slots.reduce((s, sl) => s + sl.mw_crc, 0)
    const totalDistMW  = slots.reduce((s, sl) => s + (balances[sl.time_slot]?.total ?? 0), 0)

    const tomorrow = progDate
        ? new Date(progDate).toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
        : '—'

    // ── Filter visible slots ──────────────────────────────────────────────────
    const visibleSlots = useMemo(
        () =>
        {
            if (filterRange === 'peak')   return slots.filter((s) => { const h = parseInt(s.time_slot); return h >= 8 && h < 20 })
            if (filterRange === 'night')  return slots.filter((s) => { const h = parseInt(s.time_slot); return h < 6 || h >= 22 })
            if (filterRange === 'errors') return slots.filter((s) => !balances[s.time_slot]?.ok)
            return slots
        }
        ,[slots, filterRange, balances]
    )

    // ── Handlers ──────────────────────────────────────────────────────────────
    const updateBccMW = (timeSlot, bccId, val) =>
    {
        setDist((prev) => ({
            ...prev
            ,[timeSlot]: { ...(prev[timeSlot] ?? emptyDistribution(bccConfig)), [bccId]: Number(val) }
        }))
        setSent(false)
    }

    const applyAiAll = () =>
    {
        const d = {}
        slots.forEach((s) => { d[s.time_slot] = applyAiToSlot(s.mw_crc, bccConfig) })
        setDist(d)
        setSent(false)
    }

    const applyAiSlot = (timeSlot, mwCrc) =>
    {
        setDist((prev) => ({ ...prev, [timeSlot]: applyAiToSlot(mwCrc, bccConfig) }))
        setSent(false)
    }

    const handleSend = async () =>
    {
        if (!allOk || sending) return
        setSending(true)
        try
        {
            const payload = []
            slots.forEach((s) =>
            {
                const d = dist[s.time_slot] ?? emptyDistribution(bccConfig)
                bccConfig.forEach((b) =>
                {
                    payload.push({
                        time_slot: s.time_slot
                        ,bcc_id:  b.id
                        ,mw_bcc:  Number(d[b.id] ?? 0)
                        ,mw_crc:  s.mw_crc
                    })
                })
            })
            await api.post('/api/v1/programmes/crc-submit', {
                crc_name:        crcName
                ,programme_date: progDate
                ,slots:          payload
            })
            setSent(true)
            setTimeout(() => { onClose(); setSent(false) }, 1800)
        }
        catch (err)
        {
            console.error('[J+1] submit failed:', err?.response?.data ?? err.message)
        }
        finally { setSending(false) }
    }

    const handleFile = (e) =>
    {
        const file = e.target.files?.[0]
        if (!file) return
        if (!file.name.match(/\.(csv|xlsx|xls)$/i)) { setFileError('Format non supporté. Utilisez CSV ou Excel.'); return }
        setFileName(file.name)
        setFileError(null)
    }

    if (!isOpen) return null

    // If BCC list hasn't loaded yet, show a brief loading state
    if (bccConfig.length === 0) return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
            <div className="bg-surface-container-low border border-surface-container-high p-space-xl flex flex-col items-center gap-space-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <Icon name="hourglass_top" size={32} className="text-secondary animate-spin" />
                <span className="font-mono text-xs text-on-surface-variant">Chargement de la liste des BCCs...</span>
            </div>
        </div>
    )

    return (
        <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2"
            onClick={onClose}
        >
            <div
                className="bg-surface-container-low border border-surface-container-high w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
                style={{ minWidth: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Header ────────────────────────────────────────────────── */}
                <div className="px-4 py-3 bg-surface-container-lowest border-b border-surface-container-high flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-surface-container border border-surface-container-high flex items-center justify-center text-secondary">
                            <Icon name="calendar_month" size={20} />
                        </div>
                        <div>
                            <h3 className="font-sans font-bold text-sm text-on-surface uppercase tracking-wide">
                                Programme J+1 — {crcName}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="font-mono text-[10px] text-on-surface-variant">
                                    {tomorrow} · Granularité 30 min · {bccConfig.length} BCCs · 48 créneaux
                                </span>
                                {progStatus === 'no_programme' && (
                                    <span className="px-1.5 py-0.5 bg-tertiary-container/30 text-tertiary font-mono text-[9px] font-bold border border-tertiary/30">
                                        PROFIL INDICATIF — EN ATTENTE PROGRAMME DN
                                    </span>
                                )}
                                {progStatus === 'validated' && (
                                    <span className="px-1.5 py-0.5 bg-[#4ade80]/10 text-[#4ade80] font-mono text-[9px] font-bold border border-[#4ade80]/30">
                                        PROGRAMME DN VALIDÉ
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors" type="button">
                        <Icon name="close" size={18} />
                    </button>
                </div>

                {/* ── Tabs + summary strip ──────────────────────────────────── */}
                <div className="flex items-center bg-surface-container px-3 border-b border-surface-container-high shrink-0 gap-0">
                    {[
                        { key: 'slots',   label: 'Créneaux 30 min'         }
                       ,{ key: 'summary', label: 'Synthèse par BCC'        }
                       ,{ key: 'upload',  label: 'Importer CSV/Excel'      }
                    ].map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`px-3 py-2 font-mono text-xs border-b-2 transition-colors ${tab === key ? 'text-secondary border-secondary font-bold' : 'text-on-surface-variant border-transparent hover:text-on-surface'}`}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                    <div className="ml-auto flex items-center gap-3 pb-1 font-mono text-[10px] text-on-surface-variant">
                        <span className={errorSlots.length > 0 ? 'text-error font-bold' : 'text-[#4ade80] font-bold'}>
                            {errorSlots.length === 0 ? `${conformeSlots.length}/48 CONFORMES` : `${errorSlots.length} CRÉNEAUX EN ÉCART`}
                        </span>
                        <span className="text-on-surface-variant">|</span>
                        <span>DN total :&nbsp;<strong className="text-secondary">{totalDnMW.toFixed(0)} MW</strong></span>
                        <span>Réparti :&nbsp;<strong className={allOk ? 'text-[#4ade80]' : 'text-error'}>{totalDistMW.toFixed(0)} MW</strong></span>
                    </div>
                </div>

                {/* ── Body ─────────────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto min-h-0">

                    {/* ── TAB: CRÉNEAUX ────────────────────────────────────── */}
                    {tab === 'slots' && (
                        <div className="flex flex-col">

                            {/* Controls bar */}
                            <div className="sticky top-0 z-10 bg-surface-container-lowest border-b border-surface-container-high px-4 py-2 flex flex-wrap items-center justify-between gap-2">
                                {/* AI suggestion */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={applyAiAll}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-secondary-container/30 hover:bg-secondary-container/60 text-secondary border border-secondary/30 font-mono text-[10px] font-bold transition-all"
                                        type="button"
                                    >
                                        <Icon name="auto_fix_high" size={13} />
                                        <span>Appliquer suggestion IA (tous les créneaux)</span>
                                    </button>
                                    <button
                                        onClick={() => setShowAI((v) => !v)}
                                        className="font-mono text-[10px] text-secondary hover:underline"
                                        type="button"
                                    >
                                        {showAI ? 'Masquer' : 'Voir analyse'}
                                    </button>
                                </div>

                                {/* Filters */}
                                <div className="flex items-center gap-1 font-mono text-[10px]">
                                    {[
                                        { key:'all',    label:'Tous (48)'       }
                                       ,{ key:'peak',   label:'Pic (08:00-20:00)' }
                                       ,{ key:'night',  label:'Nuit'            }
                                       ,{ key:'errors', label:`Écarts (${errorSlots.length})` }
                                    ].map(({ key, label }) => (
                                        <button
                                            key={key}
                                            onClick={() => setFilterRange(key)}
                                            className={`px-2 py-0.5 border transition-colors ${filterRange === key ? 'bg-secondary-container text-on-secondary-container border-secondary' : 'bg-surface-container text-on-surface-variant border-surface-container-high hover:text-on-surface'}`}
                                            type="button"
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* AI analysis panel */}
                            {showAI && (
                                <div className="px-4 py-3 bg-surface-container-lowest border-b border-secondary/20">
                                    <pre className="font-mono text-[10px] text-on-surface-variant whitespace-pre-wrap leading-relaxed">
                                        {AI_J1_SUGGESTION}
                                    </pre>
                                </div>
                            )}

                            {/* Slot table */}
                            {loadState === 'loading' && (
                                <div className="flex items-center justify-center py-12 gap-2 font-mono text-xs text-on-surface-variant">
                                    <Icon name="hourglass_empty" size={18} className="text-secondary animate-spin" />
                                    <span>Chargement du programme DN...</span>
                                </div>
                            )}

                            {loadState === 'ready' && (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse" style={{ minWidth: 680 }}>
                                        <thead className="sticky top-[41px] z-10">
                                            <tr className="bg-[#000f21] font-mono text-[9px] text-on-surface-variant uppercase tracking-wider border-b border-surface-container-high">
                                                <th className="py-2 px-3 w-16">Créneau</th>
                                                <th className="py-2 px-3 text-right w-24">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <span className="w-2 h-0.5 bg-secondary inline-block" />
                                                        <span>Cible DN (MW)</span>
                                                    </div>
                                                </th>
                                                {bccConfig.map((b) => (
                                                    <th key={b.id} className="py-2 px-2 text-center">
                                                        <span className={b.color}>{b.label}</span>
                                                        <span className="text-on-surface-variant"> (MW)</span>
                                                    </th>
                                                ))}
                                                <th className="py-2 px-3 text-center w-28">Balance</th>
                                                <th className="py-2 px-2 text-center w-16">IA</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-surface-container/50 font-mono text-xs">
                                            {visibleSlots.map((s) =>
                                            {
                                                const d      = dist[s.time_slot] ?? emptyDistribution(bccConfig)
                                                const bal    = balances[s.time_slot] ?? { total:0, gap:0, ok:false }
                                                const isActive = activeSlot === s.time_slot
                                                const hour   = parseInt(s.time_slot)
                                                const isPeak = hour >= 8 && hour < 20
                                                return (
                                                    <tr
                                                        key={s.time_slot}
                                                        onClick={() => setActiveSlot(isActive ? null : s.time_slot)}
                                                        className={`transition-colors cursor-pointer ${
                                                            isActive            ? 'bg-secondary-container/20 ring-1 ring-inset ring-secondary/40'
                                                            : !bal.ok           ? 'bg-error-container/10 hover:bg-error-container/20'
                                                            : isPeak            ? 'bg-surface-container-low hover:bg-surface-container'
                                                            : 'bg-surface-container-lowest/50 hover:bg-surface-container-lowest'
                                                        }`}
                                                    >
                                                        {/* Time slot */}
                                                        <td className="py-1.5 px-3">
                                                            <span className={`font-bold ${isPeak ? 'text-secondary' : 'text-on-surface-variant'}`}>
                                                                {s.time_slot}
                                                            </span>
                                                        </td>

                                                        {/* DN target */}
                                                        <td className="py-1.5 px-3 text-right">
                                                            <span className="font-bold text-on-surface">{s.mw_crc.toFixed(0)}</span>
                                                            <span className="text-on-surface-variant text-[9px] ml-0.5">MW</span>
                                                        </td>

                                                        {/* BCC inputs */}
                                                        {bccConfig.map((b) => (
                                                            <td key={b.id} className="py-1 px-2">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={s.mw_crc}
                                                                    step={0.5}
                                                                    value={d[b.id] ?? 0}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    onChange={(e) => updateBccMW(s.time_slot, b.id, e.target.value)}
                                                                    className={`w-full bg-surface-container-lowest border text-center font-mono text-xs px-1 py-0.5 focus:outline-none transition-all ${
                                                                        !bal.ok
                                                                            ? 'border-error/40 focus:border-error text-error'
                                                                            : 'border-surface-container-high focus:border-secondary text-on-surface'
                                                                    }`}
                                                                />
                                                            </td>
                                                        ))}

                                                        {/* Balance indicator — shows DN order; green when BCC sum matches */}
                                                        <td className="py-1.5 px-3 text-center">
                                                            {bal.ok
                                                                ? <span className="inline-flex items-center gap-1 text-[#4ade80] font-bold text-[10px]">
                                                                    <Icon name="check_circle" size={12} />
                                                                    <span>{s.mw_crc.toFixed(0)} MW</span>
                                                                  </span>
                                                                : <span className="inline-flex items-center gap-1 text-error font-bold text-[10px]">
                                                                    <Icon name="error" size={12} />
                                                                    <span>{s.mw_crc.toFixed(0)} MW</span>
                                                                    <span className="text-[9px] font-normal opacity-80">({bal.gap > 0 ? '+' : ''}{bal.gap.toFixed(1)})</span>
                                                                  </span>
                                                            }
                                                        </td>

                                                        {/* Per-slot AI button */}
                                                        <td className="py-1 px-2 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); applyAiSlot(s.time_slot, s.mw_crc) }}
                                                                className="p-0.5 text-secondary hover:bg-secondary-container transition-colors"
                                                                title="Répartition IA pour ce créneau"
                                                            >
                                                                <Icon name="auto_fix_high" size={13} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── TAB: SYNTHÈSE ─────────────────────────────────────── */}
                    {tab === 'summary' && (
                        <div className="p-4 flex flex-col gap-4">

                            {/* Global balance cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {bccConfig.map((b) =>
                                {
                                    const bccTotal = slots.reduce((sum, s) => sum + Number((dist[s.time_slot] ?? emptyDistribution(bccConfig))[b.id] ?? 0), 0)
                                    const dnTotal  = slots.reduce((sum, s) => sum + s.mw_crc, 0)
                                    const pct      = dnTotal > 0 ? ((bccTotal / dnTotal) * 100).toFixed(1) : '0'
                                    return (
                                        <div key={b.id} className="bg-surface-container border border-surface-container-high p-3 flex flex-col gap-1">
                                            <span className={`font-mono text-[10px] font-bold uppercase ${b.color}`}>{b.full}</span>
                                            <div className="flex items-baseline gap-1 mt-1">
                                                <span className="font-mono text-2xl font-bold text-on-surface">{bccTotal.toFixed(0)}</span>
                                                <span className="font-mono text-xs text-on-surface-variant">MW·total</span>
                                            </div>
                                            <div className="w-full bg-surface-container-lowest h-1.5 overflow-hidden mt-1">
                                                <div className="bg-secondary h-full transition-all" style={{ width: `${Math.min(Number(pct), 100)}%` }} />
                                            </div>
                                            <span className="font-mono text-[10px] text-on-surface-variant">{pct}% du total DN</span>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Per-slot summary bar chart */}
                            <div className="bg-surface-container-lowest border border-surface-container-high p-3">
                                <p className="font-mono text-[10px] text-on-surface-variant uppercase mb-2">Profil 24h — Cible DN vs Distribution CRC</p>
                                <div className="flex items-end gap-px h-16 overflow-hidden">
                                    {slots.map((s) =>
                                    {
                                        const maxMW  = Math.max(...slots.map((sl) => sl.mw_crc), 1)
                                        const heightPct = (s.mw_crc / maxMW) * 100
                                        const bal = balances[s.time_slot]
                                        return (
                                            <div
                                                key={s.time_slot}
                                                className="flex-1 flex flex-col justify-end"
                                                title={`${s.time_slot}: DN ${s.mw_crc} MW — ${bal?.ok ? 'CONFORME' : `ÉCART ${bal?.gap > 0 ? '+' : ''}${bal?.gap?.toFixed(1)}`}`}
                                            >
                                                <div
                                                    className={`w-full transition-all ${bal?.ok ? 'bg-secondary' : 'bg-error'}`}
                                                    style={{ height: `${heightPct}%`, minHeight: 2 }}
                                                />
                                            </div>
                                        )
                                    })}
                                </div>
                                <div className="flex justify-between font-mono text-[9px] text-on-surface-variant mt-1">
                                    <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:30</span>
                                </div>
                            </div>

                            {/* Error slots */}
                            {errorSlots.length > 0 && (
                                <div className="bg-error-container/20 border border-error/30 p-3 flex flex-col gap-2">
                                    <div className="flex items-center gap-2 font-mono text-[10px] text-error font-bold uppercase">
                                        <Icon name="error" size={14} />
                                        <span>{errorSlots.length} créneau(x) en déséquilibre — à corriger avant envoi</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {errorSlots.map((s) => {
                                            const bal = balances[s.time_slot]
                                            return (
                                                <button
                                                    key={s.time_slot}
                                                    type="button"
                                                    onClick={() => { setTab('slots'); setActiveSlot(s.time_slot) }}
                                                    className="px-2 py-0.5 bg-error-container text-on-error-container font-mono text-[10px] hover:bg-error hover:text-background transition-colors"
                                                >
                                                    {s.time_slot} ({bal?.gap > 0 ? '+' : ''}{bal?.gap?.toFixed(1)} MW)
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── TAB: UPLOAD ───────────────────────────────────────── */}
                    {tab === 'upload' && (
                        <div className="p-4 flex flex-col gap-4">
                            <div
                                className="border-2 border-dashed border-surface-container-high hover:border-secondary/50 p-8 flex flex-col items-center gap-3 text-center cursor-pointer hover:bg-surface-container/20 transition-all"
                                onClick={() => fileRef.current?.click()}
                            >
                                <Icon name="cloud_upload" size={40} className="text-on-surface-variant" />
                                <div>
                                    <p className="font-sans font-semibold text-sm text-on-surface">Glissez-déposez ou cliquez pour parcourir</p>
                                    <p className="font-mono text-[10px] text-on-surface-variant mt-1">CSV ou Excel (.xlsx, .xls)</p>
                                </div>
                                {fileName && (
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container border border-secondary/40">
                                        <Icon name="description" size={14} className="text-secondary" />
                                        <span className="font-mono text-xs text-secondary font-semibold">{fileName}</span>
                                        <Icon name="check_circle" size={13} className="text-[#4ade80]" />
                                    </div>
                                )}
                                <input ref={(el) => { fileRef.current = el }} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFile} />
                            </div>
                            {fileError && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-error-container/30 border border-error/50 font-mono text-xs text-error">
                                    <Icon name="error" size={13} />
                                    <span>{fileError}</span>
                                </div>
                            )}
                            <div className="bg-surface-container-lowest border border-surface-container-high p-3 font-mono text-xs text-on-surface-variant">
                                <p className="text-on-surface font-semibold mb-1">Format CSV attendu :</p>
                                <p className="text-secondary">creneau,{bccConfig.map((b) => b.label.toLowerCase().replace(' ', '')).join(',')}</p>
                                <p>{`08:00,${bccConfig.map(() => '—').join(',')}`}</p>
                                <p className="text-on-surface-variant mt-1">... (48 lignes)</p>
                            </div>
                        </div>
                    )}

                </div>

                {/* ── Footer ───────────────────────────────────────────────── */}
                <div className="px-4 py-3 bg-surface-container border-t border-surface-container-high flex items-center justify-between shrink-0 flex-wrap gap-2">
                    <div className="font-mono text-[10px] text-on-surface-variant flex items-center gap-1">
                        <Icon name="info" size={12} className="text-secondary" />
                        <span>
                            {allOk
                                ? `${conformeSlots.length}/48 créneaux conformes — prêt à transmettre aux ${bccConfig.length} BCCs`
                                : `${errorSlots.length} créneau(x) à corriger avant validation`
                            }
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setTab('summary')} className="px-3 py-1 bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs border border-surface-container-high transition-colors" type="button">
                            Synthèse
                        </button>
                        <button onClick={onClose} className="px-3 py-1 bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs border border-surface-container-high transition-colors" type="button">
                            Annuler
                        </button>
                        <button
                            onClick={handleSend}
                            disabled={(tab === 'upload' && !fileName) || (tab !== 'upload' && !allOk) || sending}
                            className="flex items-center gap-1.5 px-4 py-1 bg-secondary-container text-on-secondary-container font-mono text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            type="button"
                        >
                            {sent
                                ? <><Icon name="check_circle" size={13} className="text-[#4ade80]" /><span>Programme transmis !</span></>
                                : sending
                                    ? <><Icon name="hourglass_empty" size={13} className="animate-spin" /><span>Envoi...</span></>
                                    : <><Icon name="send" size={13} /><span>Valider et envoyer aux BCCs</span></>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── AI slide panel ────────────────────────────────────────────────────────────
function AiPanel({ isOpen, onClose, crcName = 'CRC Nord' })
{
    const [input, setInput] = useState('')
    const [msgs,  setMsgs]  = useState
    (
        [
            {
                role: 'system'
                ,text: `Analyse CRC Nord — Déficit -18,0 MW (14h32)\n\nBCC 3 sous-réalisé suite avarie D22 Béja.\nCompensations disponibles BCC 2 (+4 MW) et BCC 4 (+8 MW).\nGain estimé : +12 MW en 8 minutes.`
            }
        ]
    )

    const send = () =>
    {
        if (!input.trim()) return
        setMsgs
        (
            (m) =>
            [
                ...m
                ,{ role: 'user',   text: input }
                ,{ role: 'system', text: 'Analyse en cours sur réseau Nord… Transit HTB admissible sur Radès–Mornaguia. Aucun goulot détecté.' }
            ]
        )
        setInput('')
    }

    return (
        <div
            className={`fixed top-14 bottom-8 right-0 w-96 max-w-[90vw] bg-surface-container-low shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out border-l border-surface-container-high ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
            <div className="p-space-md bg-surface-container flex items-center justify-between border-b border-surface-container-high shrink-0">
                <div className="flex items-center gap-space-sm">
                    <div className="w-7 h-7 bg-secondary-container/30 border border-secondary/40 flex items-center justify-center text-secondary">
                        <Icon name="smart_toy" size={18} />
                    </div>
                    <div>
                        <span className="font-sans font-bold text-xs text-on-surface uppercase">Analyse IA — {crcName}</span>
                        <p className="font-mono text-[9px] text-secondary">MODÈLE ÉNERGÉTIQUE OP-LLM 2.5</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-space-xs hover:bg-surface-container-high text-on-surface-variant transition-colors"
                    type="button"
                >
                    <Icon name="close" size={18} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-space-md flex flex-col gap-space-sm">
                {msgs.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] p-space-sm font-mono text-[10px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-secondary-container/20 border border-secondary/30 text-on-surface' : 'bg-surface-container-lowest border border-surface-container-high text-on-surface-variant'}`}>
                            {m.role === 'system' && (
                                <span className="text-secondary font-bold text-[9px] block mb-0.5 uppercase">Rapport téléconduite</span>
                            )}
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
                        placeholder="Poser une question opérationnelle..."
                        className="flex-1 bg-surface-container-lowest border border-surface-container-high px-space-sm py-space-xs font-mono text-xs text-on-surface focus:border-secondary focus:outline-none"
                    />
                    <button
                        onClick={send}
                        className="p-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container border border-secondary transition-colors"
                        type="button"
                    >
                        <Icon name="send" size={16} />
                    </button>
                </div>
                <p className="font-mono text-[9px] text-on-surface-variant text-center">
                    Suggestions IA indicatives. Décisions à l'opérateur CRC.
                </p>
            </div>
        </div>
    )
}

// ── CRC Urgence modal ─────────────────────────────────────────────────────────
// Two behaviours:
//   • Has active urgences  → shows the dispatch tool for the first pending/acknowledged order
//   • No urgences          → manual urgence entry (CRC-initiated, distributes direct to BCCs)

const BCC_URGENCE_CONFIG =
{
    'CRC Nord':
    [
        { id: 1, label: 'BCC 1 — Tunis Ville & Nord',    cap: null, ratio: 0.33, color: 'secondary' }
        ,{ id: 2, label: 'BCC 2 — Tunis Sud & Ben Arous', cap: null, ratio: 0.26, color: 'secondary' }
        ,{ id: 3, label: 'BCC 3 — Béja (Plafond 8 MW)',   cap: 8,    ratio: 0.15, color: 'tertiary'  }
        ,{ id: 4, label: 'BCC 4 — Bizerte / Mateur',      cap: null, ratio: 0.26, color: 'secondary' }
    ]
    ,'CRC Sud':
    [
        { id: 5, label: 'BCC 5 — Centre (Kairouan / Sidi Bouzid)', cap: null, ratio: 0.40, color: 'secondary' }
        ,{ id: 6, label: 'BCC 6 — Sahel (Sousse / Monastir)',       cap: null, ratio: 0.38, color: 'secondary' }
        ,{ id: 7, label: 'BCC 7 — Sud (Sfax / Gabès / Médenine)',   cap: null, ratio: 0.22, color: 'secondary' }
    ]
}

function CRCUrgenceModal({ isOpen, onClose, myUrgences, onReceipt, onDispatch, onManualEmit, crcName = 'CRC Nord', crcConsigne = 300 })
{
    // ── BCC list for this CRC ─────────────────────────────────────────────────
    const bccUrgenceList = BCC_URGENCE_CONFIG[crcName] ?? BCC_URGENCE_CONFIG['CRC Nord']

    // This modal ALWAYS opens in new-order entry mode (MODE B).
    // Dispatching existing in-flight orders is handled by the CRCUrgencePopup
    // floating badge — no need to duplicate it here.
    // (myUrgences / onReceipt / onDispatch props are kept for API compatibility
    //  but are no longer used to hijack the modal body.)

    // ── Manual entry state ────────────────────────────────────────────────────
    const emptyBccMW = () => Object.fromEntries(bccUrgenceList.map((b) => [b.id, 0]))

    const [mwTotal,    setMwTotal]    = useState('')
    const [bccMW,      setBccMW]      = useState(() => emptyBccMW())
    const [confirmTxt, setConfirmTxt] = useState('')
    const [emitted,    setEmitted]    = useState(false)

    const autoDistribute = (tot) =>
    {
        const mw = Number(tot)
        if (!mw || mw <= 0) { setBccMW(emptyBccMW()); return }
        const result = {}
        let remaining = mw
        bccUrgenceList.forEach((b, i) =>
        {
            if (i === bccUrgenceList.length - 1)
            {
                result[b.id] = Math.max(0, Math.round(remaining * 2) / 2)
            }
            else
            {
                const val = b.cap !== null
                    ? Math.min(b.cap, Math.round(mw * b.ratio))
                    : Math.round(mw * b.ratio)
                result[b.id] = val
                remaining -= val
            }
        })
        setBccMW(result)
    }

    const manualTotal = Object.values(bccMW).reduce((s, v) => s + Number(v), 0)
    const manualGap   = mwTotal ? manualTotal - Number(mwTotal) : null
    const manualOk    = mwTotal && Number(mwTotal) > 0 && manualGap !== null && Math.abs(manualGap) < 0.5 && confirmTxt.toUpperCase() === 'CONFIRMER'

    const handleManualEmit = async () =>
    {
        if (!manualOk) return
        setEmitted(true)
        try
        {
            if (onManualEmit) await onManualEmit({ mwTotal: Number(mwTotal), bccMW })
        }
        catch (err)
        {
            console.error('[CRCUrgenceModal] emit failed:', err)
        }
        setTimeout(() => { setEmitted(false); setConfirmTxt(''); setMwTotal(''); setBccMW(emptyBccMW()); onClose() }, 1800)
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-space-md"
            onClick={onClose}
        >
            <div
                className="bg-surface-container-low w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden ring-2 ring-error"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-space-lg py-space-md bg-error-container shrink-0">
                    <div className="flex items-center gap-space-md min-w-0">
                        <div className="w-8 h-8 bg-surface-container-lowest flex items-center justify-center text-error animate-bounce shrink-0">
                            <Icon name="bolt" size={20} />
                        </div>
                        <div className="min-w-0">
                            <span className="font-sans font-bold text-sm text-on-error-container uppercase tracking-wider">
                                Délestage d'urgence CRC
                            </span>
                            <p className="font-mono text-[10px] text-on-error-container/80 mt-0.5">
                                Distribution directe aux BCCs — {crcName}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-space-xs bg-error-container/60 hover:bg-error-container text-on-error-container transition-colors"
                        type="button"
                    >
                        <Icon name="close" size={17} />
                    </button>
                </div>

                {/* Body — always MODE B: new urgence entry */}
                <div className="flex-1 overflow-y-auto bg-surface-container-lowest p-space-lg flex flex-col gap-space-md">
                    <>
                        <div className="bg-surface-container p-space-md flex flex-col gap-space-sm">
                                <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider">
                                    Puissance supplémentaire à délester ({crcName})
                                </span>
                                <div className="flex items-center gap-space-md">
                                    <div className="relative flex-1">
                                        <input
                                            type="number" min={1} max={200} step={1}
                                            placeholder="Ex: 30"
                                            value={mwTotal}
                                            onChange={(e) => { setMwTotal(e.target.value); autoDistribute(e.target.value); setEmitted(false) }}
                                            className="w-full bg-surface-container-lowest border-2 border-error-container/60 focus:border-error-container text-on-surface font-mono text-2xl font-bold px-space-md py-space-md focus:outline-none transition-all text-center"
                                        />
                                        <span className="absolute right-space-md top-1/2 -translate-y-1/2 font-mono text-sm text-on-surface-variant font-semibold">MW</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        {[10, 20, 30, 50].map((v) => (
                                            <button key={v} onClick={() => { setMwTotal(v); autoDistribute(v) }}
                                                className="px-space-md py-space-xs bg-surface-container hover:bg-error-container/30 border border-surface-container-high hover:border-error-container/50 text-on-surface-variant hover:text-on-error-container font-mono text-xs transition-all"
                                                type="button"
                                            >+{v} MW</button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {mwTotal && Number(mwTotal) > 0 && (
                                <div className="flex flex-col gap-space-sm">
                                    <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant uppercase tracking-wider">
                                        <span>Ventilation par BCC</span>
                                        <button onClick={() => autoDistribute(mwTotal)}
                                            className="flex items-center gap-space-xs px-space-sm py-space-xs bg-secondary-container hover:bg-secondary text-on-secondary-container font-mono text-[10px] font-bold transition-all"
                                            type="button"
                                        >
                                            <Icon name="auto_fix_high" size={12} />
                                            <span>Suggestion IA</span>
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                                        {bccUrgenceList.map((b) =>
                                        {
                                            const val     = bccMW[b.id] ?? 0
                                            const tot     = Number(mwTotal)
                                            const pct     = tot > 0 ? Math.min(100, (val / tot) * 100) : 0
                                            const capWarn = b.cap !== null && val > b.cap
                                            return (
                                                <div key={b.id} className={`bg-surface-container p-space-sm flex flex-col gap-space-xs ${capWarn ? 'ring-1 ring-error' : ''}`}>
                                                    <div className="flex items-center justify-between">
                                                        <span className={`font-sans font-bold text-xs ${capWarn ? 'text-error' : 'text-on-surface'}`}>{b.label}</span>
                                                        <span className={`font-mono text-[10px] ${capWarn ? 'text-error font-bold' : 'text-on-surface-variant'}`}>
                                                            {capWarn ? `MAX ${b.cap} MW` : `${val} MW`}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-space-sm">
                                                        <span className="font-mono text-xs text-on-surface-variant">+</span>
                                                        <input
                                                            type="number" min={0} max={b.cap ?? Number(mwTotal)} step={0.5}
                                                            value={val}
                                                            onChange={(e) => setBccMW((prev) => ({ ...prev, [b.id]: Number(e.target.value) }))}
                                                            className={`w-full bg-surface-container-lowest border focus:outline-none px-space-sm py-space-xs font-mono text-sm font-bold transition-all ${capWarn ? 'border-error text-error' : `border-surface-container-high focus:border-secondary ${b.color === 'tertiary' ? 'text-tertiary' : 'text-secondary'}`}`}
                                                        />
                                                        <span className="font-mono text-xs text-on-surface-variant">MW</span>
                                                    </div>
                                                    <div className="w-full bg-surface-container-lowest h-1 overflow-hidden">
                                                        <div className={`h-full transition-all ${capWarn ? 'bg-error' : b.color === 'tertiary' ? 'bg-tertiary' : 'bg-secondary'}`} style={{ width: `${pct}%` }} />
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                    <div className={`p-space-sm flex items-center justify-between font-mono text-xs border ${Math.abs(manualGap ?? 999) < 0.5 ? 'bg-[#4ade80]/10 border-[#4ade80]/30 text-[#4ade80]' : 'bg-error-container/30 border-error/40 text-error'}`}>
                                        <div className="flex items-center gap-space-md">
                                            <span className="text-on-surface-variant">Total :</span>
                                            <strong className={`text-sm ${Math.abs(manualGap ?? 999) < 0.5 ? 'text-[#4ade80]' : 'text-error'}`}>{manualTotal.toFixed(1)} MW</strong>
                                            <span className="text-on-surface-variant">/ +{mwTotal} MW requis</span>
                                        </div>
                                        <span className="font-bold text-[10px] uppercase px-space-sm py-0.5">
                                            {Math.abs(manualGap ?? 999) < 0.5 ? 'CONFORME' : `ÉCART ${(manualGap ?? 0) > 0 ? '+' : ''}${(manualGap ?? 0).toFixed(1)} MW`}
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-space-xs">
                                        <p className="font-sans text-xs text-on-surface-variant">
                                            Tapez <strong className="text-error font-mono">CONFIRMER</strong> pour autoriser l'émission de l'ordre.
                                        </p>
                                        <input
                                            type="text" placeholder="Tapez CONFIRMER"
                                            value={confirmTxt}
                                            onChange={(e) => setConfirmTxt(e.target.value)}
                                            className="w-full bg-surface-container-lowest border border-surface-container-high focus:border-error-container text-on-surface font-mono text-sm px-space-md py-space-sm focus:outline-none transition-all tracking-widest"
                                        />
                                    </div>
                                </div>
                            )}
                        </>
                </div>

                {/* Footer */}
                <div className="px-space-lg py-space-md bg-surface-container border-t border-surface-container-high flex items-center justify-between shrink-0 flex-wrap gap-space-md">
                    <div className="flex items-center gap-space-xs font-mono text-[10px] text-on-surface-variant">
                        <Icon name="lock" size={13} className="text-tertiary" />
                        <span>Ordre horodaté dans l'audit CRC · Action irréversible</span>
                    </div>
                    <div className="flex items-center gap-space-sm">
                        <button
                            onClick={onClose}
                            className="px-space-md py-space-xs bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-mono text-xs border border-surface-container-high transition-colors"
                            type="button"
                        >
                            Annuler
                        </button>
                        <button
                            onClick={handleManualEmit}
                            disabled={!manualOk || emitted}
                            className="flex items-center gap-space-sm px-space-lg py-space-xs bg-error text-background hover:bg-error-container hover:text-on-error-container font-mono text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                            type="button"
                        >
                            {emitted
                                ? <><Icon name="check_circle" size={14} className="text-[#4ade80]" /><span>Ordre émis !</span></>
                                : <><Icon name="bolt" size={14} /><span>Émettre l'ordre d'urgence</span></>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CRCDashboard()
{
    const { user }                          = useAuthStore()
    const { acknowledgeReceipt, dispatchComplete, partialDispatch, partialRealim, setModalOpen } = useUrgenceStore()
    const userCRC    = user?.zone ?? 'CRC Nord'
    const { data: dbData, loading: dbLoading, lastUpdated } = useCRCDashboard(userCRC)

    // Live orders from DB/WebSocket — filtered to orders targeting this CRC
    const { orders, updateOrderStatus, addOrUpdateOrder } = useLiveStore()
    const crcId = dbData?.crcSummary?.crc_id ?? null

    // Live timeseries for regional chart — filtered to this CRC's BCCs
    const { slots: tsSlots } = useTimeseries(crcId)
    const crcChartPts = tsSlots.length > 0 ? slotsToChartPtsCRC(tsSlots) : CRC_CHART_FALLBACK
    const liveOrders = orders.filter(
        (o) => ['pending','acknowledged','executing'].includes(o.status)
              && (o.target_crc_id === null || o.target_crc_id === crcId)
    )

    // ── J+1 published: reload ProgrammeJ1Modal slots when DN validates ────────
    const {
        j1NotificationPending
        ,j1ProgrammeDate
        ,j1NotificationIsAutoZero
        ,dismissJ1Notification
    } = useProgrammesStore()

    const { resolveNotification } = useAlertStore()

    // j1ReloadKey bumps whenever a j1_published event arrives.
    // ProgrammeJ1Modal listens to this via prop and refetches its slots.
    const [j1ReloadKey, setJ1ReloadKey] = useState(0)

    useEffect(() =>
    {
        if (!j1NotificationPending) return
        // Trigger a slot reload inside the J+1 modal
        setJ1ReloadKey((k) => k + 1)
        // The notification itself was already added to alertStore by useWebSocket.
        // Dismiss the pending flag so this effect doesn't re-fire.
        dismissJ1Notification()
    }, [j1NotificationPending, dismissJ1Notification])

    // Acknowledge an order (step 1 — presses "Reçu")
    const handleAckOrder = async (orderId) => {
        // Update legacy urgenceStore for popup compatibility
        acknowledgeReceipt(orderId)
        // Update liveStore immediately for instant UI feedback
        updateOrderStatus(orderId, 'acknowledged')
        try {
            await api.patch(`/api/v1/orders/${orderId}/ack`, {
                mw_assigned: 0,   // CRC assigns MW to BCCs separately
            })
        } catch (err) {
            console.error('[CRC] Failed to ack order:', err?.response?.data ?? err.message)
        }
    }

    // Dispatch complete (step 2 — CRC has split MW to BCCs and confirmed)
    const handleDispatchOrder = async (orderId) => {
        dispatchComplete(orderId)
        updateOrderStatus(orderId, 'executing')
        try {
            await api.patch(`/api/v1/orders/${orderId}/execute`, {
                mw_executed: 0,   // actual MW confirmed once BCCs report back
            })
        } catch (err) {
            console.error('[CRC] Failed to mark order executing:', err?.response?.data ?? err.message)
        }
    }

    // CRC-initiated urgence (MODE B — no active DN order, CRC distributes directly to BCCs)
    const handleCrcUrgence = async ({ mwTotal, bccMW }) => {
        const now  = new Date()
        const hhmm = `${String(now.getHours()).padStart(2,'0')}h${String(now.getMinutes()).padStart(2,'0')}`

        // mw_nord / mw_sud depend on which CRC we are
        const mwNord = userCRC === 'CRC Nord' ? mwTotal : 0
        const mwSud  = userCRC === 'CRC Sud'  ? mwTotal : 0

        const { data: order } = await api.post('/api/v1/orders', {
            order_type:     'urgence'
            ,mw_total:      mwTotal
            ,mw_nord:       mwNord
            ,mw_sud:        mwSud
            ,target_crc_id: null
            ,notes:         `Urgence CRC initiee par ${userCRC} a ${hhmm} — ventilation BCCs: ${JSON.stringify(bccMW)}`
        })

        // Push into liveStore so BCCDashboard and BCCOrderPopup see it
        addOrUpdateOrder({
            id:              order.id
            ,order_ref:      order.order_ref
            ,order_type:     order.order_type
            ,mw_total:       order.mw_total
            ,mw_nord:        order.mw_nord
            ,mw_sud:         order.mw_sud
            ,status:         'pending'
            ,issued_at:      order.issued_at
            ,target_crc_id:  order.target_crc_id
            ,issued_by_role: 'CRC'
            ,acks:           []
        })

        // ── Reduce the DN banner by the dispatched amount ─────────────────────
        // The CRC dispatching mwTotal MW to BCCs counts as covering that much of
        // the DN's urgence obligation. Distribute the reduction proportionally
        // across all active (acknowledged) DN urgence orders.
        const crcZone = userCRC === 'CRC Sud' ? 'sud' : 'nord'
        const activeDnUrgences = useUrgenceStore.getState().urgences.filter(
            (o) => o.status === 'acknowledged'
        )
        if (activeDnUrgences.length > 0 && partialDispatch) {
            // Total remaining obligation across all active DN orders
            const totalRemaining = activeDnUrgences.reduce((s, o) => {
                const target     = crcZone === 'sud' ? (o.mwSud ?? o.mwNord ?? 0) : (o.mwNord ?? 0)
                const dispatched = o.mwDispatched ?? 0
                return s + Math.max(0, target - dispatched)
            }, 0)

            let leftToApply = mwTotal
            activeDnUrgences.forEach((o) => {
                if (leftToApply <= 0) return
                const target     = crcZone === 'sud' ? (o.mwSud ?? o.mwNord ?? 0) : (o.mwNord ?? 0)
                const remaining  = Math.max(0, target - (o.mwDispatched ?? 0))
                // Apply proportional share, capped to this order's remaining
                const share = totalRemaining > 0
                    ? Math.min(remaining, (remaining / totalRemaining) * mwTotal)
                    : remaining
                const applied = Math.min(leftToApply, share)
                partialDispatch(o.id, applied, crcZone)
                leftToApply -= applied
            })
        }
    }

    // ── Derived from API or static fallback ───────────────────────────────────
    const crcReal    = dbData?.crcSummary?.realise  ?? 282.0
    const crcCons    = dbData?.crcSummary?.consigne ?? 300.0
    const crcEcart   = dbData?.crcSummary?.ecart    ?? -18.0
    const crcPct     = crcCons > 0 ? ((crcReal / crcCons) * 100).toFixed(1) : '0'
    const liveCuts   = dbData?.liveCuts  ?? []
    const bccRowsApi = dbData?.bccRows   ?? []
    const totalCuts  = liveCuts.length
    const overdueCuts= liveCuts.filter((c) => c.overdue)

    // Build BCC_STATUS from API — empty array when API has no data (no fake fallback)
    const bccStatusDynamic = bccRowsApi.length > 0
        ? bccRowsApi.map((b, i) => ({
            id:       i + 1
            ,label:   b.name.replace('BCC ', 'BCC ') + ' — ' + (b.zone?.split('/')[0]?.trim() ?? '')
            ,full:    `${b.name} — ${b.zone}`
            ,sub:     `Consigne: ${b.consigne} MW`
            ,consigne: b.consigne
            ,realise:  b.realise
            ,pct:      b.consigne > 0 ? (b.realise / b.consigne * 100) : 0
            ,dot:      b.statut === 'CRITIQUE' || b.statut === 'SOUS-CONSIGNE' ? 'bg-error' : b.statut === 'ATTENTION' ? 'bg-tertiary' : 'bg-[#4ade80]'
            ,dotAnim:  b.statut === 'CRITIQUE' ? 'animate-ping' : b.statut === 'SOUS-CONSIGNE' ? 'animate-pulse' : ''
            ,barCls:   b.statut === 'CRITIQUE' || b.statut === 'SOUS-CONSIGNE' ? 'bg-error' : 'bg-secondary'
            ,note:     b.statut === 'CRITIQUE' ? `${b.ecart.toFixed(1)} MW` : b.statut === 'ATTENTION' ? `${b.ecart.toFixed(1)} MW` : `${(b.realise / b.consigne * 100).toFixed(0)}%`
            ,noteCls:  b.statut === 'CRITIQUE' || b.statut === 'SOUS-CONSIGNE' ? 'text-error font-bold' : b.statut === 'ATTENTION' ? 'text-tertiary' : 'text-[#4ade80]'
        }))
        : []   // loading state — empty, shows spinner below

    // Build live cuts table from API — empty array when no data (no fake fallback)
    const cutsTableDynamic = liveCuts.length > 0
        ? liveCuts.map((c, i) => ({
            id:        i + 1
            ,bcc:      c.bcc_name
            ,bccShort: `${c.bcc_name} (${c.bcc_name.replace('BCC ', '').split(' ')[0]})`
            ,ref:      c.feeder_ref
            ,poste:    `${c.bcc_name.toUpperCase()} / ${c.feeder_nom}`
            ,debut:    c.started_at
            ,dur:      Math.round(c.elapsed_min)
            ,mw:       c.mw_shed
            ,statut:   c.overdue ? 'overdue' : 'ok'
        }))
        : []   // loading state — empty, no fake data shown

    const [time,         setTime]           = useState(new Date())
    const [j1Open,       setJ1Open]         = useState(false)
    const [aiOpen,       setAiOpen]         = useState(false)
    const [urgenceOpen,  setUrgenceOpen]    = useState(false)
    const [realimOpen,   setRealimOpen]     = useState(false)
    const [expanded,   setExpanded]         = useState({ bcc3: true })
    const [filterBCC,  setFilterBCC]        = useState('all')
    const [sortDesc,   setSortDesc]         = useState(true)
    const [page,       setPage]             = useState(1)
    const ROWS_PER_PAGE = 5

    // Active urgences for this CRC — only DN-issued orders from liveStore trigger the animation.
    // Strict: no legacy urgenceStore fallback. The WebSocket/REST is the authoritative source.
    // Executing orders are excluded — once a BCC is executing, the CRC obligation is met.
    const myUrgences = liveOrders
        .filter((o) => o.order_type === 'urgence'
                    && ['pending', 'acknowledged'].includes(o.status)
                    && o.issued_by_role === 'DN')
        .map((o) => ({
            id:        o.id,
            orderRef:  o.order_ref,
            mwTotal:   o.mw_total,
            mwNord:    o.mw_nord,
            mwSud:     o.mw_sud,
            status:    o.status,
            targetCRC: o.target_crc_id === null ? 'both' : userCRC,
            isDbOrder: true,
        }))
    const hasUrgence = myUrgences.length > 0

    // Active realims for this CRC — same strict pattern as urgences.
    const myRealims = liveOrders
        .filter((o) => o.order_type === 'realim'
                    && ['pending', 'acknowledged'].includes(o.status)
                    && o.issued_by_role === 'DN')
    const hasRealim = myRealims.length > 0

    // Live clock
    useEffect
    (
        () =>
        {
            const t = setInterval(() => setTime(new Date()), 1000)
            return () => clearInterval(t)
        }
        ,[]
    )

    const pad     = (n) => String(n).padStart(2, '0')
    const timeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())} UTC+1`

    const toggleBCC = (id) =>
        setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

    // Cuts table logic — wired to live API data, fallback to static CUTS_DATA
    const filtered = cutsTableDynamic
        .filter((c) => filterBCC === 'all' || c.bcc === filterBCC)
        .sort((a, b) => sortDesc ? b.dur - a.dur : a.dur - b.dur)

    const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
    const paged      = filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)
    const uniqueBCCs = [...new Set(cutsTableDynamic.map((c) => c.bcc))].sort()

    return (
        <div className="flex flex-col w-full text-on-surface">

            {/* ── SECTION 1 — Top context bar ─────────────────────────────── */}
            <div className="flex flex-col gap-space-xs">
                <div className="bg-surface-container-low p-space-md flex flex-wrap items-center justify-between gap-space-md shadow-md">
                    {/* Left: CRC ident */}
                    <div className="flex items-center gap-space-lg flex-wrap">
                        <div className="flex items-center gap-space-sm bg-surface-container-lowest px-space-md py-space-xs">
                            <span className="w-2.5 h-2.5 rounded-full bg-tertiary animate-ping" />
                            <span className="font-mono font-bold text-sm text-secondary tracking-wide uppercase">{userCRC.toUpperCase()}</span>
                            <span className="text-on-surface-variant font-mono text-xs">
                                {userCRC === 'CRC Nord' ? '/ GRAND TUNIS & NORD' : '/ CENTRE & SUD'}
                            </span>
                        </div>
                        <div className="flex items-center gap-space-xs font-mono text-xs text-primary">
                            <Icon name="schedule" size={15} className="text-secondary" />
                            <span>{timeStr}</span>
                            <span className="text-on-surface-variant text-[10px]">
                                {userCRC === 'CRC Nord' ? '· POSTE SOURCE RADÈS II' : '· POSTE SOURCE THYNA / SFAX'}
                            </span>
                        </div>
                        <div className="flex items-center gap-space-xs px-space-sm py-0.5 bg-surface-container font-mono text-[10px] text-on-surface">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                            <span>SCADA IEC-60870-5-104 OPÉRATIONNEL</span>
                        </div>
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex items-center gap-space-md flex-wrap">
                        <button
                            onClick={() => setJ1Open(true)}
                            className="flex items-center gap-space-xs px-space-md py-space-xs bg-surface-container-high hover:bg-surface-container-highest text-secondary font-mono text-xs transition-colors whitespace-nowrap"
                            type="button"
                        >
                            <Icon name="calendar_month" size={15} />
                            <span>Programme J+1</span>
                        </button>
                        <button
                            onClick={() => setAiOpen(true)}
                            className="flex items-center gap-space-xs px-space-md py-space-xs bg-secondary-container/30 hover:bg-secondary-container/60 text-secondary border border-secondary/40 font-mono text-xs transition-colors whitespace-nowrap"
                            type="button"
                        >
                            <Icon name="smart_toy" size={15} />
                            <span>Assistant IA</span>
                        </button>
                        <button
                            onClick={() => { setUrgenceOpen(true); setModalOpen(true) }}
                            className={`flex items-center gap-space-xs px-space-md py-space-xs font-mono text-xs font-bold transition-colors whitespace-nowrap ${hasUrgence ? 'bg-error-container text-on-error-container hover:bg-error hover:text-background animate-pulse border border-error' : 'bg-error-container/40 hover:bg-error-container text-on-error-container border border-error-container'}`}
                            type="button"
                        >
                            <Icon name="bolt" size={15} />
                            <span>Délestage d'urgence</span>
                            {hasUrgence && (
                                <span className="w-2 h-2 rounded-full bg-error animate-ping ml-space-xs" />
                            )}
                        </button>
                        <button
                            onClick={() => setRealimOpen(true)}
                            className={`flex items-center gap-space-xs px-space-md py-space-xs font-mono text-xs font-bold transition-colors whitespace-nowrap ${hasRealim ? 'bg-secondary-container text-secondary border border-secondary animate-pulse hover:bg-secondary hover:text-background' : 'bg-secondary-container/40 hover:bg-secondary-container text-secondary border border-secondary/40'}`}
                            type="button"
                        >
                            <Icon name="refresh" size={15} />
                            <span>Réalimentation</span>
                            {hasRealim && (
                                <span className="w-2 h-2 rounded-full bg-secondary animate-ping ml-space-xs" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Comms strip */}
                <div className="bg-surface-container-lowest px-space-md py-space-xs flex flex-wrap items-center justify-between font-mono text-[10px] text-on-surface-variant gap-space-md">
                    <div className="flex items-center gap-space-lg flex-wrap">
                        <div className="flex items-center gap-1">
                            <span className="text-on-surface-variant uppercase">Chef de quart :</span>
                            <span className="text-on-surface font-semibold">Ing. M. Trabelsi (Matr. 48821)</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Icon name="radio" size={12} className="text-secondary" />
                            <span className="text-on-surface-variant uppercase">VHF :</span>
                            <span className="text-secondary font-semibold">
                                {userCRC === 'CRC Nord' ? 'Canal 04-Nord (168.450 MHz)' : 'Canal 07-Sud (169.250 MHz)'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Icon name="call" size={12} className="text-tertiary" />
                            <span className="text-on-surface-variant uppercase">Ligne DN :</span>
                            <span className="text-tertiary font-semibold">
                                {userCRC === 'CRC Nord' ? '+216 71 340 102' : '+216 74 220 881'}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-space-xs">
                        <span className="text-on-surface-variant">SCADA synchro :</span>
                        <span className="text-[#4ade80] font-bold">18 ms</span>
                        <span className="text-on-surface-variant">(BCCs 100% connectés)</span>
                    </div>
                </div>
            </div>

            {/* ── SECTION 2 — KPI cards ───────────────────────────────────── */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md p-space-md">
                {/* KPI 1 — Cible DN */}
                <div className="bg-surface-container-low p-space-md flex flex-col justify-between shadow-md">
                    <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider">Cible Reçue du DN</span>
                        <span className="px-space-xs py-0.5 bg-surface-container-highest text-secondary font-mono text-[9px]">DISP. NAT.</span>
                    </div>
                    <div className="flex items-baseline gap-space-xs my-space-xs">
                        <span className="font-mono text-3xl font-bold text-secondary">{crcCons.toFixed(1)}</span>
                        <span className="font-mono text-sm text-on-surface-variant">MW</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant bg-surface-container-lowest/50 px-space-sm py-space-xs mt-space-xs">
                        <span>Quota fixe {userCRC}</span>
                        <span className="text-secondary font-semibold">100,0 % Cible</span>
                    </div>
                </div>

                {/* KPI 2 — Réalisé régional */}
                {(() => {
                    const isDeficit = crcEcart < -5
                    return (
                        <div className="bg-surface-container-low p-space-md flex flex-col justify-between shadow-md">
                            <div className="flex items-center justify-between">
                                <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider">Réalisé Régional</span>
                                <span className={`px-space-xs py-0.5 font-mono text-[9px] font-bold ${isDeficit ? 'bg-tertiary-container text-tertiary' : 'bg-surface-container-highest text-secondary'}`}>
                                    {crcEcart >= 0 ? '+' : ''}{crcEcart.toFixed(1)} MW
                                </span>
                            </div>
                            <div className="flex items-baseline gap-space-xs my-space-xs">
                                <span className={`font-mono text-3xl font-bold ${isDeficit ? 'text-tertiary' : 'text-secondary'}`}>{crcReal.toFixed(1)}</span>
                                <span className="font-mono text-sm text-on-surface-variant">MW</span>
                            </div>
                            <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant bg-surface-container-lowest/50 px-space-sm py-space-xs mt-space-xs">
                                <span>Taux d'exécution</span>
                                <span className={`font-bold ${isDeficit ? 'text-tertiary' : 'text-[#4ade80]'}`}>{crcPct} %</span>
                            </div>
                        </div>
                    )
                })()}

                {/* KPI 3 — Départs en coupure */}
                {(() => {
                    const hasOverdue = overdueCuts.length > 0
                    return (
                        <div className="bg-surface-container-low p-space-md flex flex-col justify-between shadow-md">
                            <div className="flex items-center justify-between">
                                <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider">Départs HTA en Coupure</span>
                                {hasOverdue && (
                                    <span className="px-space-xs py-0.5 bg-error-container text-on-error-container font-mono text-[9px] font-bold animate-pulse">
                                        {overdueCuts.length} &gt; 45 MIN
                                    </span>
                                )}
                            </div>
                            <div className="flex items-baseline gap-space-xs my-space-xs">
                                <span className={`font-mono text-3xl font-bold ${hasOverdue ? 'text-error' : 'text-secondary'}`}>{totalCuts}</span>
                                <span className="font-mono text-sm text-on-surface-variant">Feeders</span>
                            </div>
                            <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant bg-surface-container-lowest/50 px-space-sm py-space-xs mt-space-xs">
                                <span>Charge délestée</span>
                                <span className={`font-semibold ${hasOverdue ? 'text-error' : 'text-secondary'}`}>
                                    {liveCuts.reduce((s, c) => s + c.mw_shed, 0).toFixed(1)} MW actif
                                </span>
                            </div>
                        </div>
                    )
                })()}

                {/* KPI 4 — Last updated */}
                <div className="bg-surface-container-low p-space-md flex flex-col justify-between shadow-md">
                    <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider">Synchronisation</span>
                        <span className={`px-space-xs py-0.5 font-mono text-[9px] font-bold ${dbLoading ? 'bg-tertiary-container text-tertiary' : 'bg-surface-container-highest text-[#4ade80]'}`}>
                            {dbLoading ? 'CHARGEMENT' : 'CONNECTÉ'}
                        </span>
                    </div>
                    <div className="flex items-baseline gap-space-xs my-space-xs">
                        <span className="font-mono text-3xl font-bold text-[#4ade80]">30</span>
                        <span className="font-mono text-sm text-on-surface-variant">sec</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant bg-surface-container-lowest/50 px-space-sm py-space-xs mt-space-xs">
                        <span>Dernière mise à jour</span>
                        <span className="text-[#4ade80] font-semibold">
                            {lastUpdated ? lastUpdated.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'}
                        </span>
                    </div>
                </div>
            </section>

            {/* ── SECTION 3 — 60/40 split ─────────────────────────────────── */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-space-md px-space-md pb-space-md">

                {/* Left 7/12 — chart + BCC cards */}
                <div className="lg:col-span-7 flex flex-col gap-space-md">
                    <div className="bg-surface-container-low p-space-md shadow-md flex flex-col gap-space-md">

                        {/* Chart header */}
                        <div className="flex flex-wrap items-center justify-between gap-space-sm">
                            <div className="flex items-center gap-space-sm">
                                <Icon name="show_chart" size={20} className="text-secondary" />
                                <span className="font-sans font-semibold text-sm text-on-surface uppercase tracking-wide">
                                    Suivi d'Exécution Régional — {userCRC}
                                </span>
                            </div>
                            <div className="flex items-center gap-space-md font-mono text-[10px]">
                                <div className="flex items-center gap-1">
                                    <span className="w-3 h-0.5 inline-block" style={{ borderTop: '2px dashed #acc7ff', background: 'transparent' }} />
                                    <span className="text-on-surface-variant">Consigne DN (300 MW)</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="w-3 h-0.5 bg-tertiary inline-block" />
                                    <span className="text-on-surface">Réalisé Région</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="w-2.5 h-2.5 bg-error/30 inline-block" />
                                    <span className="text-error">Déficit</span>
                                </div>
                            </div>
                        </div>

                        <RegionalChart chartPts={crcChartPts} />

                        {/* 4 BCC mini-cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
                            {bccStatusDynamic.length === 0
                                ? (
                                    <div className="col-span-4 flex items-center justify-center gap-space-sm py-4 font-mono text-[10px] text-on-surface-variant">
                                        <Icon name="hourglass_empty" size={14} className="text-secondary animate-spin" />
                                        <span>Chargement des données BCC...</span>
                                    </div>
                                )
                                : bccStatusDynamic.map((b, idx) => (
                                <div
                                    key={idx}
                                    className={`p-space-sm flex flex-col justify-between ${b.dotAnim.includes('ping') ? 'bg-tertiary-container/20' : 'bg-surface-container'}`}
                                >
                                    <div className="flex items-center justify-between font-mono text-[10px]">
                                        <span className={b.dotAnim ? 'text-tertiary font-bold' : 'text-on-surface font-semibold'}>
                                            {b.name ?? b.label}
                                        </span>
                                        <span className={`w-1.5 h-1.5 rounded-full ${b.dot} ${b.dotAnim}`} />
                                    </div>
                                    <div className="flex items-baseline justify-between my-space-xs">
                                        <span className={`font-mono text-sm font-bold ${b.dotAnim.includes('ping') ? 'text-error' : 'text-secondary'}`}>
                                            {b.realise.toFixed(1)} / {b.consigne}
                                        </span>
                                        <span className="font-mono text-[10px] text-on-surface-variant">MW</span>
                                    </div>
                                    <div className="w-full bg-surface-container-lowest h-1 overflow-hidden">
                                        <div className={`${b.barCls} h-full transition-all`} style={{ width: `${Math.min(b.pct, 100)}%` }} />
                                    </div>
                                    <div className="flex items-center justify-between font-mono text-[10px] mt-space-xs">
                                        <span className="text-on-surface-variant">{b.sub?.split(':')[1]?.trim() ?? ''}</span>
                                        <span className={b.noteCls}>{b.note}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right 5/12 — live shedding accordion */}
                <div className="lg:col-span-5 flex flex-col bg-surface-container-low p-space-md shadow-md gap-space-sm">
                    <div className="flex items-center justify-between bg-surface-container-lowest p-space-sm">
                        <div className="flex items-center gap-space-sm">
                            <Icon name="account_tree" size={18} className="text-tertiary" />
                            <span className="font-sans font-semibold text-xs text-on-surface uppercase tracking-wide">
                                Délestages en Cours
                            </span>
                        </div>
                        <span className="px-space-xs py-0.5 bg-error-container text-on-error-container font-mono text-[9px] font-bold">
                            {totalCuts} DÉPARTS
                        </span>
                    </div>

                    <div className="flex-1 flex flex-col gap-space-xs overflow-y-auto max-h-96">
                        {liveCuts.length === 0
                            ? (
                                <div className="flex flex-col items-center justify-center py-8 gap-space-md text-on-surface-variant">
                                    <Icon name="check_circle" size={32} className="text-[#4ade80] opacity-60" />
                                    <p className="font-mono text-xs">Aucune coupure active en ce moment</p>
                                </div>
                            )
                            : Object.entries(
                                liveCuts.reduce((acc, c) =>
                                {
                                    const key = c.bcc_name
                                    if (!acc[key]) acc[key] = []
                                    acc[key].push(c)
                                    return acc
                                }, {})
                            ).map(([bccName, cuts]) =>
                            {
                                const hasOverdueInBcc = cuts.some((c) => c.overdue)
                                const totalMW = cuts.reduce((s, c) => s + c.mw_shed, 0)
                                return (
                                    <div key={bccName} className={`overflow-hidden ${hasOverdueInBcc ? 'ring-1 ring-error' : ''}`}>
                                        <button
                                            type="button"
                                            onClick={() => toggleBCC(bccName)}
                                            className={`w-full p-space-sm flex items-center justify-between text-left transition-colors ${hasOverdueInBcc ? 'bg-tertiary-container/30 hover:bg-tertiary-container/50' : 'bg-surface-container hover:bg-surface-container-high'}`}
                                        >
                                            <div className="flex items-center gap-space-sm font-mono text-xs font-bold">
                                                <Icon name={expanded[bccName] ? 'expand_less' : 'expand_more'} size={15} className={hasOverdueInBcc ? 'text-error' : 'text-secondary'} />
                                                <span className={hasOverdueInBcc ? 'text-tertiary' : 'text-on-surface'}>{bccName}</span>
                                            </div>
                                            <div className="flex items-center gap-space-md font-mono text-[10px]">
                                                {hasOverdueInBcc && <span className="text-error font-bold">{cuts.filter((c) => c.overdue).length} OVERDUE</span>}
                                                <span className="text-on-surface-variant">{cuts.length} départs</span>
                                                <span className={`font-bold ${hasOverdueInBcc ? 'text-error' : 'text-secondary'}`}>{totalMW.toFixed(1)} MW</span>
                                            </div>
                                        </button>
                                        {expanded[bccName] && (
                                            <div className="bg-surface-container-lowest flex flex-col gap-space-xs p-space-xs">
                                                {cuts.map((c) => (
                                                    <div key={c.execution_id}
                                                        className={`flex items-center justify-between px-space-sm py-space-xs font-mono text-[10px] ${c.overdue ? 'bg-error-container/40 text-on-error-container animate-pulse' : 'bg-surface-container-low text-on-surface-variant'}`}
                                                    >
                                                        <div className="flex items-center gap-space-sm min-w-0">
                                                            {c.overdue && <Icon name="timer_off" size={12} className="text-error shrink-0" />}
                                                            <span className={`font-bold shrink-0 ${c.overdue ? 'text-error' : 'text-secondary'}`}>{c.feeder_ref}</span>
                                                            <span className="truncate">{c.feeder_nom}</span>
                                                        </div>
                                                        <div className="flex items-center gap-space-md shrink-0">
                                                            <span className="font-semibold">{c.mw_shed} MW</span>
                                                            <span className={c.overdue ? 'text-error font-bold' : 'text-on-surface-variant'}>{Math.round(c.elapsed_min)} min</span>
                                                            {c.overdue
                                                                ? <span className="px-space-xs py-0.5 bg-error text-background font-bold text-[9px] uppercase">ROTATION REQUISE</span>
                                                                : <span className="text-[#4ade80]">EN COURS</span>
                                                            }
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })
                        }
                    </div>
                </div>
            </section>

            {/* ── SECTION 4 — Full-width cuts table ───────────────────────── */}
            <section className="px-space-md pb-space-md">
                <div className="bg-surface-container-low shadow-md flex flex-col overflow-hidden">
                    {/* Table header + filters */}
                    <div className="bg-surface-container-lowest p-space-sm flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container-high">
                        <div className="flex items-center gap-space-sm">
                            <Icon name="table_rows" size={18} className="text-secondary" />
                            <span className="font-sans font-semibold text-xs text-on-surface uppercase tracking-wide">
                                Journal Opérationnel des Coupures HTA en Cours
                            </span>
                            <span className="px-space-xs py-0.5 bg-error-container text-on-error-container font-mono text-[9px] font-bold">
                                {cutsTableDynamic.filter((c) => c.statut === 'overdue').length} OVERDUE
                            </span>
                        </div>
                        <div className="flex items-center gap-space-sm font-mono text-[10px]">
                            <div className="flex items-center gap-space-xs bg-surface-container px-space-sm py-space-xs border border-surface-container-high">
                                <span className="text-on-surface-variant uppercase">BCC :</span>
                                <select
                                    value={filterBCC}
                                    onChange={(e) => { setFilterBCC(e.target.value); setPage(1) }}
                                    className="bg-transparent text-on-surface focus:outline-none"
                                >
                                    <option value="all">Tous (4)</option>
                                    {uniqueBCCs.map((b) => <option key={b} value={b}>{b}</option>)}
                                </select>
                            </div>
                            <button
                                onClick={() => { setSortDesc((d) => !d); setPage(1) }}
                                className="flex items-center gap-space-xs px-space-sm py-space-xs bg-surface-container border border-surface-container-high text-secondary hover:bg-surface-container-high transition-colors"
                                type="button"
                            >
                                <Icon name="swap_vert" size={13} />
                                <span>{sortDesc ? 'Plus long en premier' : 'Plus récent en premier'}</span>
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left font-mono text-[10px]">
                            <thead className="bg-surface-container font-mono text-[9px] text-on-surface-variant uppercase tracking-wider">
                                <tr>
                                    <th className="py-space-sm px-space-md">BCC Responsable</th>
                                    <th className="py-space-sm px-space-md">Réf Départ</th>
                                    <th className="py-space-sm px-space-md">Poste Source / Nom Feeder</th>
                                    <th className="py-space-sm px-space-md text-center">Début Coupure</th>
                                    <th className="py-space-sm px-space-md text-right">Durée Écoulée</th>
                                    <th className="py-space-sm px-space-md text-right">Puissance</th>
                                    <th className="py-space-sm px-space-md text-center">Statut Rotation</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-container-high">
                                {paged.length === 0
                                    ? (
                                        <tr>
                                            <td colSpan={7} className="py-8 text-center font-mono text-[10px] text-on-surface-variant">
                                                <div className="flex flex-col items-center gap-space-sm">
                                                    <span className="material-symbols-outlined text-[#4ade80]" style={{ fontSize: 24 }}>check_circle</span>
                                                    <span className="text-[#4ade80] font-semibold uppercase tracking-wider">Aucune coupure active</span>
                                                    <span>Le réseau est équilibré — aucun délestage en cours sur cette région</span>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                    : paged.map((c) => (
                                    <tr
                                        key={c.id}
                                        className={`transition-colors ${c.statut === 'overdue' ? 'bg-error-container/20 hover:bg-error-container/30 border-l-2 border-error' : 'bg-surface-container-low hover:bg-surface-container'}`}
                                    >
                                        <td className={`py-space-sm px-space-md font-bold ${c.statut === 'overdue' ? 'text-error' : 'text-secondary'}`}>
                                            {c.bccShort}
                                        </td>
                                        <td className="py-space-sm px-space-md font-bold text-on-surface">{c.ref}</td>
                                        <td className="py-space-sm px-space-md text-on-surface-variant">{c.poste}</td>
                                        <td className="py-space-sm px-space-md text-center text-on-surface-variant">{c.debut}</td>
                                        <td className={`py-space-sm px-space-md text-right font-bold ${c.dur >= 45 ? 'text-error' : 'text-on-surface'}`}>
                                            <div className="flex items-center justify-end gap-space-xs">
                                                {c.dur >= 45 && <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping" />}
                                                <span>{c.dur} min</span>
                                            </div>
                                        </td>
                                        <td className="py-space-sm px-space-md text-right font-bold text-secondary">{c.mw.toFixed(1)} MW</td>
                                        <td className="py-space-sm px-space-md text-center">
                                            {c.statut === 'overdue'
                                                ? <span className="px-space-sm py-0.5 bg-error text-background font-bold text-[9px] uppercase">DÉPASSEMENT (&gt;45M)</span>
                                                : <span className="px-space-sm py-0.5 bg-[#4ade80]/10 text-[#4ade80] font-bold text-[9px]">CONFORME</span>
                                            }
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="px-space-md py-space-sm bg-surface-container-lowest border-t border-surface-container-high flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
                        <button
                            disabled={page <= 1}
                            onClick={() => setPage((p) => p - 1)}
                            className="flex items-center gap-space-xs px-space-sm py-space-xs bg-surface-container hover:bg-surface-container-high disabled:opacity-40 disabled:pointer-events-none border border-surface-container-high transition-colors"
                            type="button"
                        >
                            <Icon name="chevron_left" size={13} />
                            <span>Précédent</span>
                        </button>
                        <span>
                            {filtered.length === 0
                                ? 'Aucun départ'
                                : `${(page-1)*ROWS_PER_PAGE+1}–${Math.min(page*ROWS_PER_PAGE, filtered.length)} sur ${filtered.length} départs actifs`
                            }
                        </span>
                        <button
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => p + 1)}
                            className="flex items-center gap-space-xs px-space-sm py-space-xs bg-surface-container hover:bg-surface-container-high disabled:opacity-40 disabled:pointer-events-none border border-surface-container-high transition-colors"
                            type="button"
                        >
                            <span>Suivant</span>
                            <Icon name="chevron_right" size={13} />
                        </button>
                    </div>
                </div>
            </section>

            {/* Modals & panels */}
            <ProgrammeJ1Modal isOpen={j1Open} onClose={() => setJ1Open(false)} crcName={userCRC} bccList={dbData?.crcSummary?.bccs ?? []} reloadKey={j1ReloadKey} targetDate={j1ProgrammeDate} />
            <AiPanel         isOpen={aiOpen} onClose={() => setAiOpen(false)} crcName={userCRC} />
            <CRCRealimModal
                isOpen={realimOpen}
                onClose={() => setRealimOpen(false)}
                crcName={userCRC}
                onEmit={async ({ type, mwTotal, bccMW }) => {
                    try {
                        const now  = new Date()
                        const hhmm = `${String(now.getHours()).padStart(2,'0')}h${String(now.getMinutes()).padStart(2,'0')}`
                        const { data: order } = await api.post('/api/v1/orders', {
                            order_type: 'realim',
                            sub_type:   type,
                            mw_total:   mwTotal,
                            mw_nord:    userCRC === 'CRC Nord' ? mwTotal : 0,
                            mw_sud:     userCRC === 'CRC Sud'  ? mwTotal : 0,
                            notes:      `Realimentation ${type} emise par ${userCRC} a ${hhmm}`,
                        })
                        updateOrderStatus(order.id, 'pending')

                        // ── Reduce the DN realim banner by the dispatched amount ─────
                        const crcZone = userCRC === 'CRC Sud' ? 'sud' : 'nord'
                        const activeDnRealims = useUrgenceStore.getState().realims.filter(
                            (r) => r.status === 'acknowledged'
                        )
                        if (activeDnRealims.length > 0 && partialRealim) {
                            const totalRemaining = activeDnRealims.reduce((s, r) => {
                                const target     = crcZone === 'sud' ? (r.mwSud ?? r.mwNord ?? r.mwTotal ?? 0) : (r.mwNord ?? r.mwTotal ?? 0)
                                const dispatched = r.mwDispatched ?? 0
                                return s + Math.max(0, target - dispatched)
                            }, 0)

                            let leftToApply = mwTotal
                            activeDnRealims.forEach((r) => {
                                if (leftToApply <= 0) return
                                const target     = crcZone === 'sud' ? (r.mwSud ?? r.mwNord ?? r.mwTotal ?? 0) : (r.mwNord ?? r.mwTotal ?? 0)
                                const remaining  = Math.max(0, target - (r.mwDispatched ?? 0))
                                const share      = totalRemaining > 0
                                    ? Math.min(remaining, (remaining / totalRemaining) * mwTotal)
                                    : remaining
                                const applied = Math.min(leftToApply, share)
                                partialRealim(r.id, applied, crcZone)
                                leftToApply -= applied
                            })
                        }
                    } catch (err) {
                        console.error('[CRC] Failed to persist realim order:', err?.response?.data ?? err.message)
                    }
                }}
            />
            <CRCUrgenceModal
                isOpen={urgenceOpen}
                onClose={() => { setUrgenceOpen(false); setModalOpen(false) }}
                myUrgences={myUrgences}
                crcName={userCRC}
                crcConsigne={crcCons}
                onManualEmit={handleCrcUrgence}
                onReceipt={(orderId) => {
                    // Always update legacy store for popup compatibility
                    acknowledgeReceipt(orderId)
                    // Wire to DB for DB-sourced orders
                    handleAckOrder(orderId)
                }}
                onDispatch={(orderId) => {
                    dispatchComplete(orderId)
                    handleDispatchOrder(orderId)
                }}
            />
        </div>
    )
}
