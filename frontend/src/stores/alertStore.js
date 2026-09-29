import { create } from 'zustand'

// ── Alert types ───────────────────────────────────────────────────────────────
// 'bcc_execution'  — BCC did not execute the planned shedding
// 'consumption'    — national consumption spiked above J-1 forecast
// 'frequency'      — grid frequency dropped below threshold

// ── Notification types (J+1 system) ──────────────────────────────────────────
// 'j1_reminder'    — DN: programme J+1 non saisi, rappel automatique
// 'j1_auto_zero'   — DN: délai dépassé, programme zéro appliqué automatiquement
// 'j1_published'   — CRC: DN a validé le programme J+1

// ── Ack status ────────────────────────────────────────────────────────────────
// 'unhandled'  — problem exists, DN/CRC has NOT acknowledged
// 'handling'   — operator pressed "Recu — En cours de traitement"
// 'resolved'   — issue is resolved (auto or manual)

export const useAlertStore = create((set, get) => ({

    // ── State — populated at runtime by useAlertSync from live DB data ────────
    alerts: [],

    // System notifications (J+1, reminders) — separate from operational alerts
    // Shape: { id, type, title, body, severity, createdAt, ackStatus }
    notifications: [],

    // Whether the alerts panel is currently open
    isPanelOpen: false,

    // ── Alert actions ─────────────────────────────────────────────────────────
    addAlert: (alert) =>
        set((s) => {
            // Never add duplicates
            if (s.alerts.find((a) => a.id === alert.id)) return s
            return { alerts: [...s.alerts, alert] }
        }),

    acknowledgeAlert: (id) => {
        const now  = new Date()
        const hhmm = `${String(now.getHours()).padStart(2,'0')}h${String(now.getMinutes()).padStart(2,'0')}`
        set((s) => ({
            alerts: s.alerts.map((a) =>
                a.id === id ? { ...a, ackStatus: 'handling', ackTime: hhmm } : a
            ),
        }))
    },

    resolveAlert: (id) =>
        set((s) => ({
            alerts: s.alerts.map((a) =>
                a.id === id ? { ...a, ackStatus: 'resolved' } : a
            ),
        })),

    // ── Notification actions (J+1 system) ─────────────────────────────────────
    // Add a system notification visible in the bell dropdown.
    // type: 'j1_reminder' | 'j1_auto_zero' | 'j1_published'
    // severity: 'info' | 'warn' | 'crit'
    addNotification: ({ type, title, body, severity = 'info' }) =>
        set((s) => {
            // De-duplicate by type — replace previous notification of same type
            const filtered = s.notifications.filter((n) => n.type !== type)
            const now      = new Date()
            const hhmm     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
            return {
                notifications: [
                    { id: `notif-${type}-${Date.now()}`, type, title, body, severity, createdAt: hhmm, ackStatus: 'unhandled' }
                    ,...filtered
                ],
            }
        }),

    acknowledgeNotification: (id) =>
        set((s) => ({
            notifications: s.notifications.map((n) =>
                n.id === id ? { ...n, ackStatus: 'handling' } : n
            ),
        })),

    resolveNotification: (type) =>
        set((s) => ({
            notifications: s.notifications.filter((n) => n.type !== type),
        })),

    // Called when DN opens the alerts panel (kept for AlertBar/AlertPanel compat)
    openPanel:  () => set({ isPanelOpen: true }),
    closePanel: () => set({ isPanelOpen: false }),

    // ── Computed helpers ──────────────────────────────────────────────────────
    activeAlerts: () => get().alerts.filter((a) => a.ackStatus !== 'resolved'),

    crcAlerts: (crcName) =>
        get().alerts.filter((a) => a.crc === crcName && a.ackStatus !== 'resolved'),

    hasUnhandled: () =>
        get().alerts.some((a) => a.ackStatus === 'unhandled'),

    // Live badge count: unhandled operational alerts + unhandled system notifications.
    // Derived directly from current state — always accurate regardless of role or
    // how items were added (REST load, WebSocket push, or reminder hook).
    unreadCount: () =>
    {
        const s = get()
        const unhandledAlerts = s.alerts.filter((a) => a.ackStatus === 'unhandled').length
        const unhandledNotifs = s.notifications.filter((n) => n.ackStatus === 'unhandled').length
        return unhandledAlerts + unhandledNotifs
    },
}))
