/* ENS Agent API client */

export interface ENSExpiry {
  date: string;
  timestamp: number;
  expired: boolean;
}

export interface ENSProfile {
  name: string;
  address: string | null;
  owner: string | null;
  resolver: string | null;
  primary_name: string | null;
  expiry: (ENSExpiry & { days_left?: number }) | null;
  text_records: Record<string, string>;
  avatar_url: string | null;
  network: string;
}

export interface ENSNameEntry {
  name: string;
  expiry: {
    date: string;
    timestamp: number;
    expired: boolean;
    days_left: number;
  } | null;
}

export interface ENSNameList {
  address: string;
  names: ENSNameEntry[];
  total: number;
  network: string;
}

interface ApiOk<T> {
  ok: true;
  data: T;
}

interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

type ApiResponse<T> = ApiOk<T> | ApiErr;

async function apiFetch<T>(path: string, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { signal: controller.signal });
    const json = (await res.json()) as ApiResponse<T>;
    if (!json.ok) throw new Error(json.error.message);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

export interface ENSCheckResult {
  available: boolean;
  label: string;
  fullName: string;
  price: {
    base: string;
    premium: string;
    total: string;
    total_with_buffer: string;
  } | null;
  duration_seconds: number;
  network: string;
}

export function fetchCheck(label: string, network: string, duration = '1y'): Promise<ENSCheckResult> {
  return apiFetch<ENSCheckResult>(
    `/api/check?label=${encodeURIComponent(label)}&network=${encodeURIComponent(network)}&duration=${encodeURIComponent(duration)}`,
  );
}

export function fetchProfile(input: string, network: string): Promise<ENSProfile> {
  return apiFetch<ENSProfile>(
    `/api/profile?input=${encodeURIComponent(input)}&network=${encodeURIComponent(network)}`,
  );
}

export function fetchNameList(address: string, network: string): Promise<ENSNameList> {
  return apiFetch<ENSNameList>(
    `/api/list?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network)}`,
  );
}
