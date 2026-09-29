/**
 * useWebSocket
 *
 * Single WebSocket connection for the entire app (mounted once in InternalLayout).
 * Dispatches incoming events into:
 *   - liveStore         (shared: all roles)
 *   - urgenceStore      (CRC: urgence + realim popups)
 *   - bccOrderStore     (BCC: order popup + banner)
 *
 * Events handled:
 *   connected          — server confirms connection
 *   new_order          — DN created an order → liveStore + role-specific store
 *   order_acked        — CRC pressed Reçu    → liveStore
 *   order_executed     — BCC confirmed exec  → liveStore
 *   order_cancelled    — DN cancelled        → liveStore + role-specific store
 *   new_execution      — BCC cut a feeder    → liveStore
 *   execution_restored — BCC restored        → liveStore
 *
 * Reconnects automatically after 3 s on unexpected disconnect.
 */
import { useEffect, useRef } from 'react'
import { useAuthStore }       from '../stores/authStore'
import { useLiveStore }       from '../stores/liveStore'
import { useUrgenceStore }    from '../stores/urgenceStore'
import { useBccOrderStore }   from '../stores/bccOrderStore'
import { useProgrammesStore } from '../stores/programmesStore'
import { useAlertStore }      from '../stores/alertStore'

const WS_BASE      = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/^http/, 'ws')
const RECONNECT_MS = 3000

