import axios from 'axios';
import type { EvaluationResponse } from '../types/evaluation';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const DEFAULT_TIMEOUT_MS = 30_000;

export const apiClient = axios.create({
  baseURL: BASE_URL,
});

/** fetch() with a timeout — a hung backend otherwise leaves the caller's
 *  pending/loading state stuck indefinitely with no way to recover. */
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request to ${input} timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const EVALUATION_CHECK_KEYS: (keyof EvaluationResponse)[] = [
  'check1_backflow', 'check2_supply_mode', 'check3_water_efficiency', 'check4_tank_pump',
  'check5_long_bath', 'check6_hot_water', 'check7_section3_pipes', 'check8_highest_fitting',
];

function assertEvaluationResponse(data: unknown): asserts data is EvaluationResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Evaluation response was not a JSON object.');
  }
  const missing = EVALUATION_CHECK_KEYS.filter((key) => !(key in (data as Record<string, unknown>)));
  if (missing.length > 0) {
    throw new Error(`Evaluation response is missing expected field(s): ${missing.join(', ')}`);
  }
}

export const evaluationApi = {
  evaluate: async (
    formData: FormData,
  ): Promise<EvaluationResponse> => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/evaluate`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const data: unknown = await res.json();
    assertEvaluationResponse(data);
    return data;
  },
};

export const exportApi = {
  exportDocx: async (formData: FormData): Promise<Blob> => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/export/docx`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.blob();
  },
};

export const feedbackApi = {
  submit: async (payload: {
    overall_satisfaction: number;
    likelihood_to_use_again: number;
    ease_of_use: number;
    confusion: string;
    wished_features: string;
  }): Promise<void> => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
  },
};

export const symbolsApi = {
  list: () => apiClient.get('/api/symbols'),
  getImageUrl: (symbolId: string) => `${BASE_URL}/api/symbols/${symbolId}/image`,
};
