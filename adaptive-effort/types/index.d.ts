// adaptive-effort · Copyright (c) 2026 hu-ghazal · https://github.com/hu-ghazal/Ghazal-Dev-Tools
// Shared under the PolyForm Noncommercial License 1.0.0 (see LICENSE). You are welcome to use, study and adapt it for
// noncommercial purposes; please keep this notice and the licence with any copy, and credit the original.
// Commercial use needs a separate licence.

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// The hold base, the max clock and Claude's latest EFFORT answer (level 0-3, when
// it was given); kept in $.state so a reload keeps them.
export type Hold = {
  current?: EffortLevel
  changedAt?: number
  max: { since?: number; capped: boolean }
  // The same 10-minute clock for xhigh.
  xhigh?: { since?: number; capped: boolean; endedAt?: number }
  answer?: { level: number; at: number }
}

// Readings of the 7-day limit this week (`resetsAt` in epoch ms), for the recent burn rate.
export type PaceLog = { resetsAt?: number; samples: { at: number; used: number }[] }

// The user's thresholds: per level, easier -2 .. harder +3 (0 = the effort rules' own).
export type Thresholds = { max: number; xhigh: number; high: number }

// One 15-minute bucket of the pane's chart (`at`: its start, epoch ms): calls sent and their output tokens at medium,
// high, xhigh and max.
export type ChartBucket = {
  at: number
  n: number[]
  tok?: number[]
  // Calls whose response reported usage: what output per call divides by.
  nt?: number[]
  // The output tokens of those calls, what output per call divides.
  ct?: number[]
}

// The pane's chart of this session: buckets of the last 24 hours and the effort last sent.
export type ChartLog = {
  buckets: ChartBucket[]
  last?: EffortLevel
}

declare module 'claude-code' {
  interface PluginState {
    'adaptive-effort': {
      enabled: boolean
      level: EffortLevel
      hold: Hold
      pace: PaceLog
      thresholds: Thresholds
      saved: Thresholds
      chart: ChartLog
      definitions: Record<'max' | 'xhigh' | 'high' | 'medium' | 'low', { count?: string; shift?: number; code: string; general: string }[]>
      editing: boolean
      split: { on: boolean; trigger: number; last?: { score: number; pass: boolean; at: number } }
    }
  }
}