export function useWebSocket() {
    const { user, token } = useAuthStore()
    const wsRef        = useRef(null)
    const retryRef     = useRef(null)
    const mountedRef   = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        if (!token) return

        function connect() {
            if (!mountedRef.current) return
            const store     = useLiveStore.getState()
            const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`)
            wsRef.current = ws

            ws.onopen = () => {
                store.setWsConnected(true)
                // keep-alive ping every 25 s
                retryRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send('ping')
                }, 25_000)
            }

            ws.onmessage = (evt) => {
                let data
                try { data = JSON.parse(evt.data) } catch { return }
                if (data === 'pong') return

                // Always refresh store reference (closures may be stale)
                const liveStore    = useLiveStore.getState()
                const urgStore     = useUrgenceStore.getState()
                const bccStore     = useBccOrderStore.getState()
                const role         = user?.role
                const bccId        = user?.bcc_id

                switch (data.event) {

                    case 'new_order': {
                        // Rule removed: urgences and realims now coexist and are netted
                        // into a single banner on both CRC and BCC sides.
                        // cancelRealimOrders() is no longer called automatically.

                        // Check BEFORE upserting whether this order was already in
                        // liveStore (loaded via REST on login).  If it was, the WS
                        // event is just a status echo — urgenceStore must not get a
                        // second entry for it.
                        const wasPreloaded = liveStore.orders.some(
                            (o) => o.order_ref === data.order_ref || o.id === (data.order_id ?? -1)
                        )

                        // Push into liveStore for dashboards + BCCOrderPopup.
                        // Include issued_by_role so BCCOrderPopup can reject DN orders.
                        liveStore.addOrUpdateOrder({
                            id:             data.order_id  ?? Date.now(),
                            order_ref:      data.order_ref,
                            order_type:     data.order_type,
                            mw_total:       data.mw_total,
                            mw_nord:        data.mw_nord  ?? 0,
                            mw_sud:         data.mw_sud   ?? 0,
                            status:         data.status   ?? 'pending',
                            issued_at:      data.issued_at,
                            target_crc_id:  data.target_crc_id ?? null,
                            issued_by_role: data.issued_by_role ?? null,
                            acks:           [],
                        })

                        // ── CRC: feed urgenceStore for the CRCUrgencePopup ──
                        // Only DN-issued orders appear in the CRC banner.
                        // Orders issued by a CRC are addressed to BCCs — the CRC
                        // that sent them must never see them as incoming orders.
                        if (role === 'CRC' && data.issued_by_role === 'DN') {
                            // Read urgenceStore fresh now to check its current content.
                            const freshUrgStore = useUrgenceStore.getState()
                            const alreadyInUrg  = freshUrgStore.urgences.some((o) => o.orderRef === data.order_ref)
                                               || freshUrgStore.realims.some((r)  => r.orderRef === data.order_ref)
                            // Skip if urgenceStore already has this order, OR if
                            // liveStore had it before (REST pre-load on login).
                            const isDup = alreadyInUrg || wasPreloaded
                            if (!isDup) {
                                if (data.order_type === 'urgence') {
                                    freshUrgStore.addUrgence({
                                        orderRef: data.order_ref,
                                        mwTotal:  data.mw_total,
                                        mwNord:   data.mw_nord,
                                        mwSud:    data.mw_sud,
                                    })
                                } else {
                                    freshUrgStore.addRealim({
                                        orderRef: data.order_ref,
                                        type:     data.sub_type ?? 'partielle',
                                        mwTotal:  data.mw_total,
                                        mwNord:   data.mw_nord,
                                        mwSud:    data.mw_sud,
                                    })
                                }
                            }
                        }

                        // ── BCC: feed bccOrderStore for the BCCOrderPopup ──
                        // ROUTING RULE: BCCs only receive orders from their own CRC.
                        // DN orders are handled exclusively by CRCs — the BCC branch
                        // is skipped entirely when issued_by_role === 'DN'.
                        if (role === 'BCC' && data.issued_by_role !== 'DN') {
                            // Read both stores fresh — closure state can be stale.
                            // An order is a duplicate if it already exists in
                            // liveStore (same order_ref) OR in bccOrderStore.
                            const freshBcc  = useBccOrderStore.getState()
                            const freshLive = useLiveStore.getState()
                            const isDup = freshBcc.orders.some((o) => o.orderRef === data.order_ref)
                                       || freshLive.orders.some((o) => o.order_ref === data.order_ref)
                            if (!isDup) {
                                // Pick the MW that targets this BCC's zone.
                                // BCCs 1-4 are CRC Nord → prefer mw_nord.
                                // BCCs 5-7 are CRC Sud  → prefer mw_sud.
                                // If the zone-specific field is 0 or missing, fall back
                                // to mw_total so a second urgence with mw_nord=0 (Sud-
                                // only order) doesn't silently arrive as a 0-MW order
                                // and immediately auto-execute via the isMet guard.
                                const bccIsNord  = bccId >= 1 && bccId <= 4
                                const zoneMW     = bccIsNord ? (data.mw_nord ?? 0) : (data.mw_sud ?? 0)
                                const mwForBcc   = zoneMW > 0 ? zoneMW : (data.mw_total ?? 0)
                                bccStore.addOrder({
                                    type:      data.order_type,
                                    mwTarget:  mwForBcc,
                                    targetBCC: bccId ? `BCC ${bccId}` : 'BCC ?',
                                })
                            }
                        }
                        break
                    }

                    case 'order_acked':
                        liveStore.updateOrderStatus(data.order_id, 'acknowledged')
                        break

                    case 'order_executed':
                        liveStore.updateOrderStatus(data.order_id, data.order_status ?? 'executing')
                        // If completed, evict from urgenceStore so CRC button stops flashing
                        if ((data.order_status === 'completed' || data.order_status === 'executing') && data.order_ref) {
                            useUrgenceStore.getState().evictByRef(data.order_ref)
                        }
                        break

                    case 'order_cancelled':
                        liveStore.updateOrderStatus(data.order_id, 'cancelled')
                        // Evict from urgenceStore so CRC button stops flashing
                        if (data.order_ref) {
                            useUrgenceStore.getState().evictByRef(data.order_ref)
                        }
                        // Remove from legacy stores too
                        if (role === 'CRC') {
                            useUrgenceStore.setState((s) => ({
                                urgences: s.urgences.map((o) =>
                                    o.orderRef === data.order_ref ? { ...o, status: 'cancelled' } : o),
                                realims: s.realims.map((r) =>
                                    r.orderRef === data.order_ref ? { ...r, status: 'cancelled' } : r),
                            }))
                        }
                        break

                    case 'new_execution':
                        liveStore.addExecution(data.execution)
                        break

                    case 'execution_restored':
                        liveStore.updateExecution(data.execution_id, { status: 'restored', ended_at: data.ended_at })
                        break

                    case 'j1_published': {
                        // CRC role: store J+1 slots, push bell notification, and raise pending flag
                        const wsRole = user?.role
                        if (wsRole === 'CRC') {
                            useProgrammesStore.getState().receiveJ1Published({
                                programme_id:   data.programme_id,
                                programme_date: data.programme_date,
                                status:         data.status,
                                is_auto_zero:   data.is_auto_zero ?? false,
                                slots:          data.slots ?? [],
                            })

                            const isZero = data.is_auto_zero ?? false
                            useAlertStore.getState().addNotification({
                                type:     'j1_published'
                                ,title:   isZero
                                    ? 'Programme J+1 — Zéro MW (automatique)'
                                    : 'Programme J+1 reçu du DN'
                                ,body:    isZero
                                    ? `Programme du ${data.programme_date} reçu automatiquement : délestage 0 MW sur tous les créneaux (DN n'a pas saisi à temps).`
                                    : `Le DN a validé le programme J+1 pour le ${data.programme_date}. Consultez vos objectifs par créneau dans la table de répartition.`
                                ,severity: isZero ? 'warn' : 'info'
                            })
                        }
                        // DN side: update own j1Status to 'validated'
                        if (wsRole === 'DN') {
                            useProgrammesStore.getState().setJ1Status(
                                data.status ?? 'validated',
                                data.programme_id,
                                data.programme_date,
                            )
                        }
                        break
                    }

                    case 'j1_assigned': {
                        // BCC role only — CRC has distributed their J+1 slots.
                        // Push a bell notification; no banner on the dashboard.
                        if (role === 'BCC') {
                            useAlertStore.getState().addNotification({
                                type:     'j1_assigned',
                                title:    `Programme J+1 reçu — ${data.crc_name}`,
                                body:     `${data.crc_name} a transmis votre programme J+1 pour le ${data.programme_date} : ${data.slots_count} créneaux · cible ${data.total_mw} MW. Ouvrez l'éditeur J+1 pour consulter et valider.`,
                                severity: 'info',
                            })
                        }
                        break
                    }

                    default:
                        break
                }
            }

            ws.onerror = () => {
                useLiveStore.getState().setWsConnected(false)
            }

            ws.onclose = () => {
                useLiveStore.getState().setWsConnected(false)
                clearInterval(retryRef.current)
                if (mountedRef.current) {
                    retryRef.current = setTimeout(connect, RECONNECT_MS)
                }
            }
        }

        connect()

        return () => {
            mountedRef.current = false
            clearInterval(retryRef.current)
            clearTimeout(retryRef.current)
            if (wsRef.current) wsRef.current.close()
        }
    }, [token, user?.role, user?.bcc_id])
}
