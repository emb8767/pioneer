// brevo-client.ts — Email notifications via Brevo transactional API
//
// Simple fetch-based client — no SDK needed.
// Endpoint: POST https://api.brevo.com/v3/smtp/email
// Auth: api-key header
//
// Usage:
//   await sendSuggestionEmail(businessName, email, suggestions)
//   await sendPlanCompleteEmail(businessName, email, planName, postCount)

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';

const SENDER = {
  name: 'Pioneer Agent',
  email: 'info@pioneeragt.com',
};

// ============================================================
// Core send function
// ============================================================

interface EmailParams {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
}

async function sendEmail(params: EmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!BREVO_API_KEY) {
    console.error('[Brevo] BREVO_API_KEY not set');
    return { success: false, error: 'BREVO_API_KEY not configured' };
  }

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: SENDER,
        to: params.to,
        subject: params.subject,
        htmlContent: params.htmlContent,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[Brevo] Error ${response.status}: ${body}`);
      return { success: false, error: `HTTP ${response.status}: ${body}` };
    }

    const data = await response.json();
    console.log(`[Brevo] Email sent: ${data.messageId}`);
    return { success: true, messageId: data.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Brevo] Send failed: ${msg}`);
    return { success: false, error: msg };
  }
}

// ============================================================
// Suggestion notification email
// ============================================================

interface SuggestionSummary {
  title: string;
  description: string;
  priority: number;
}

export async function sendSuggestionEmail(
  businessName: string,
  email: string,
  suggestions: SuggestionSummary[]
): Promise<{ success: boolean; error?: string }> {
  const suggestionItems = suggestions
    .sort((a, b) => b.priority - a.priority)
    .map(s => `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #eee;">
          <strong>${s.title}</strong><br/>
          <span style="color: #666; font-size: 14px;">${s.description}</span>
        </td>
      </tr>
    `)
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: #2563eb; padding: 24px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">Pioneer Agent</h1>
      <p style="color: #bfdbfe; margin: 8px 0 0;">Ideas nuevas para ${businessName}</p>
    </div>
    <div style="padding: 24px;">
      <p style="color: #333; font-size: 16px;">¡Hola! Tenemos ${suggestions.length} idea${suggestions.length > 1 ? 's' : ''} nueva${suggestions.length > 1 ? 's' : ''} de marketing para su negocio:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${suggestionItems}
      </table>
      <div style="text-align: center; margin-top: 24px;">
        <a href="https://pioneer-five.vercel.app/chat" style="display: inline-block; background: #2563eb; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: bold;">Ver sugerencias</a>
      </div>
    </div>
    <div style="background: #f9fafb; padding: 16px 24px; text-align: center; color: #999; font-size: 12px;">
      Pioneer Agent — Marketing inteligente para su negocio<br/>
      <a href="https://pioneeragt.com" style="color: #999;">pioneeragt.com</a>
    </div>
  </div>
</body>
</html>`;

  return sendEmail({
    to: [{ email, name: businessName }],
    subject: `💡 ${suggestions.length} idea${suggestions.length > 1 ? 's' : ''} nueva${suggestions.length > 1 ? 's' : ''} de marketing para ${businessName}`,
    htmlContent: html,
  });
}

// ============================================================
// Plan completion email
// ============================================================

export async function sendPlanCompleteEmail(
  businessName: string,
  email: string,
  planName: string,
  postCount: number
): Promise<{ success: boolean; error?: string }> {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: #059669; padding: 24px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">🎉 ¡Campaña completada!</h1>
      <p style="color: #a7f3d0; margin: 8px 0 0;">${businessName}</p>
    </div>
    <div style="padding: 24px;">
      <p style="color: #333; font-size: 16px;">Su campaña <strong>"${planName}"</strong> se completó exitosamente.</p>
      <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;">
        <span style="font-size: 36px; font-weight: bold; color: #059669;">${postCount}</span>
        <br/><span style="color: #666;">posts publicados</span>
      </div>
      <p style="color: #666; font-size: 14px;">Los posts se publicarán automáticamente según el horario programado. Visite Pioneer para ver el progreso y crear nueva contenido.</p>
      <div style="text-align: center; margin-top: 24px;">
        <a href="https://pioneer-five.vercel.app/chat" style="display: inline-block; background: #059669; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: bold;">Crear más contenido</a>
      </div>
    </div>
    <div style="background: #f9fafb; padding: 16px 24px; text-align: center; color: #999; font-size: 12px;">
      Pioneer Agent — Marketing inteligente para su negocio<br/>
      <a href="https://pioneeragt.com" style="color: #999;">pioneeragt.com</a>
    </div>
  </div>
</body>
</html>`;

  return sendEmail({
    to: [{ email, name: businessName }],
    subject: `🎉 Campaña completada: "${planName}" — ${postCount} posts publicados`,
    htmlContent: html,
  });
}
