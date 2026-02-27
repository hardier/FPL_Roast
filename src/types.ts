export interface Player {
  id: number;
  web_name: string;
  element_type: number; // 1: GK, 2: DEF, 3: MID, 4: FWD
  team: number;
  now_cost: number;
}

export interface Team {
  id: number;
  name: string;
  short_name: string;
}

export interface BootstrapData {
  elements: Player[];
  teams: Team[];
  events: Event[];
}

export interface Event {
  id: number;
  name: string;
  finished: boolean;
  is_current: boolean;
}

export interface Transfer {
  element_in: number;
  element_in_cost: number;
  element_out: number;
  element_out_cost: number;
  event: number;
  time: string;
}

export interface Pick {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface EventPicks {
  active_chip: string | null;
  entry_history: {
    event_transfers: number;
    event_transfers_cost: number;
    points: number;
    total_points: number;
    rank: number;
    overall_rank: number;
    bank: number;
    value: number;
  };
  picks: Pick[];
}

export interface HistoryEvent {
  event: number;
  points: number;
  total_points: number;
  rank: number;
  rank_sort: number;
  overall_rank: number;
  bank: number;
  value: number;
  event_transfers: number;
  event_transfers_cost: number;
  points_on_bench: number;
}

export interface TeamHistory {
  current: HistoryEvent[];
  past: any[];
  chips: any[];
}
