/**
 * API Utility for communicating with Google Apps Script (GAS) Backend
 * Uses text/plain and JSON.stringify to bypass CORS Preflight (OPTIONS)
 */

const GAS_URL = import.meta.env.VITE_GAS_API_URL;

export const LOST_RESPONSE_MESSAGE = 'ไม่ได้รับคำตอบจากเซิร์ฟเวอร์ — คำขออาจทำงานสำเร็จแล้ว โปรดตรวจสอบก่อนทำซ้ำ';

/**
 * Issue #156: a Lost Response (CONTEXT.md §50). The server received the request and may have run it, but its
 * answer never arrived: the backend answers status 405 to the body-less GET the browser made from a redirect.
 * The User stays signed in; the outcome is unknown, so the caller must check it before repeating the request.
 */
export class LostResponseError extends Error {
  constructor(message = LOST_RESPONSE_MESSAGE) {
    super(message);
    this.name = 'LostResponseError';
  }
}

export async function fetchApi(action: string, payload: any = {}) {
  if (!GAS_URL) {
    throw new Error('VITE_GAS_API_URL is missing in .env');
  }

  // ดึง Token จาก LocalStorage อัตโนมัติ (เพื่อความปลอดภัย)
  const token = localStorage.getItem('token');
  const securePayload = { action, ...payload };
  
  if (token) {
    securePayload.auth_token = token;
  }

  try {
    const response = await fetch(`${GAS_URL}?action=${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(securePayload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status && data.status !== 200) {
      if (data.status === 401) {
        // Dispatch custom event for AuthContext to handle (SPA Best Practice)
        window.dispatchEvent(new Event('auth:unauthorized'));
        throw new Error(data.data?.error || "Unauthorized");
      }
      // Issue #156: never a session problem, so no auth:unauthorized
      if (data.status === 405) throw new LostResponseError();
      throw new Error(data.data?.error || `API returned status ${data.status}`);
    }
    
    return data;
  } catch (error) {
    console.error(`API Error (${action}):`, error);
    throw error;
  }
}
