// Envoi d'email transactionnel via l'API Brevo (https://developers.brevo.com).
// Si BREVO_API_KEY n'est pas configurée, l'envoi est simplement ignoré (mode dégradé) plutôt
// que de faire planter la requête — utile pendant les tests avant d'avoir créé le compte Brevo.

export async function sendMail({ to, toName, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn("BREVO_API_KEY absente — email non envoyé (mode dégradé).");
    return { sent: false, reason: "no_api_key" };
  }

  const fromEmail = process.env.MAIL_FROM_EMAIL || "no-reply@example.com";
  const fromName = process.env.MAIL_FROM_NAME || "Traçalinge";

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: to, name: toName || to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Échec envoi Brevo:", res.status, body);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("Erreur réseau envoi email:", err);
    return { sent: false, reason: "network_error" };
  }
}

export function deliveryNoteEmailHtml({ companyName, clientName, numero, itemCount, total, portalUrl }) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#122130;">
    <h2 style="color:#1E5A96;">${companyName}</h2>
    <p>Bonjour ${clientName},</p>
    <p>Votre linge est prêt — le bon de livraison <strong>${numero}</strong> (${itemCount} pièce(s), ${total}) a été validé.</p>
    <p>Vous pouvez le consulter et le télécharger en PDF depuis votre espace client :</p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${portalUrl}" style="background:#1E5A96;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;">
        Accéder à mon espace client
      </a>
    </p>
    <p style="color:#5C6B76;font-size:13px;">Cet email a été envoyé automatiquement par ${companyName}.</p>
  </div>`;
}
