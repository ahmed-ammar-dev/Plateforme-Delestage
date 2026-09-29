/**
 * useBCCState
 *
 * Loads the BCC feeder catalogue from the API (via useFeeders) then
 * overlays the current execution state from the DB, returning an
 * initialised postes array and dbExecIds map ready for BCCDashboard.
 *
 * Replaces the old approach that accepted a static POSTES constant —
 * the feeder catalogue is now dynamic so changes made in BCCDeparts
 * (add / edit / delete) are reflected immediately on next mount.
 */
import { useState, useEffect } from 'react'
import api                    from '../lib/api'
import { useFeeders }         from './useFeeders'

export function useBCCState() {
    const { postes: cataloguePostes, dbIdToRef, cooldownHours, loading: feedersLoading, error: feedersError } = useFeeders()

    const [initialPostes,    setInitialPostes]    = useState(null)
    const [initialDbExecIds, setInitialDbExecIds] = useState({})
    const [loading,          setLoading]          = useState(true)

    useEffect(() => {
        // Wait until feeders are loaded before overlaying execution state
        if (feedersLoading || cataloguePostes === null) return

        let cancelled = false

        async function overlayExecState() {
            try {
                const [execRes, restoredRes] = await Promise.all([
                    api.get('/api/v1/executions', { params: { status: 'executing', limit: 100 } }),
                    api.get('/api/v1/executions', { params: { status: 'restored',  limit: 100 } }),
                ])
                if (cancelled) return

                const execs    = execRes.data    ?? []
                const restored = restoredRes.data ?? []

                // Build ref → execution map for executing cuts
                const execByRef = {}
                const execIds   = {}
                for (const exec of execs) {
                    const ref = dbIdToRef[exec.feeder_id]
                    if (ref) { execByRef[ref] = exec; execIds[ref] = exec.id }
                }

                // Build map of ref → most-recent restore time for cuts ended today
                // We only show 'restored' if the feeder is STILL in cooldown
                // (i.e. hours_since_last_cut < cooldown threshold).
                // If cooldown has already expired, useFeeders already set status='available'
                // and we must not override that — the feeder should be selectable again.
                const today = new Date().toDateString()
                const restoredTodayRefs = new Set(
                    restored
                        .filter((e) => new Date(e.ended_at || e.started_at).toDateString() === today)
                        .map((e) => dbIdToRef[e.feeder_id])
                        .filter(Boolean)
                )

                // Overlay execution status on catalogue postes
                const updatedPostes = cataloguePostes.map((poste) => ({
                    ...poste,
                    feeders: poste.feeders.map((f) => {
                        if (f.locked) return f

                        const exec = execByRef[f.ref]
                        if (exec) {
                            const elapsedMin = Math.round((Date.now() - new Date(exec.started_at).getTime()) / 60000)
                            return { ...f, status: elapsedMin >= 45 ? 'overdue' : 'executing', elapsed: elapsedMin }
                        }
                        // Only mark 'restored' if the feeder is STILL inside its cooldown window.
                        // Compare f.hoursAgoCut directly against the threshold so this doesn't
                        // depend on useFeeders having already set f.status correctly.
                        const stillInCooldown = f.hoursAgoCut !== null && f.hoursAgoCut < cooldownHours
                        if (restoredTodayRefs.has(f.ref) && stillInCooldown) {
                            return { ...f, status: 'restored', elapsed: 0 }
                        }
                        // Preserve whatever status useFeeders assigned ('cooldown' or 'available')
                        return f
                    })
                }))

                setInitialPostes(updatedPostes)
                setInitialDbExecIds(execIds)
            } catch (err) {
                console.warn('[useBCCState] Failed to load execution state:', err.message)
                // Fall back to catalogue with all feeders available
                setInitialPostes(cataloguePostes)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        overlayExecState()
        return () => { cancelled = true }
    }, [feedersLoading, cataloguePostes, dbIdToRef])

    return {
        initialPostes
        ,initialDbExecIds
        ,cooldownHours
        ,loading: feedersLoading || loading
        ,feedersError
    }
}
