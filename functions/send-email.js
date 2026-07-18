// Esta función vive en el servidor de Cloudflare, NUNCA en el navegador — por eso la clave
// secreta de Brevo (BREVO_API_KEY) puede guardarse aquí de forma segura, sin que nadie que
// vea el código de la página pueda robarla. El portal de compra y la tiquetera solo le hablan
// a esta función (que sí pueden ver), y esta función es la única que le habla a Brevo.

// Marca de versión — sirve para confirmar con certeza si Cloudflare ya tomó esta
// actualización o si todavía está corriendo una versión anterior de este archivo.
const VERSION_FUNCION = 'v3-multi-adjuntos';

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

  const { to_email, subject, message, reply_to, from_name, from_email, attachment_base64, attachment_name, attachments } = datos;

  // Registro de diagnóstico: esto se ve en "Logs" dentro de tu proyecto de Cloudflare Pages,
  // para confirmar exactamente qué llegó desde el navegador antes de tocar nada más.
  console.log('[send-email] attachments recibidos:', Array.isArray(attachments) ? attachments.length : 'ninguno (no es un array)');
  if (Array.isArray(attachments)) {
    attachments.forEach((a, i) => console.log(`[send-email] adjunto ${i}: nombre=${a && a.name}, largo_content=${a && a.content ? a.content.length : 0}`));
  }

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

  function limpiarBase64(b64) {
    return b64 && b64.includes(',') ? b64.split(',')[1] : b64;
  }
  // Adjuntos: acepta una lista completa (varios tiquetes, JPG y PDF juntos), o el formato
  // anterior de un solo adjunto, para no romper integraciones ya desplegadas.
  if (Array.isArray(attachments) && attachments.length) {
    payload.attachment = attachments
      .filter((a) => a && a.content && a.name)
      .map((a) => ({ content: limpiarBase64(a.content), name: a.name }));
  } else if (attachment_base64 && attachment_name) {
    payload.attachment = [{ content: limpiarBase64(attachment_base64), name: attachment_name }];
  }
  console.log('[send-email] attachments que se van a mandar a Brevo:', payload.attachment ? payload.attachment.length : 0);

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
    // Info de diagnóstico: cuántos adjuntos llegaron a esta función y cuántos se mandaron a
    // Brevo — así se puede ver todo desde la consola del navegador, sin tener que buscar
    // los logs de Cloudflare.
    const diagnostico = {
      version: VERSION_FUNCION,
      adjuntosRecibidos: Array.isArray(attachments) ? attachments.length : 0,
      adjuntosEnviadosABrevo: payload.attachment ? payload.attachment.length : 0,
    };
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Brevo rechazó el envío (${res.status}): ${textoResp || 'sin detalle'}`, diagnostico }),
        { status: res.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
    let respuestaFinal = {};
    try { respuestaFinal = JSON.parse(textoResp || '{}'); } catch (e) {}
    respuestaFinal.diagnostico = diagnostico;
    return new Response(JSON.stringify(respuestaFinal), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Error de red al llamar a Brevo: ' + e.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}
