import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";

const CONFIG_ERROR = "Authentification indisponible pour le moment.";

function translateAuthError(error) {
  const msg = (error && error.message) || "";
  const lengthMatch = /password should be at least (\d+) characters/i.exec(msg);
  if (lengthMatch) return `Le mot de passe doit contenir au moins ${lengthMatch[1]} caractères.`;
  if (/invalid login credentials/i.test(msg)) return "Email ou mot de passe incorrect.";
  if (/user already registered/i.test(msg)) return "Un compte existe déjà avec cet email.";
  if (/unable to validate email|invalid email/i.test(msg)) return "Adresse email invalide.";
  if (/email not confirmed/i.test(msg)) return "Veuillez confirmer votre email avant de vous connecter.";
  if (/rate limit/i.test(msg)) return "Trop de tentatives. Réessayez dans quelques instants.";
  if (/different from the old password/i.test(msg)) return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (/auth session missing|session.*(missing|not found)/i.test(msg)) return "Votre session de réinitialisation a expiré. Merci de redemander un lien.";
  return "Une erreur est survenue. Veuillez réessayer.";
}

export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (!supabase) return { error: CONFIG_ERROR };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: translateAuthError(error) };
    return { error: null };
  }, []);

  const signUp = useCallback(async (email, password) => {
    if (!supabase) return { error: CONFIG_ERROR, data: null };
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: translateAuthError(error), data: null };
    return { error: null, data: { needsEmailConfirmation: !data.session } };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const requestPasswordReset = useCallback(async (email) => {
    if (!supabase) return { error: CONFIG_ERROR };
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) return { error: translateAuthError(error) };
    return { error: null };
  }, []);

  const updatePassword = useCallback(async (newPassword) => {
    if (!supabase) return { error: CONFIG_ERROR };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: translateAuthError(error) };
    return { error: null };
  }, []);

  return {
    user: session ? session.user : null,
    loading,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    updatePassword,
  };
}
