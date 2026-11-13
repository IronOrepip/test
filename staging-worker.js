function unauthorized() {
  return new Response("Sign in is required to view NOVA staging.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="NOVA staging", charset="UTF-8"'
    }
  });
}

function parseCredentials(header) {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(header || "");
  if (!match) return null;

  let binary;
  try {
    binary = atob(match[1]);
  } catch {
    return null;
  }

  const value = new TextDecoder().decode(
    Uint8Array.from(binary, character => character.charCodeAt(0))
  );
  const separator = value.indexOf(":");
  if (separator < 1) return null;

  return {
    username: value.slice(0, separator),
    password: value.slice(separator + 1)
  };
}

function matchesSecret(value, secret) {
  let difference = value.length ^ secret.length;
  const length = Math.max(value.length, secret.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (value.charCodeAt(index) || 0) ^ (secret.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol !== "https:") {
      url.protocol = "https:";
      return Response.redirect(url, 308);
    }

    if (!env.STAGING_USERNAME || !env.STAGING_PASSWORD || !env.ASSETS) {
      return new Response("NOVA staging authentication is not configured.", {
        status: 503,
        headers: { "Cache-Control": "no-store" }
      });
    }

    const credentials = parseCredentials(request.headers.get("Authorization"));
    if (
      !credentials ||
      !matchesSecret(credentials.username, env.STAGING_USERNAME) ||
      !matchesSecret(credentials.password, env.STAGING_PASSWORD)
    ) {
      return unauthorized();
    }

    const headers = new Headers(request.headers);
    headers.delete("Authorization");
    const assetRequest = new Request(request, { headers });
    const response = await env.ASSETS.fetch(assetRequest);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "private, no-store");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  }
};
