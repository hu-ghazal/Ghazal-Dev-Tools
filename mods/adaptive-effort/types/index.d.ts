export type EffortLevel = 'medium' | 'high' | 'xhigh' | 'max'

// The hold base, the max clock and Claude's latest EFFORT answer (level 0-3, when
// it was given); kept in $.state so a reload keeps them.
export type Hold = {
  current?: EffortLevel
  changedAt?: number
  max: { since?: number; capped: boolean }
  answer?: { level: number; at: number }
}

// Readings of the 7-day limit this week (`resetsAt` in epoch ms), for the recent burn rate.
export type PaceLog = { resetsAt?: number; samples: { at: number; used: number }[] }

// The user's thresholds: per level, easier -2 .. harder +3 (0 = the effort rules' own).
export type Thresholds = { max: number; xhigh: number; high: number }

declare module 'claude-code' {
  interface PluginState {
    'adaptive-effort': { enabled: boolean; level: EffortLevel; hold: Hold; pace: PaceLog; thresholds: Thresholds; saved: Thresholds }
  }
}
