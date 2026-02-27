import { BootstrapData, TeamHistory, Transfer, EventPicks } from '../types';

async function safeFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  
  if (!res.ok) {
    let errorMsg = 'Failed to fetch data';
    try {
      const errData = JSON.parse(text);
      errorMsg = errData.error || errorMsg;
    } catch (e) {
      if (text.toLowerCase().includes('<html') || text.toLowerCase().includes('<!doctype')) {
        errorMsg = 'FPL API is currently unavailable or under maintenance.';
      } else {
        errorMsg = text || errorMsg;
      }
    }
    throw new Error(errorMsg);
  }
  
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Received invalid data from FPL API. It might be under maintenance.');
  }
}

export const fetchBootstrap = async (): Promise<BootstrapData> => {
  return safeFetch<BootstrapData>('/api/fpl/bootstrap');
};

export const fetchTeamHistory = async (teamId: number): Promise<TeamHistory> => {
  return safeFetch<TeamHistory>(`/api/fpl/entry/${teamId}/history`);
};

export const fetchTeamTransfers = async (teamId: number): Promise<Transfer[]> => {
  return safeFetch<Transfer[]>(`/api/fpl/entry/${teamId}/transfers`);
};

export const fetchEventPicks = async (teamId: number, eventId: number): Promise<EventPicks> => {
  return safeFetch<EventPicks>(`/api/fpl/entry/${teamId}/event/${eventId}/picks`);
};
