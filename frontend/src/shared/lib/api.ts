/**
 * API Utility for communicating with Google Apps Script (GAS) Backend
 * Uses text/plain and JSON.stringify to bypass CORS Preflight (OPTIONS)
 */

const GAS_URL = import.meta.env.VITE_GAS_API_URL;

export async function fetchApi(action: string, payload: any = {}) {
  if (!GAS_URL) {
    throw new Error('VITE_GAS_API_URL is missing in .env');
  }

  try {
    const response = await fetch(`${GAS_URL}?action=${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({ action, ...payload }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status && data.status !== 200) {
      throw new Error(data.data?.error || `API returned status ${data.status}`);
    }
    
    return data;
  } catch (error) {
    console.error(`API Error (${action}):`, error);
    throw error;
  }
}
