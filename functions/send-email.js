// Esta función vive en el servidor de Cloudflare, NUNCA en el navegador — por eso la clave
// secreta de Brevo (BREVO_API_KEY) puede guardarse aquí de forma segura, sin que nadie que
// vea el código de la página pueda robarla. El portal de compra y la tiquetera solo le hablan
// a esta función (que sí pueden ver), y esta función es la única que le habla a Brevo.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// El navegador manda una petición "OPTIONS" antes de la real, para preguntar si tiene
// permiso — hay que responderla vacía y con los mismos encabezados.
export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Falta configurar BREVO_API_KEY en las variables de entorno de Cloudflare Pages (Settings → Environment variables).' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  let datos;
  try {
    datos = await request.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'El cuerpo de la petición no es JSON válido' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const { to_email, subject, message, reply_to, from_name, from_email, attachment_base64, attachment_name } = datos;

  if (!to_email || !subject || !message) {
    return new Response(
      JSON.stringify({ error: 'Faltan datos: se necesita to_email, subject y message' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // remitente: usa el correo que configuraste al verificar tu dominio/correo en Brevo.
  const remitenteCorreo = from_email || env.BREVO_SENDER_EMAIL;
  const remitenteNombre = from_name || env.BREVO_SENDER_NAME || 'Tiquetera';

  if (!remitenteCorreo) {
    return new Response(
      JSON.stringify({ error: 'Falta configurar BREVO_SENDER_EMAIL (el correo verificado en Brevo desde el que se envía) en Cloudflare.' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const payload = {
    sender: { name: remitenteNombre, email: remitenteCorreo },
    to: [{ email: to_email }],
    subject: subject,
    htmlContent: message,
  };
  if (reply_to) payload.replyTo = { email: reply_to };
  // Adjunto opcional (por ejemplo, el tiquete en PDF o JPG) — Brevo lo recibe en base64,
  // sin el prefijo "data:...;base64," que traen los data URLs generados en el navegador.
  if (attachment_base64 && attachment_name) {
    const contenidoLimpio = attachment_base64.includes(',')
      ? attachment_base64.split(',')[1]
      : attachment_base64;
    payload.attachment = [{ content: contenidoLimpio, name: attachment_name }];
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const textoResp = await res.text();
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Brevo rechazó el envío (${res.status}): ${textoResp || 'sin detalle'}` }),
        { status: res.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(textoResp || '{}', { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Error de red al llamar a Brevo: ' + e.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}
