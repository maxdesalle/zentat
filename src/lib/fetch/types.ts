export interface FetcherResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface Fetcher {
  fetch(url: string, init?: RequestInit): Promise<FetcherResponse>;
}

export type NymStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
