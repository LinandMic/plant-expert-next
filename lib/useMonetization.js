import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMonetizationStatus } from "./monetizationApi";

export function useMonetization(user, authLoading) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const userId = user?.id || null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      if (mountedRef.current) {
        setStatus(null);
        setError(null);
        setLoading(false);
      }
      return null;
    }

    try {
      const nextStatus = await fetchMonetizationStatus();
      if (mountedRef.current) {
        setStatus(nextStatus);
        setError(null);
      }
      return nextStatus;
    } catch (e) {
      console.error("fetchMonetizationStatus failed", e);
      if (mountedRef.current) setError("MONETIZATION_STATUS_UNAVAILABLE");
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    refresh();
  }, [authLoading, refresh]);

  return { status, loading, error, refresh };
}
