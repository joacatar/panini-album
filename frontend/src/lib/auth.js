import { supabase } from "./supabase.js";

const RETURN_ROUTE_KEY = "authReturnRoute";
const FLASH_KEY = "authFlash";

/** Si Supabase redirige a :3000, mandar a :5173 con tokens intactos */
export function redirectLegacyAuthPort() {
  if (window.location.port !== "3000") return false;
  const target = `http://${window.location.hostname}:5173${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(target);
  return true;
}

/** URL sin hash — OAuth y magic link suelen perder el fragmento #ruta */
export function authCallbackUrl() {
  const path = window.location.pathname || "/";
  return `${window.location.origin}${path}`;
}

export function rememberAuthReturnRoute(route = "intercambiar") {
  sessionStorage.setItem(RETURN_ROUTE_KEY, route || "intercambiar");
}

export function peekAuthReturnRoute(defaultRoute = "intercambiar") {
  return sessionStorage.getItem(RETURN_ROUTE_KEY) || defaultRoute;
}

export function consumeAuthReturnRoute(defaultRoute = "intercambiar") {
  const route = peekAuthReturnRoute(defaultRoute);
  sessionStorage.removeItem(RETURN_ROUTE_KEY);
  return route;
}

export function setAuthFlash(type, message) {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ type, message }));
}

export function consumeAuthFlash() {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function decodeAuthError(value) {
  if (!value) return null;
  try {
    return decodeURIComponent(String(value).replace(/\+/g, " "));
  } catch {
    return String(value);
  }
}

/** Mensajes claros para errores típicos de Supabase Auth */
export function humanizeAuthError(message) {
  const m = String(message || "").toLowerCase();
  if (
    m.includes("invalid login credentials") ||
    m.includes("invalid email or password")
  ) {
    return "Correo o contraseña incorrectos. Si nunca creaste contraseña, usa «Crear cuenta» o restablece con la clave especial (dev).";
  }
  if (m.includes("user already registered")) {
    return "Ese correo ya tiene cuenta. Usa «Entrar» o restablece la contraseña.";
  }
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) {
    return (
      "Google aún no está activado en Supabase. " +
      "Usa correo + contraseña abajo."
    );
  }
  if (
    m.includes("invalid or has expired") ||
    m.includes("one-time token") ||
    m.includes("otp_expired")
  ) {
    return (
      "Ese enlace ya se usó o expiró (solo sirve una vez). " +
      "Vuelve a la app en http://localhost:5173, pide un correo nuevo y abre solo el último enlace en el mismo navegador."
    );
  }
  return message || "No se pudo iniciar sesión.";
}

export function hasAuthTokensInHash(hash) {
  const h = (hash || "").replace(/^#/, "");
  return (
    h.includes("access_token=") ||
    h.startsWith("error=") ||
    h.includes("error_description=") ||
    h.includes("type=magiclink") ||
    h.includes("type=signup") ||
    h.includes("type=recovery") ||
    h.includes("type=email")
  );
}

function authErrorFromUrl(url) {
  const hashRaw = (url.hash || "").replace(/^#/, "");
  const hashParams = new URLSearchParams(hasAuthTokensInHash(url.hash) ? hashRaw : "");
  return (
    url.searchParams.get("error_description") ||
    hashParams.get("error_description") ||
    url.searchParams.get("error") ||
    hashParams.get("error")
  );
}

/** Quita parámetros de auth de la URL y restaura #ruta de destino */
export function cleanAuthParamsFromUrl(returnRoute) {
  const url = new URL(window.location.href);
  for (const key of [
    "code",
    "error",
    "error_description",
    "error_code",
    "token_hash",
    "type",
  ]) {
    url.searchParams.delete(key);
  }

  let hashRoute = returnRoute || peekAuthReturnRoute("intercambiar");
  if (url.hash && !hasAuthTokensInHash(url.hash)) {
    const h = url.hash.replace(/^#/, "");
    const [maybeRoute] = h.split(/[&?]/);
    if (maybeRoute && !maybeRoute.includes("=")) hashRoute = maybeRoute;
  }

  const search = url.searchParams.toString();
  const path = `${url.pathname || "/"}${search ? `?${search}` : ""}#${hashRoute}`;
  window.history.replaceState({}, "", path);
  return hashRoute;
}

/**
 * Completa login tras redirect de Google o enlace mágico.
 * @returns {{ session: import('@supabase/supabase-js').Session | null, error: string | null, justCompleted: boolean }}
 */
export async function signInWithEmailPassword(email, password) {
  if (!supabase) return { session: null, error: new Error("Supabase no configurado") };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { session: data.session, error };
}

export async function signUpWithEmailPassword(email, password) {
  if (!supabase) return { session: null, error: new Error("Supabase no configurado") };
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authCallbackUrl() },
  });
  return { session: data.session, error, needsConfirm: !data.session };
}

/** Usuario ya logueado (p. ej. magic link) puede fijar contraseña */
export async function updateUserPassword(password) {
  if (!supabase) return { error: new Error("Supabase no configurado") };
  const { data, error } = await supabase.auth.updateUser({ password });
  return { user: data.user, error };
}

export async function completeAuthFromUrl() {
  if (!supabase) return { session: null, error: null, justCompleted: false };

  const url = new URL(window.location.href);
  const errorDesc = authErrorFromUrl(url);

  if (errorDesc) {
    cleanAuthParamsFromUrl(peekAuthReturnRoute("intercambiar"));
    return { session: null, error: humanizeAuthError(decodeAuthError(errorDesc)), justCompleted: false };
  }

  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type");
  if (tokenHash && otpType) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    cleanAuthParamsFromUrl(consumeAuthReturnRoute("intercambiar"));
    if (error) {
      return { session: null, error: humanizeAuthError(error.message), justCompleted: false };
    }
    return { session: data.session, error: null, justCompleted: Boolean(data.session) };
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      cleanAuthParamsFromUrl(peekAuthReturnRoute("intercambiar"));
      return { session: null, error: humanizeAuthError(error.message), justCompleted: false };
    }
    cleanAuthParamsFromUrl(consumeAuthReturnRoute("intercambiar"));
    return { session: data.session, error: null, justCompleted: true };
  }

  if (hasAuthTokensInHash(url.hash)) {
    const { data, error } = await supabase.auth.getSession();
    cleanAuthParamsFromUrl(consumeAuthReturnRoute("intercambiar"));
    if (error) {
      return { session: null, error: humanizeAuthError(error.message), justCompleted: false };
    }
    return { session: data.session, error: null, justCompleted: Boolean(data.session) };
  }

  return { session: null, error: null, justCompleted: false };
}
